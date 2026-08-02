import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

//! Registers the periodic background event that actually sends data - see
//! BackgroundService.mc for why the send itself can't happen from the data
//! field's own compute(). 5 minutes is the shortest interval Connect IQ
//! allows for a temporal event, matched here rather than picking something
//! shorter the platform would just round up to anyway.
class EdgeTrackerApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary or Null) as Void {
        // Housekeeping, and nothing depends on it succeeding - so it must
        // never be the reason onStart doesn't finish. It already was once:
        // an unreachable symbol here took down the background process at
        // every temporal event, five minutes apart, before anything was
        // ever sent. Registering the temporal event is the part that
        // actually matters, and it now runs regardless.
        try {
            SampleBuffer.discardLegacyQueue();
        } catch (e) {
        }
        if (Background.getTemporalEventRegisteredTime() == null) {
            Background.registerForTemporalEvent(new Time.Duration(5 * 60));
        }
    }

    function onStop(state as Dictionary or Null) as Void {
    }

    // Not annotated (:background) - see the note on BackgroundService.
    function getServiceDelegate() as [System.ServiceDelegate] {
        return [ new BackgroundService() ];
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [ new EdgeTrackerView() ];
    }
}
