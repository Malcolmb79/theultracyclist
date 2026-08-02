import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

//! The app shell. A data field's real work happens in its view; this exists
//! to hand the device that view.
class EdgeTrackerApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [ new EdgeTrackerView() ];
    }
}
