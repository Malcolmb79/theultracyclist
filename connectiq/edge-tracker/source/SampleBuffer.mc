import Toybox.Application.Storage;
import Toybox.Lang;

//! Sample queue shared between the data field's compute() (foreground) and
//! BackgroundService (a separate, restricted execution context) via
//! Application.Storage - the only channel the two can communicate through.
//! compute() can't call Communications.makeWebRequest() itself (Toybox.
//! Communications isn't usable from a data field's foreground process at
//! all - see BackgroundService.mc), so this module is the queue compute()
//! writes into and the periodic background event drains from.
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
module SampleBuffer {

    // 30 minutes at ~1Hz. Generous relative to the 3-minute Traccar
    // fallback above, while still bounded.
    const MAX_BUFFERED = 1800;
    // Kept comfortably under api/ingest.ts's 256KB batch limit - each
    // sample serializes to roughly 120-180 bytes as JSON.
    const MAX_BATCH_SIZE = 60;

    const QUEUE_KEY = "sampleQueue";
    const STATUS_KEY = "lastFlushStatus";
    const SEQ_KEY = "batchSeq";

    function push(sample as Dictionary) as Void {
        var queue = Storage.getValue(QUEUE_KEY) as Array or Null;
        if (queue == null) {
            queue = [] as Array;
        }
        queue.add(sample);
        if (queue.size() > MAX_BUFFERED) {
            queue = dropFront(queue, queue.size() - MAX_BUFFERED);
        }
        Storage.setValue(QUEUE_KEY, queue);
    }

    function bufferedCount() as Number {
        var queue = Storage.getValue(QUEUE_KEY) as Array or Null;
        return queue == null ? 0 : queue.size();
    }

    function lastStatus() as Number {
        var status = Storage.getValue(STATUS_KEY) as Number or Null;
        return status == null ? 0 : status;
    }

    function setLastStatus(code as Number) as Void {
        Storage.setValue(STATUS_KEY, code);
    }

    // Removes and returns up to maxSize samples from the front of the
    // queue, atomically (the caller - BackgroundService - owns the batch
    // from this point; requeueFront puts it back if the send fails).
    function takeBatch(maxSize as Number) as Array {
        var queue = Storage.getValue(QUEUE_KEY) as Array or Null;
        if (queue == null) {
            queue = [] as Array;
        }
        var size = maxSize < queue.size() ? maxSize : queue.size();
        var batch = takeFront(queue, size);
        Storage.setValue(QUEUE_KEY, dropFront(queue, size));
        return batch;
    }

    function requeueFront(batch as Array) as Void {
        var queue = Storage.getValue(QUEUE_KEY) as Array or Null;
        if (queue == null) {
            queue = [] as Array;
        }
        var merged = [] as Array;
        merged.addAll(batch);
        merged.addAll(queue);
        if (merged.size() > MAX_BUFFERED) {
            merged = dropFront(merged, merged.size() - MAX_BUFFERED);
        }
        Storage.setValue(QUEUE_KEY, merged);
    }

    function nextBatchSeq() as Number {
        var seq = Storage.getValue(SEQ_KEY) as Number or Null;
        var next = (seq == null ? 0 : seq) + 1;
        Storage.setValue(SEQ_KEY, next);
        return next;
    }

    function takeFront(arr as Array, n as Number) as Array {
        var count = n < arr.size() ? n : arr.size();
        var out = [] as Array;
        for (var i = 0; i < count; i++) {
            out.add(arr[i]);
        }
        return out;
    }

    function dropFront(arr as Array, n as Number) as Array {
        var count = n < arr.size() ? n : arr.size();
        var out = [] as Array;
        for (var i = count; i < arr.size(); i++) {
            out.add(arr[i]);
        }
        return out;
    }
}
