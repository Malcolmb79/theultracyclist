import Toybox.Activity;
import Toybox.Lang;
import Toybox.Position;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

//! The real thing visibility-test cleared the way for: reads position and
//! sensor data every compute() tick and buffers it for BackgroundService to
//! ship to api/ingest.ts, which feeds the public /live page via the same
//! Edge/Traccar merge rule documented in the server's trackerDb.ts.
//!
//! compute() only ever writes to SampleBuffer - it never touches
//! Communications directly, because a data field's foreground process
//! can't make web requests at all (see BackgroundService.mc).
//!
//! Field names match api/ingest.ts's IncomingSample exactly (lat/lon/alt_m/
//! dist_m/elapsed_s/timer_s/speed_mps/power_w/hr_bpm/cad_rpm/batt_pct) -
//! see that file for what each one means server-side. elapsed_s comes from
//! Activity.Info's elapsedTime (includes stopped time) and timer_s from
//! timerTime (moving time only), matching trackerDb.ts's own
//! stopped_time_counts distinction exactly, because both sides were
//! written against the same Garmin semantics.
//!
//! Sending HTTP mid-ride depends on the Edge tethering to a phone running
//! Garmin Connect Mobile in the background with cellular data - the Edge's
//! own WiFi won't be connected while moving. That's an operational
//! dependency for the pre-start checklist, not something this code can
//! route around.
class EdgeTrackerView extends WatchUi.SimpleDataField {

    // Timestamp of the last sample actually buffered. compute() still runs
    // every second - it has to, to keep returning the status line - but
    // only one tick in SampleBuffer.SAMPLE_INTERVAL_S is kept. See that
    // constant for why: at 1Hz the queue produced five times what a
    // five-minute temporal event could ever send, so it could only ever
    // fall behind.
    hidden var lastSampleTs as Number = 0;
    // Sticky: once a write has failed the field says so for the rest of the
    // ride. Storage problems were previously only visible by pulling
    // CIQ_LOG.YML over USB afterwards, which is no use while riding.
    hidden var storageFailed as Boolean = false;

    function initialize() {
        SimpleDataField.initialize();
        label = "Ultra Cyclist Tracker";
    }

    function compute(info as Activity.Info) as Numeric or Duration or String or Null {
        // Unix seconds - both the sample's timestamp and, since compute()
        // fires at most once per second, a fine idempotency key on its own.
        // (device, seq) is the primary key server-side; deriving seq from
        // wall-clock time rather than a counter means it needs no
        // persistence to "survive app restarts" the way trackerDb.ts's
        // schema comment requires - it already does, for free.
        var ts = Time.now().value();

        // Not due yet: return the status line without touching Storage at
        // all. The early return is the point - the old code did a
        // read-modify-write of the entire queue on every one of these
        // ticks.
        if (lastSampleTs != 0 && ts - lastSampleTs < SampleBuffer.SAMPLE_INTERVAL_S) {
            return status();
        }
        lastSampleTs = ts;

        var lat = null;
        var lon = null;
        var loc = info.currentLocation;
        if (loc != null) {
            var degrees = loc.toDegrees();
            lat = degrees[0].toFloat();
            lon = degrees[1].toFloat();
        }

        // Positional array, not a dictionary keyed by field name. A
        // dictionary carries its 13 string keys per sample, in RAM and
        // again in the serialized JSON, and the background process that
        // has to hold a whole batch of these has a far smaller memory
        // budget than the foreground: a 60-sample batch of dictionaries
        // ran it out of memory inside peekBatch at every single temporal
        // event, so nothing was ever sent.
        //
        // Order is the contract with api/ingest.ts's COMPACT_FIELDS - it
        // must not be reordered on one side only.
        var sample = [
            ts,                                                     // seq
            ts,                                                     // ts
            lat,
            lon,
            info.altitude,                                          // alt_m
            info.elapsedDistance,                                   // dist_m
            info.elapsedTime != null ? (info.elapsedTime / 1000) : null,   // elapsed_s
            info.timerTime != null ? (info.timerTime / 1000) : null,       // timer_s
            info.currentSpeed,                                      // speed_mps
            info.currentPower,                                      // power_w
            info.currentHeartRate,                                  // hr_bpm
            info.currentCadence,                                    // cad_rpm
            System.getSystemStats().battery.toNumber(),             // batt_pct
        ];
        if (!SampleBuffer.push(sample)) {
            storageFailed = true;
        }
        return status();
    }

    // One line, read as: currently buffered / last background-send HTTP
    // status (0 before the first attempt) - a live sanity signal for
    // whoever's glancing at the field. If this stops changing, compute()
    // has stopped running, which is the symptom the old unbounded
    // per-tick Storage rewrite produced within a couple of minutes.
    hidden function status() as String {
        var buffered = SampleBuffer.bufferedCount();
        var line = buffered.format("%d") + "/" + SampleBuffer.lastStatus().format("%d");

        // "F" once the ring is full. Without it a capped buffer and a dead
        // app look identical - both just stop changing - which is exactly
        // how a working buffer got mistaken for a stalled one.
        if (buffered >= SampleBuffer.CAPACITY) {
            line += "F";
        }

        // What the device itself thinks of the phone link, which is not the
        // same thing as what Garmin Connect Mobile shows: the app reported
        // "Edge 1040 - Connected" while every send failed -104, "no BLE
        // connection is available". This is the runtime's own view, the one
        // makeWebRequest actually acts on.
        //
        // Read directly rather than behind `has`. DeviceSettings is a native
        // object and `has` is for testing symbols on Monkey C ones, so the
        // guard could report the property missing whatever its value - which
        // would print "no phone" forever and send anyone reading it off
        // chasing a Bluetooth fault that isn't there. A try/catch gives the
        // same protection without the false negative, and "?" distinguishes
        // "couldn't read it" from "read it, and it's false".
        //
        // "P" connected, "p" not, "?" unavailable on this device.
        try {
            line += System.getDeviceSettings().phoneConnected ? "P" : "p";
        } catch (e) {
            line += "?";
        }

        // Trailing "!" means a sample couldn't be stored - almost always
        // storage full. Worth seeing on the bars rather than discovering
        // afterwards.
        return storageFailed ? line + "!" : line;
    }
}
