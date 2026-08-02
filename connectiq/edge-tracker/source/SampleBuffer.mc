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
//! A ring buffer addressed by slot, not one stored array. The first version
//! kept the whole queue under a single key, so every push was
//! getValue(whole array) -> add -> setValue(whole array): O(n) flash I/O
//! and two full copies of the queue live in RAM, once per second, with n
//! growing by one every second. On a data field's memory budget that dies
//! within a couple of minutes, which is exactly what the first test ride
//! showed - the field updated for a few seconds and then stopped. Each
//! push is now two small fixed-size writes regardless of how much is
//! queued.
//!
//! Bounded rather than unbounded: a long connectivity blackspot must not
//! grow storage without limit on a device that has to keep recording for a
//! multi-day attempt. The oldest samples are dropped once the buffer fills -
//! an acceptable trade, not a silent one, because the live tracker's own
//! merge rule (see mergePosition in the server's trackerDb.ts) already
//! falls back to the phone's Traccar position after 3 minutes without an
//! Edge sample, so losing some track resolution during an extended dropout
//! doesn't blank the map the way losing the CURRENT distance/record numbers
//! would - and those are read fresh from Activity.Info on every tick, not
//! reconstructed from this buffer.
module SampleBuffer {

    //! How often compute() actually buffers a sample. compute() still runs
    //! at 1Hz; this is the subset that gets kept.
    //!
    //! This number is not free to change on its own. Connect IQ won't fire
    //! a temporal event more often than every 5 minutes (see
    //! EdgeTrackerApp), so one flush has to carry everything produced in
    //! 300 seconds or the queue grows forever:
    //!
    //!     produced per flush = 300 / SAMPLE_INTERVAL_S
    //!     MAX_BATCH_SIZE must be comfortably greater than that
    //!
    //! At 1Hz that was 300 produced against a 60-sample batch - a deficit
    //! of 240 every five minutes, permanently. Because the queue drains
    //! oldest-first, the server was therefore always being sent the START
    //! of the ride, and the "live" heart rate and power on the site sat on
    //! the first minute's values and fell further behind at five times real
    //! time. That is the second half of what the test ride showed.
    //!
    //! At 10s: 30 produced per flush against a batch of 60, so a flush
    //! clears the backlog and has 2x headroom to catch up after a
    //! blackspot. 10s is finer than anything downstream consumes anyway -
    //! the map decimates the whole ride to 2000 points (~285m apart), and
    //! 10s at 30km/h is 83m.
    //! 30s, giving 10 samples per five-minute flush window against a batch
    //! of 20 - so a flush clears the backlog twice over.
    //!
    //! This started at 1Hz, went to 10s when the queue couldn't drain, and
    //! is now 30s because the background process kept running out of memory
    //! assembling the batch even after samples became positional arrays.
    //! Each step was a real, logged failure rather than caution.
    //!
    //! What 30s costs is close to nothing: the map decimates the whole ride
    //! to 2000 points, about 285m apart, and 30s at 30km/h is 250m. The
    //! sensor readouts only refresh every 5 minutes regardless, because
    //! that's how often the device can send at all.
    const SAMPLE_INTERVAL_S = 30;

    //! 10 minutes at SAMPLE_INTERVAL_S, and no more, because every slot is
    //! a separate Storage key holding a whole sample and an app's persisted
    //! storage is a small device-specific budget.
    //!
    //! This was 180 (30 minutes) and that was too much. At roughly 600
    //! bytes a sample - measured, not guessed: the old single-array queue
    //! reached 1.1MB at 1800 samples - 180 slots is ~108KB, and on top of
    //! a legacy blob that hadn't been cleared it put the app over its
    //! quota. Storage.setValue then failed with "Illegal Access (Out of
    //! Bounds)" inside push(), killing the data field. 60 slots is ~36KB.
    //!
    //! Losing buffer depth costs little: a flush drains MAX_BATCH_SIZE
    //! anyway, so the ring holds exactly one batch, and position during a
    //! dropout is covered by the phone's Traccar feed regardless (see
    //! mergePosition in the server's trackerDb.ts).
    const CAPACITY = 40;

    //! Bumped whenever the shape of what's kept in Storage changes. On a
    //! mismatch everything is cleared, which is the only reliable way to be
    //! rid of a previous layout - deleting known keys one by one can't
    //! touch what it doesn't know about, and this app has already
    //! accumulated two dead layouts: the original 1.1MB "sampleQueue"
    //! array, and slot keys s60..s179 orphaned by the CAPACITY change
    //! above. Both would otherwise sit in the quota forever.
    //! 3: samples became positional arrays rather than dictionaries. A
    //! buffer written by version 2 would be sent to the server in the
    //! wrong shape entirely, so the bump matters - it isn't only about
    //! reclaiming space.
    //! 4: CAPACITY dropped from 60 to 40, which orphans slots s40..s59 -
    //! nothing reads them and nothing would ever delete them by name.
    const SCHEMA_KEY = "schemaV";
    const SCHEMA_VERSION = 4;

