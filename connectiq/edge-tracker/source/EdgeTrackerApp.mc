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
        SampleBuffer.discardLegacyQueue();
        if (Background.getTemporalEventRegisteredTime() == null) {
            Background.registerForTemporalEvent(new Time.Duration(5 * 60));
        }
    }

    function onStop(state as Dictionary or Null) as Void {
    }

    (:background)
    function getServiceDelegate() as [System.ServiceDelegate] {
        return [ new BackgroundService() ];
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [ new EdgeTrackerView() ];
    }
}
