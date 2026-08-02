import Toybox.Activity;
import Toybox.Lang;
import Toybox.Position;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

//! The real thing visibility-test cleared the way for: reads position and
//! sensor data every compute() tick and ships it to api/ingest.ts, which
//! feeds the public /live page via the same Edge/Traccar merge rule
//! documented in the server's trackerDb.ts.
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

    hidden var buffer as SampleBuffer = new SampleBuffer();
    hidden var tickCount as Number = 0;
    // Flush roughly every 10 seconds rather than every compute() call - a
    // batch per tick would be 10x the HTTP traffic for no benefit, since
    // api/ingest.ts's ON CONFLICT DO NOTHING already makes larger, less
    // frequent batches just as safe to retry as small frequent ones.
    const FLUSH_EVERY_TICKS = 10;

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
        buffer.push(sample);

        tickCount += 1;
        if (tickCount >= FLUSH_EVERY_TICKS) {
            tickCount = 0;
            buffer.flush();
        }

        // One line, read as: total sent / currently buffered / last HTTP
        // status - a live sanity signal for whoever's glancing at the
        // field, same terse spirit as visibility-test's readout.
        return buffer.sentTotal().format("%d") + "/" + buffer.bufferedCount().format("%d") + "/" + buffer.lastHttpStatus().format("%d");
    }
}
