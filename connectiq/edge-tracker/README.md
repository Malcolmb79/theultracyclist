# Edge 1040 tracker

Reads position, altitude, distance, speed, power, heart rate, and cadence
once a second and ships it to `theultracyclist.com/api/ingest`, which feeds
the public `/live` page. Built after `../visibility-test` answered the one
question that mattered first: `compute()` keeps running whether or not this
field's page is the one on screen (see that project's README), so there's
no "leave this page displayed" requirement here.

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
3. Connect the Edge by USB. It mounts as an MTP device (not a drive
   letter), so copying the `.prg` needs File Explorer's GUI, not a shell
   `cp` - drag it into `Internal Storage/Garmin/Apps/`.
4. Unplug - MTP devices don't need a formal eject.

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
below). `BUF` climbing steadily with `HTTP` stuck at 0 or a non-200 value
means the token's wrong, there's no phone tethering, or the batches
aren't reaching the server; `HTTP` reading 200 with `BUF` staying low
means it's working.

## The one thing this can't fix

Sending HTTP mid-ride depends on the Edge tethering to a **phone running
Garmin Connect Mobile in the background with cellular data** - the Edge's
own WiFi won't be connected while moving on a bike. That phone needs to
stay powered, connected, and not have Connect Mobile force-closed for the
whole attempt. Worth its own line on the pre-start checklist, same as
`../visibility-test`'s result was.
