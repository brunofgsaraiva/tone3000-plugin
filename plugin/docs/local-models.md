# Local models: drop / picker loading

A local `.nam` file, an IR `.wav`, or a folder of them loads as a local
block, no browser or account involved: dropped on a tile, or picked via the
tile context menus' **Load File / Load Folder** (a native OS file dialog).
The design goal is that local files are a second-class *entry point*, not a
second-class block: once in, they ride the exact catalog pipeline
(background load, in-memory model cache, undo, duplication, presets, DAW
state), and the code branches on "local" in only a handful of places.

Entry points: `handleDropFile` in `ui/src/hooks/useToneLoadFlow.ts` →
`loadLocalTone` in `plugin/src/ProcessorModelLoader.cpp` (drops), and the
tiles' menus → `pickLocalToneFile` on the editor → `loadLocalTonePath`
(picker). Behavior is pinned by `test/src/local_load_tests.cpp`.

## The drop

The stock OS webviews never expose file paths to the DOM (no Electron-style
`webUtils.getPathForFile`), so the UI reads the dropped bytes and ships them
over the bridge as base64, one `{ name, data }` entry per file. Folders are
walked recursively; the majority extension decides NAM vs IR, the folder
name becomes the tone title, and each file becomes one model named after it
(300 max, matching the catalog's per-tone model limit).

Native validates each file at drop time (`.nam` must parse and pass the A2
shape check, `.wav` must open as real audio) so a bad file is a toast, never
a retry badge. Survivors are stashed (below) and wrapped in a synthetic tone
JSON: `id: 0`, `local: true`, and each model's `model_url` pointing at its
stash copy with a `file://` URL. From there `loadTone` takes over, and
`fetchModelFromUrl` resolves `file://` URLs from disk instead of the
network.

## The picker

Right-clicking a tile offers **Load File** / **Load Folder**: a native
`juce::FileChooser` on the editor (`pickLocalToneFile`), whose pick feeds
`loadLocalTonePath`, the path-based sibling of `loadLocalTone` that reads
bytes straight from disk (no base64 bridge trip) and then converges on the
same validate/stash/load pipeline. The folder rules the UI implements for
drops (majority extension, 300-file / 50 MB caps, natural name order, title
from the folder name) live natively in `loadLocalTonePath` for this flow.
An insert slot adds and a tone tile swaps in place, the same targeting as a
drop.

The picker isn't sugar: it's the local-load route that works everywhere.
Linux never delivers OS file drags to the embedded WebKitGTK view (XDnD
dies at the embedded `GtkPlug`, below the DOM, so no drop event ever fires;
[issue #22](https://github.com/tone-3000/tone3000-plugin/issues/22)), so on
that platform the menu is how local files get in at all. It also covers
users who never think to drag-drop, and works signed out.

## One stored model list, one exception

Catalog tones store only the *active* model natively; the picker pages the
full catalog from the API. Local tones have no API, so their model list is
the dropped files and stays whole in the stored tone JSON:
`parseToneForLoading` and `switchModel` skip their pruning for local tones,
and the tone summary ships each local model's `model_url` so the picker can
drive switches (which also work signed out; nothing downloads).

## The stash

`<app-data>/TONE3000/LocalModels/<content-hash>-<size>.<ext>` is the local
equivalent of "the server": the copy that cache-lost reloads (undo after a
remove, retry) re-fetch from, stable even after the user's original file
moves. Content-addressed names dedupe re-drops.

Its lifecycle is self-maintaining:

- **Liveness is mtime.** Every use re-stamps the file: stash writes, reads
  in `fetchModelFromUrl`, and cache-hit loads via `refreshLocalStashCopy`.
- **GC.** `cleanLocalModelStash` (once per process, off-thread) deletes
  stash files unused for a week. Clearing on startup would be wrong:
  instances in other processes may still hold undo history that references
  the files by path.
- **The name is the address.** A block's `model_url` persists the stash
  path absolutely, in presets, DAW/app state and undo snapshots. Reads go
  back through `resolveLocalModelFile`, which falls back to the same file
  name under the *current* stash root when the stored path is gone. That is
  a no-op on desktop (the root never moves) and is what keeps iOS working:
  the app data container's UUID rotates on every reinstall or app update.
- **Self-healing.** Presets and DAW state embed the model bytes
  (`ModelCache`), so they reopen without the stash, on any machine. When
  such a load hits the embedded cache and the stash copy is missing (GC'd,
  or a different machine), `refreshLocalStashCopy` writes it back, so undo
  and retry keep working there too.

## Getting the catalog identity back

A `.nam` trained on TONE3000 usually reaches the plugin as a bare file:
downloaded once, filed away, dropped in months later. It still knows what it
is — every such file carries `metadata.name` (the model's name) and
`metadata.modeled_by` (the author's username) — but it carries no tone id,
so the catalog entry has to be *found*. When it is, the tile shows the real
artwork, title, gear and author instead of the generic file glyph.

Nothing about playback changes: the block still plays its stash copy, still
works offline, and still needs no account to load. The lookup is pure
decoration, and it runs after the file is already loaded and audible.

`stashLocalBytes` lifts those two strings onto the model object
(`nam_name` / `nam_author`) while it's already parsing the file for the A2
check. `useLocalToneIdentity` does the rest, in the UI, because that's where
the OAuth token lives:

1. `tones/search?query=<nam_name>`, one call.
2. Keep the hits whose `user.username` is `nam_author`. The author is the
   discriminator, not the title: a tone's title and its models' names are
   usually different ("Fender Vibroverb 1964 - Dumble - Two-Rock - John
   Mayer" vs the model's much longer name). With no author on the file, fall
   back to tones whose title the model name starts with. At most 3 survive.
3. For each, list the tone's A2 models and take the one whose `name` is
   `nam_name` (or the tone's only model).
4. Download that one model and check its bytes against the local file's.

Step 4 is the point. Names are not unique and a near-miss would put someone
else's artwork on the tile, so the match is proved by content or not at all.
The comparison is FNV-1a 64 plus the exact byte length, against the stash
file's own name (`<hash>-<size>.nam`, above): the webview can't read the
local bytes — they're behind a `file://` URL the DOM won't touch — so the
only hash the UI can compare against is the one native already published in
the `model_url`. Hashing just the *downloaded* bytes closes the loop with no
new native surface. This is a "did we find the right tone" check rather than
a security boundary; the bytes that play are always the local ones, and the
worst case is the generic glyph.

On a match, `refreshToneMetadata(toneJson, blockId)` writes the catalog
payload onto that one block. The block-targeted form exists for this: the
ordinary catalog sync matches on tone id (0 for a local tone) and refuses to
touch local blocks at all. Native keeps the block's own `models` array and
its `local` flag, so an adopted block keeps its `file://` model URLs, keeps
playing from the stash, and stays exempt from the id-matched sync even
though it now carries a real tone id. Because the merged JSON is stored tone
JSON, the identity rides into DAW/app state, presets and undo — it survives
restarts and later offline use with no sidecar file.

Watching chain state instead of hooking a load path is what makes this work
for every entry point at once: drops come through the UI, the tile menus'
Load File / Load Folder never touch it, and state restore has no load call
at all. An adopted block has artwork, so re-runs skip it.

The budget per file is one search, at most three model listings and one
download, attempted once per session — a miss, an outage or a signed-out
user never turns into repeat traffic. Every failure is silent and leaves the
file glyph. Only single-file local tones are looked up; a dropped folder is
the user's own grouping, not a catalog tone. The pure selection rules are
pinned by `ui/test/localToneIdentity.test.ts` (`npm test` in `ui/`), and the
native side by `ToneRefreshTest.BlockTargetedRefreshAdoptsIdentityAndStaysLocal`.
