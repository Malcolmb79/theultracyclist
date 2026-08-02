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
(`INGEST_TOKEN` in Vercel). Garmin Connect IQ apps have no way to read an
environment variable at build time that isn't compiled into the shipped
`.prg` and therefore into git history if committed - so this app reads the
token from a **Connect IQ app setting** instead, set on the phone, never
hardcoded:

1. On the paired phone, open Garmin Connect Mobile → the connected Edge
   1040 → **My Device** → **Data Fields / Connect IQ Store apps** →
   **Ultra Cyclist Tracker** → **Settings**.
2. Enter the same value as `INGEST_TOKEN` in Vercel (Project Settings →
   Environment Variables) into **Server token**.

Without a token set, the field still runs and buffers samples locally (up
to 30 minutes' worth) but never sends anything - setting the token later
mid-ride flushes whatever's accumulated since the field was added, nothing
is lost by configuring it late.

## Adding the field on the device

On the Edge: add **Ultra Cyclist Tracker** as a field on any data page.
It reads `SENT/BUF/HTTP` - total samples successfully sent, how many are
currently buffered waiting to go out, and the last HTTP response code (0
before the first flush attempt). `BUF` climbing steadily with `HTTP` stuck
at a non-200 value means the token's wrong or the batches aren't reaching
the server; `SENT` climbing with `BUF` staying low means it's working.

## The one thing this can't fix

Sending HTTP mid-ride depends on the Edge tethering to a **phone running
Garmin Connect Mobile in the background with cellular data** - the Edge's
own WiFi won't be connected while moving on a bike. That phone needs to
stay powered, connected, and not have Connect Mobile force-closed for the
whole attempt. Worth its own line on the pre-start checklist, same as
`../visibility-test`'s result was.
