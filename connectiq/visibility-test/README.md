# Connect IQ visibility test

One question, answered on the actual Edge 1040 and the actual firmware, before
anything is built on top of it:

**Does `compute()` keep being called while the data field is not the page on
screen?**

On many Garmin devices it does not. If that holds here, then scrolling to
another data page mid-attempt silently stops the feed — the public tracker
would show a rider frozen somewhere in the midlands, with no error anywhere to
explain it. The mitigation is easy (leave a dedicated page displayed for the
whole ride), but it has to be a decision written into the pre-start checklist,
not something discovered at hour three.

## Build and sideload

Needs the Connect IQ SDK, the Monkey C extension for VS Code, and a developer
key. See the parent conversation, or
<https://developer.garmin.com/connect-iq/sdk/>.

1. Open this folder in VS Code.
2. `Ctrl+Shift+P` → **Monkey C: Build for Device** → `edge1040`.
3. Connect the Edge by USB. It mounts as a normal drive.
4. Copy the built `.PRG` into `GARMIN/APPS/` on the device.
5. Eject and unplug.

If the build complains about the manifest or the API level, run
`Monkey C: New Project` (type: Data Field), then drop `source/*.mc` into that
skeleton instead. The wizard writes a manifest matched to the SDK you actually
installed, which is more reliable than the one committed here.

## Running the test

1. On the Edge: add **CIQ Visibility Test** as a field on a data page.
2. Start recording an activity. Indoors is fine — it needs no GPS and no
   sensors.
3. Watch the field for ~30 seconds. It reads `COUNT/SECS/MAXGAP`.
4. Scroll to a **different** data page. Leave it there **five minutes**.
5. Scroll back and read the three numbers.

## Reading the result

```
COUNT / SECS / MAXGAP
```

- `COUNT` — how many times `compute()` has been called
- `SECS` — seconds since the first call
- `MAXGAP` — the longest silence between two consecutive calls

`compute()` is called about once per second, so:

| Result | Meaning | Consequence |
|---|---|---|
| `COUNT ≈ SECS`, `MAXGAP ≈ 1` | It ran the whole time, hidden or not | No mitigation needed — any data page is fine |
| `COUNT` well below `SECS`, `MAXGAP ≈ 300` | It paused for the whole five minutes | The field's page must stay displayed for the entire attempt |

A `MAXGAP` near 300 after a five-minute excursion is the unambiguous version of
the answer — it says exactly how long the device stopped calling us for.

Report both numbers back; they decide how the real field buffers, and whether
"leave this page up" goes on the pre-start checklist.
