import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;

//! Buffers samples in memory and POSTs them to api/ingest.ts in batches.
//!
//! Bounded rather than unbounded: a long connectivity blackspot must not
//! grow memory without limit on a device that has to keep recording for a
//! multi-day attempt. The oldest samples are dropped once the buffer fills -
//! an acceptable trade, not a silent one, because the live tracker's own
//! merge rule (see mergePosition in the server's trackerDb.ts) already
//! falls back to the phone's Traccar position after 3 minutes without an
//! Edge sample, so losing some track resolution during an extended dropout
//! doesn't blank the map the way losing the CURRENT distance/record numbers
//! would - and those are read fresh from Activity.Info on every tick, not
//! reconstructed from this buffer.
//!
//! Only one HTTP request is ever in flight at a time - makeWebRequest is
//! async and this data field has no reason to race itself.
class SampleBuffer {

    // 30 minutes at ~1Hz. Generous relative to the 3-minute Traccar
    // fallback above, while still bounded.
    const MAX_BUFFERED = 1800;
    // Kept comfortably under api/ingest.ts's 256KB batch limit - each
    // sample serializes to roughly 120-180 bytes as JSON.
    const MAX_BATCH_SIZE = 60;
    const INGEST_URL = "https://theultracyclist.com/api/ingest";

    hidden var queue as Array = [];
    hidden var pendingBatch as Array or Null = null;
    hidden var batchSeq as Number = 0;
    hidden var sentCount as Number = 0;
    hidden var requestInFlight as Boolean = false;
    hidden var lastStatus as Number = 0;

    function sentTotal() as Number {
        return sentCount;
    }

    function bufferedCount() as Number {
        return queue.size();
    }

    function lastHttpStatus() as Number {
        return lastStatus;
    }

    function push(sample as Dictionary) as Void {
        queue.add(sample);
        if (queue.size() > MAX_BUFFERED) {
            queue = dropFront(queue, queue.size() - MAX_BUFFERED);
        }
    }

    function flush() as Void {
        if (requestInFlight || queue.size() == 0) {
            return;
        }

        var token = Application.Properties.getValue("ingestToken") as String or Null;
        if (token == null || token.equals("")) {
            // Not configured yet - nothing to do until Settings has a
            // token. Samples keep buffering (up to MAX_BUFFERED) rather
            // than being dropped, so setting the token mid-ride still
            // sends whatever's accumulated since the field was added.
            return;
        }

        var batchSize = queue.size() < MAX_BATCH_SIZE ? queue.size() : MAX_BATCH_SIZE;
        var batch = takeFront(queue, batchSize);
        queue = dropFront(queue, batchSize);

        pendingBatch = batch;
        requestInFlight = true;
        batchSeq += 1;

        var body = {
            "device" => "edge1040",
            "batch_seq" => batchSeq,
            "samples" => batch,
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "Authorization" => "Bearer " + token,
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };

        Communications.makeWebRequest(INGEST_URL, body, options, method(:onFlushResponse));
    }

    function onFlushResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        requestInFlight = false;
        lastStatus = responseCode;

        if (pendingBatch == null) {
            return;
        }

        if (responseCode == 200) {
            sentCount += pendingBatch.size();
        } else {
            // Failed - put the batch back at the front of the queue rather
            // than dropping it. api/ingest.ts's ON CONFLICT DO NOTHING
            // means resending anything that actually did land server-side
            // is harmless, so there's no need to know which samples, if
            // any, made it through before the failure.
            var merged = [] as Array;
            merged.addAll(pendingBatch);
            merged.addAll(queue);
            queue = merged;
            if (queue.size() > MAX_BUFFERED) {
                queue = dropFront(queue, queue.size() - MAX_BUFFERED);
            }
        }
        pendingBatch = null;
    }

    hidden function takeFront(arr as Array, n as Number) as Array {
        var count = n < arr.size() ? n : arr.size();
        var out = [] as Array;
        for (var i = 0; i < count; i++) {
            out.add(arr[i]);
        }
        return out;
    }

    hidden function dropFront(arr as Array, n as Number) as Array {
        var count = n < arr.size() ? n : arr.size();
        var out = [] as Array;
        for (var i = count; i < arr.size(); i++) {
            out.add(arr[i]);
        }
        return out;
    }
}
