# Local models: drag-and-drop loading

Dropping a `.nam` file, an IR `.wav`, or a folder of them on an insert slot
loads it as a local block, no browser or account involved. The design goal
is that local files are a second-class *entry point*, not a second-class
block: after the drop they ride the exact catalog pipeline (background load,
in-memory model cache, undo, duplication, presets, DAW state), and the code
branches on "local" in only a handful of places.

Entry points: `handleDropFile` in `ui/src/hooks/useToneLoadFlow.ts` and
`loadLocalTone` in `plugin/src/ProcessorModelLoader.cpp`. Behavior is pinned
by `test/src/local_load_tests.cpp`.

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
- **Self-healing.** Presets and DAW state embed the model bytes
  (`ModelCache`), so they reopen without the stash, on any machine. When
  such a load hits the embedded cache and the stash copy is missing (GC'd,
  or a different machine), `refreshLocalStashCopy` writes it back, so undo
  and retry keep working there too.
