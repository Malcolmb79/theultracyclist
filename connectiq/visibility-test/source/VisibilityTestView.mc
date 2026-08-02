import Toybox.Activity;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

//! Answers one question before any real work is built on top of it:
//! does compute() keep being called while this data field is NOT the page
//! on screen?
//!
//! On many Garmin devices it does not. If that holds on this Edge and this
//! firmware, then scrolling to another data page during the attempt silently
//! stops the feed - the page would show a rider frozen mid-Ireland with no
//! error anywhere, and nobody would know why. The mitigation (a dedicated
//! page left displayed for the whole ride) is easy, but it has to be a
//! decision written into the pre-start checklist rather than something
//! discovered at hour three.
//!
//! The test is self-evident on screen and needs nothing written down: the
//! field counts its own compute() calls and, separately, the seconds since
//! the first one. compute() is called about once per second, so:
//!
//!   COUNT == SECS  ->  it ran the whole time, including while hidden
//!   COUNT <  SECS  ->  it paused while hidden; the gap is how long for
//!
//! MAXGAP is the longest interval between two consecutive compute() calls,
//! which turns "roughly matches" into a number. A five-minute excursion to
//! another page shows up as MAXGAP near 300.
class VisibilityTestView extends WatchUi.SimpleDataField {

    hidden var computeCount as Number = 0;
    hidden var firstMoment as Moment or Null = null;
    hidden var lastMoment as Moment or Null = null;
    hidden var maxGapSeconds as Number = 0;

    function initialize() {
        SimpleDataField.initialize();
        label = "CIQ visibility test";
    }

    //! Called roughly once per second while recording - if the device is
    //! willing. That willingness is the whole experiment.
    function compute(info as Activity.Info) as Numeric or Duration or String or Null {
        var now = Time.now();

        if (firstMoment == null) {
            firstMoment = now;
        } else {
            // The gap since the previous call. While the field is visible this
            // sits at 1; any larger value is the device having stopped calling
            // us, and the largest one is the answer.
            var gap = now.subtract(lastMoment).value();
            if (gap > maxGapSeconds) {
                maxGapSeconds = gap;
            }
        }

        lastMoment = now;
        computeCount += 1;

        var elapsedSeconds = now.subtract(firstMoment).value();

        // Everything on one line, because a SimpleDataField gets one line.
        // Read it as: calls / seconds / longest silence.
        return computeCount.format("%d") + "/" + elapsedSeconds.format("%d") + "/" + maxGapSeconds.format("%d");
    }
}
