import Toybox.Activity;
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

    //! Fired when an activity is saved, not on the 5-minute schedule.
    //!
    //! This is what makes the end-of-ride summary appear promptly: the final
    //! samples - carrying the stop marker and the ride's closing totals - go
    //! out as the ride is saved rather than waiting for the next scheduled
    //! flush.
    //!
    //! One flush, not a loop: a background process gets one callback and a
    //! small memory budget, and trying to drain a deep backlog here is how
    //! the out-of-memory failures happened in the first place. In normal
    //! operation the queue is shallow anyway - 10 samples produced per
    //! window against a batch of 20 - so a single flush clears it. Only
    //! after a long blackspot would anything remain, and that goes out on
    //! the following temporal events as usual.
    function onActivityCompleted(activity as { :sport as Activity.Sport, :subSport as Activity.SubSport }) as Void {
        // Clear the schedule as the ride ends, so the next ride's 30-second
        // first flush is actually allowed - the five-minute floor counts
        // from the last event that occurred, and a schedule left running
        // between rides would refuse it every time. Nothing is sampling
        // once the activity is saved, so there is nothing to schedule for.
        //
        // Deleted before the flush is started, not after: the request
        // already in flight is unaffected, and doing it in the callback
        // would mean skipping it whenever the send fails - exactly when the
        // device is least able to tell us.
        try {
            Background.deleteTemporalEvent();
        } catch (e) {
        }
        flush();
    }

    function onTemporalEvent() as Void {
        // Re-arm. The 30-second first flush is registered as a one-shot
        // Moment, and only one temporal event exists at a time, so without
        // this the ride would send once and never again.
        try {
            Background.registerForTemporalEvent(new Time.Duration(5 * 60));
        } catch (e) {
        }
        flush();
    }

    hidden function flush() as Void {
        var batch = SampleBuffer.peekBatch(SampleBuffer.MAX_BATCH_SIZE);
        if (batch.size() == 0) {
            Background.exit(0);
            return;
        }
        pendingCount = batch.size();

        // Recorded before the attempt, not after, and from inside the
        // background process - this is the link state makeWebRequest is
        // about to act on. A -104 next to "phone was connected" means the
        // request was refused with the link up, which is a different
        // problem from a flush that fired into a dropout.
        try {
            SampleBuffer.setLastFlushPhone(System.getDeviceSettings().phoneConnected ? 1 : 2);
        } catch (e) {
            SampleBuffer.setLastFlushPhone(0);
        }

        // format v2 tells api/ingest.ts the samples are positional arrays
        // rather than field-keyed objects. Absent it, the server reads the
        // old shape - which is what keeps a device still running an older
        // build working against the same endpoint.
        var body = {
            "device" => "edge1040",
            "batch_seq" => SampleBuffer.nextBatchSeq(),
            "format" => "v2",
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