    //! The background process's memory budget is the binding constraint
    //! here - not the server's 256KB body limit, and nothing on the wire.
    //!
    //! It is also far smaller than estimated. 60 dictionaries ran it out of
    //! memory in peekBatch at every temporal event. Samples became
    //! positional arrays, roughly a third the size, and 40 of those still
    //! did - same function, same crash, logged at 15:50:55Z. Two failed
    //! estimates is enough: 20 is chosen to be obviously, unarguably under
    //! the limit rather than shaved to what should fit.
    //!
    //! Still twice what a five-minute window produces at
    //! SAMPLE_INTERVAL_S, so the queue drains completely on every flush and
    //! has headroom to catch up after a blackspot.
    const MAX_BATCH_SIZE = 20;

    const HEAD_KEY = "qHead";
    const TAIL_KEY = "qTail";
    const STATUS_KEY = "lastFlushStatus";
    const SEQ_KEY = "batchSeq";

    function counter(key as String) as Number {
        var value = Storage.getValue(key) as Number or Null;
        return value == null ? 0 : value;
    }

    function slotKey(index as Number) as String {
        return "s" + (index % CAPACITY).toString();
    }

    //! Returns false if the sample couldn't be stored, rather than throwing.
    //!
    //! This runs inside the data field's compute(), so an exception escaping
    //! here doesn't lose one sample - it kills the field for the rest of the
    //! ride. That is exactly what happened when storage filled up: a failed
    //! setValue took the whole app down mid-ride. A dropped sample is a
    //! rounding error against a 570km attempt; a dead tracker is not.
    function push(sample as Array) as Boolean {
        try {
            var head = counter(HEAD_KEY);
            var tail = counter(TAIL_KEY);

            Storage.setValue(slotKey(tail), sample);
            tail += 1;

            // Full: the write above has already landed on the oldest slot,
            // so head has to move with it rather than pointing at a sample
            // that no longer exists.
            if (tail - head > CAPACITY) {
                Storage.setValue(HEAD_KEY, tail - CAPACITY);
            }
            Storage.setValue(TAIL_KEY, tail);
            return true;
        } catch (e) {
            return false;
        }
    }

    //! Clears everything if the stored layout isn't the current one.
    //!
    //! Storage.clearValues() rather than deleting the keys this version
    //! happens to know the names of - the whole problem is the keys it
    //! doesn't. Called from onStart, and safe to call every time: after the
    //! first run the version matches and this does nothing.
    function resetIfSchemaChanged() as Void {
        try {
            var stored = Storage.getValue(SCHEMA_KEY);
            if (stored == null || !(stored instanceof Lang.Number) || stored != SCHEMA_VERSION) {
                Storage.clearValues();
                Storage.setValue(SCHEMA_KEY, SCHEMA_VERSION);
            }
        } catch (e) {
        }
    }

    function bufferedCount() as Number {
        return counter(TAIL_KEY) - counter(HEAD_KEY);
    }

    function lastStatus() as Number {
        return counter(STATUS_KEY);
    }

    function setLastStatus(code as Number) as Void {
        Storage.setValue(STATUS_KEY, code);
    }

    //! Reads up to maxSize samples WITHOUT removing them - the queue only
    //! moves when commitBatch() is called after the server has confirmed
    //! it stored them.
    //!
    //! The previous version removed the batch up front and relied on the
    //! HTTP callback to put it back on failure. That silently lost 60
    //! samples every single time the callback never ran at all - which is
    //! precisely what happens with no phone tethered, the one failure mode
    //! the README calls out as most likely. Nothing is deleted here until
    //! it is known to be safely stored.
    function peekBatch(maxSize as Number) as Array {
        var head = counter(HEAD_KEY);
        var tail = counter(TAIL_KEY);
        var count = tail - head;
        if (count > maxSize) {
            count = maxSize;
        }

        var batch = [] as Array;
        for (var i = 0; i < count; i++) {
            var sample = Storage.getValue(slotKey(head + i));
            // A slot can be empty if the ring wrapped past it while this
            // was being read - skip rather than sending a null the server
            // would only reject.
            if (sample != null) {
                batch.add(sample);
            }
        }
        return batch;
    }

    //! Advances past a batch the server has acknowledged, freeing its
    //! slots. Resending anything already stored is harmless anyway -
    //! api/ingest.ts upserts with ON CONFLICT DO NOTHING - so erring
    //! towards retaining is always the safe direction here.
    function commitBatch(count as Number) as Void {
        var head = counter(HEAD_KEY);
        var tail = counter(TAIL_KEY);
        var next = head + count;
        if (next > tail) {
            next = tail;
        }
        for (var i = head; i < next; i++) {
            Storage.deleteValue(slotKey(i));
        }
        Storage.setValue(HEAD_KEY, next);
    }

    function nextBatchSeq() as Number {
        var next = counter(SEQ_KEY) + 1;
        Storage.setValue(SEQ_KEY, next);
        return next;
    }
}
