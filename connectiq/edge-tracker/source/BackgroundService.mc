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
//! Deliberately NOT annotated (:background), despite the build warning that
//! the whole app therefore loads into the background process.
//!
//! Annotating it builds a reduced background image, and AppBase.onStart -
//! which runs in the background context too - then can't reach the
//! unannotated SampleBuffer module it calls. That crashed the background
//! process with "Illegal Access (Out of Bounds)" at every temporal event,
//! before a single byte was ever sent. Verified on-device: 14:49:46,
//! 14:54:46, 14:59:46, five minutes apart to the second.
//!
//! The annotation only ever existed to shrink background memory, and the
//! reason that mattered is gone: the queue is a ring buffer now, so a flush
//! holds at most MAX_BATCH_SIZE samples rather than deserialising the entire
//! backlog. The warning is the lesser problem.
class BackgroundService extends System.ServiceDelegate {

    const INGEST_URL = "https://theultracyclist.com/api/ingest";

    // Only the count, not the samples: the batch stays in the queue until
    // the server acknowledges it (see SampleBuffer.peekBatch), so there is
    // nothing here that needs putting back on failure - and nothing that
    // gets lost if this process is killed before the callback ever runs.
    hidden var pendingCount as Number = 0;

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        var batch = SampleBuffer.peekBatch(SampleBuffer.MAX_BATCH_SIZE);
        if (batch.size() == 0) {
            Background.exit(0);
            return;
        }
        pendingCount = batch.size();

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
        // Only a confirmed store advances the queue. Anything else - a
        // non-200, or this callback never firing because there was no
        // phone to send through - leaves the batch exactly where it was
        // for the next temporal event to try again. Resending something
        // that did land is harmless: api/ingest.ts upserts with ON
        // CONFLICT DO NOTHING and reports the duplicates.
        if (responseCode == 200) {
            SampleBuffer.commitBatch(pendingCount);
        }
        pendingCount = 0;
        Background.exit(responseCode);
    }
}
