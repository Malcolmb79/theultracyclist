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

        var sample = {
            "seq" => ts,
            "ts" => ts,
            "lat" => lat,
            "lon" => lon,
            "alt_m" => info.altitude,
            "dist_m" => info.elapsedDistance,
            "elapsed_s" => info.elapsedTime != null ? (info.elapsedTime / 1000) : null,
            "timer_s" => info.timerTime != null ? (info.timerTime / 1000) : null,
            "speed_mps" => info.currentSpeed,
            "power_w" => info.currentPower,
            "hr_bpm" => info.currentHeartRate,
            "cad_rpm" => info.currentCadence,
            "batt_pct" => System.getSystemStats().battery.toNumber(),
        };
        SampleBuffer.push(sample);
        return status();
    }

    // One line, read as: currently buffered / last background-send HTTP
    // status (0 before the first attempt) - a live sanity signal for
    // whoever's glancing at the field. If this stops changing, compute()
    // has stopped running, which is the symptom the old unbounded
    // per-tick Storage rewrite produced within a couple of minutes.
    hidden function status() as String {
        return SampleBuffer.bufferedCount().format("%d") + "/" + SampleBuffer.lastStatus().format("%d");
    }
}
