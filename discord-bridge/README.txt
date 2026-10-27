Ultra Cyclist Discord bridge
============================

Shows your Discord voice channel in the Ultra Cyclist "Discord voice"
overlay in Sauce for Zwift: who's in it, who's talking, who's muted.

Discord only shares this with programs on your computer, not web pages,
so this small helper passes it on to the overlay. Nothing leaves your
computer except signing in to Discord.

ONE-TIME SETUP
1. Install Node.js (the LTS version) from https://nodejs.org
2. Make your own Discord application:
   - Go to https://discord.com/developers/applications -> New Application
     (any name, e.g. "Ultra Cyclist overlay").
   - OAuth2: copy the Client ID; click Reset Secret and copy the Client Secret.
   - OAuth2 -> Redirects: add  http://localhost  and save.
3. Unzip this folder anywhere (e.g. Documents\UltraCyclistDiscord) and
   double-click start.bat. Paste the Client ID and Secret when asked.
4. Discord pops up asking to let your application read your voice
   channel - click Authorise. (Only the first time.)

EACH RIDE
- Have Discord running, double-click start.bat, and leave its window open.
- In Sauce, open the "Ultra Cyclist Discord Voice" window.
- Join a voice channel in Discord - it shows up straight away.

To start it with Windows: press Win+R, type  shell:startup , and put a
shortcut to start.bat in that folder.

Your Client ID and Secret are kept in config.json, and Discord's sign-in
in token.json, both in this folder. Delete token.json to sign in again.
The overlay reads the bridge at http://127.0.0.1:8723 - change "port" in
config.json (and in the overlay's settings) if something else uses it.
