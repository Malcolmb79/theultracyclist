import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

//! Runs in a separate, restricted execution context Garmin spins up on the
//! temporal event registered in EdgeTrackerApp.mc - Toybox.Communications
//! is only usable from here, not from the data field's own compute() (a
//! foreground process that can't make web requests at all), so this is
//! where the actual HTTP POST to api/ingest.ts happens. Reads/writes the
//! sample queue via SampleBuffer, which is backed by Application.Storage -
//! the only channel shared between this and the foreground compute() that
//! pushed the samples there.
class BackgroundService extends System.ServiceDelegate {

    const INGEST_URL = "https://theultracyclist.com/api/ingest";

    hidden var pendingBatch as Array or Null = null;

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        var batch = SampleBuffer.takeBatch(SampleBuffer.MAX_BATCH_SIZE);
        if (batch.size() == 0) {
            Background.exit(0);
            return;
        }
        pendingBatch = batch;

        var body = {
            "device" => "edge1040",
            "batch_seq" => SampleBuffer.nextBatchSeq(),
            "samples" => batch,
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "Authorization" => "Bearer " + Secrets.INGEST_TOKEN,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };

        Communications.makeWebRequest(INGEST_URL, body, options, method(:onReceive));
    }

    function onReceive(responseCode as Number, data as Dictionary or String or Null) as Void {
        SampleBuffer.setLastStatus(responseCode);
        if (responseCode != 200 && pendingBatch != null) {
            // Failed - put the batch back at the front of the queue rather
            // than losing it. api/ingest.ts's ON CONFLICT DO NOTHING means
            // resending anything that actually did land server-side before
            // the failure is harmless.
            SampleBuffer.requeueFront(pendingBatch);
        }
        pendingBatch = null;
        Background.exit(responseCode);
    }
}
