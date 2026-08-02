# Edge 1040 tracker

Reads position, altitude, distance, speed, power, heart rate, and cadence
every 10 seconds and ships it to `theultracyclist.com/api/ingest`, which
feeds the public `/live` page. Built after `../visibility-test` answered the
one question that mattered first: `compute()` keeps running whether or not
this field's page is the one on screen (see that project's README), so
there's no "leave this page displayed" requirement here.

## Why 10 seconds, and why the numbers on the site lag

Connect IQ will not fire a background temporal event more often than every
5 minutes, and a data field cannot make web requests from its foreground at
all - so the *only* way data leaves this device mid-ride is one batch every
5 minutes. Two consequences worth knowing before reading the site:

- **Sensor readings on `/live` are up to 5 minutes old.** That is a
  platform floor, not something the code can improve. The map's telemetry
  card is captioned with the age for that reason. Position is separate and
  much fresher, because the phone's Traccar feed carries it.
- **The sampling rate has to fit through that batch.** One flush must carry
  everything produced in 300 seconds, so `SAMPLE_INTERVAL_S` and
  `MAX_BATCH_SIZE` in `SampleBuffer.mc` are a matched pair - see the
  comments there. The first version sampled at 1Hz and sent 60 per flush,
  which produced 240 more samples than it could send every five minutes,
  forever, and drained oldest-first - so the site sat on the opening
  minute's heart rate and power and fell further behind as the ride went
  on.

## Build and sideload

Needs the Connect IQ SDK, the Monkey C extension for VS Code, and a
developer key - this project reuses the same key already generated for
`../visibility-test` rather than a new one (a developer key identifies you,
not a single app, so one is enough for every app you sideload yourself).

1. Open this folder in VS Code (make sure it's a **trusted** workspace -
   Restricted Mode silently disables the Monkey C extension's commands).
2. `Ctrl+Shift+P` → **Monkey C: Build for Device**. Since the manifest only
   declares `edge1040` as a product, there's nothing to pick - it just
   builds. (Or from the command line:
   `monkeyc -f monkey.jungle -d edge1040 -o bin/EdgeTracker.prg -y ../visibility-test/developer_key.der`.)
3. Connect the Edge by USB. It mounts as an MTP device with no drive
   letter, so a shell `cp` can't reach it - but File Explorer's GUI isn't
   the only option either. PowerShell's `Shell.Application` COM object
   works, which is worth knowing because it makes sideloading scriptable:

   ```powershell
   $src   = "bin\EdgeTracker.prg"
   $shell = New-Object -ComObject Shell.Application
   $dev   = $shell.NameSpace(0x11).Items() | Where-Object { $_.Name -eq 'Edge 1040' }
   $apps  = $dev.GetFolder.Items() |
            Where-Object { $_.Name -like 'Internal*' } |
            ForEach-Object { $_.GetFolder.Items() | Where-Object { $_.Name -eq 'Garmin' } } |
            ForEach-Object { $_.GetFolder.Items() | Where-Object { $_.Name -eq 'Apps' } }
   $apps.GetFolder.CopyHere($src, 0x14)
   ```

   Avoid `InvokeVerb("delete")` on anything - it blocks on a confirmation
   dialog with no way to answer it.
4. Unplug - MTP devices don't need a formal eject.
5. **Restart the Edge.** The `.prg` sits in `Garmin/Apps/` until then and
   the old build keeps running. You can confirm it installed by listing
   that folder again: the device consumes the file on boot, so the `.prg`
   disappearing is the signal it took.

## Reading crash logs

`Garmin/Apps/LOGS/CIQ_LOG.YML` is the first place to look when the field
stops updating or `HTTP` never reaches 200. It gives the error and a real
stack with file and line numbers, and it found every bug in this app
faster than reasoning from the on-screen status did - an out-of-memory in
`takeBatch`, an illegal access in `onStart`, another out-of-memory in
`peekBatch`. Pull it the same way as above but with `CopyHere` on a local
folder's namespace, or just drag it off in Explorer.

Sizes worth sanity-checking while you're in there: `Garmin/Apps/DATA/
EdgeTracker.DAT` is the app's persisted storage. It should be tens of KB.
If it's approaching a megabyte, something is writing without bound.

## Configure the server token

`api/ingest.ts` authenticates every batch with a bearer token
(`INGEST_TOKEN` in Vercel). The obvious place to put a per-device secret
is a Connect IQ app setting (`Application.Properties`) - **that doesn't
work here**: both Garmin Connect Mobile and Garmin Express only show a
settings UI for an app with Connect IQ Store metadata behind its App ID,
and a purely local, never-published sideload like this one has none (no
"..." menu appears for it in either app - compare it to an actual Store
app like Training Edge in the same list, which does have one). There is
no on-device or companion-app path to enter a value at all.

Instead the token is a compile-time constant, gitignored so it never
reaches git:

1. Copy `source/Secrets.mc.example` to `source/Secrets.mc`.
2. Set `INGEST_TOKEN` in it to the same value as Vercel's `INGEST_TOKEN`
   (Project Settings → Environment Variables).
3. Rebuild - the token is now baked into the `.prg`.

Same "never commit the real secret" reasoning as `developer_key.der`,
just via a gitignored source file instead of a keypair.

## Adding the field on the device

On the Edge: add **Ultra Cyclist Tracker** as a field on any data page.
It reads `BUF/HTTP` - how many samples are currently buffered waiting to
go out, and the last background-send HTTP response code (0 before the
first attempt, which won't happen until ~5 minutes into the ride - see
below).

What to expect on a healthy ride: `BUF` climbs to about 30 over five
minutes, `HTTP` flips to `200`, and `BUF` drops back to near zero. Then it
repeats.

- **`BUF` stops changing entirely** - `compute()` has stopped running, i.e.
  the app has died. This is what the first test ride hit, from an unbounded
  per-tick rewrite of the whole queue in `Application.Storage`; it is fixed,
  but the symptom is worth recognising.
- **`BUF` climbs past ~60 and keeps going, `HTTP` at 0 or non-200** - the
  batches aren't landing. Wrong token, no phone tethering, or the server is
  unreachable. Nothing is lost while this persists: samples stay queued
  until the server confirms it stored them, and the buffer holds 30 minutes
  before it starts dropping the oldest.
- **`HTTP` is 200 but `BUF` never falls** - shouldn't be possible now that
  a flush drains more than an interval produces; if it happens, the two
  constants in `SampleBuffer.mc` have drifted apart.

## The one thing this can't fix

Sending HTTP mid-ride depends on the Edge tethering to a **phone running
Garmin Connect Mobile in the background with cellular data** - the Edge's
own WiFi won't be connected while moving on a bike. That phone needs to
stay powered, connected, and not have Connect Mobile force-closed for the
whole attempt. Worth its own line on the pre-start checklist, same as
`../visibility-test`'s result was.
