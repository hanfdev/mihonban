# Mihonban Native Windows Client

This directory contains the native Rust desktop client. It draws its own interface with `egui`, talks directly to the Mihonban HTTP API with `reqwest`, and decodes supported audio formats locally with `rodio`/Symphonia. It does not embed a browser or load the Mihonban web application.

The client supports multiple Mihonban service profiles. The service address is editable in Settings, passwords are stored in Windows Credential Manager, and the optional client update manifest is independent from Mihonban server releases.

The client starts maximized on its monitor, respecting Windows display scaling and the taskbar work area. The startup viewport deliberately omits a fixed inner size: eframe 0.29 applies that size after creating the maximized window, which can shrink the window without clearing its maximized state.

The connection card sizes itself to its content and stays centered in the area below the navigation bar, including when translated text or an error changes its height. A compact server badge displays the host, port, and deployment path; its tooltip retains the full address. Failed connections offer Retry and Settings directly.

The interface follows Mihonban's dark archival/vinyl design: a fixed header, centered search, cover wall, album hero and track list, plus a persistent native player. Covers and audio use a persistent per-profile cache. Settings expose the cache folder, a 1-200 GB limit, current usage, cache clearing, and an Explorer shortcut. Cache entries use atomic writes and least-recently-used eviction; a file larger than the configured limit is played once without being retained.

Artist avatars use a centered, aspect-preserving crop in both the artist grid and detail page, matching the Web client's `object-fit: cover` behavior for landscape and portrait photos.

On Windows, minimizing hides the client to its native system tray icon by default; playback and queue progression continue in the background. Double-click the original Mihonban icon or choose Show main window from its right-click menu to restore the window. The menu also provides Play/Pause and Exit. Settings → Window behavior saves independent options for minimizing and closing to the tray. Closing still exits by default, and the tray's Exit command always quits. If tray initialization fails, normal window behavior remains available.

The default cache is under the Windows local application-data directory. Changing the folder or limit only affects the native client and never changes the Mihonban server or its storage.

Settings use the same warm black surfaces, serif headings, fine borders, and orange actions as the library. The centered page switches between a service form with a window/update sidebar and stacked full-width cards on smaller windows. Native input fields, keyboard-accessible switches, wrapped action rows, and a local-storage usage meter support all seven interface languages. Save the cache settings to apply changes to its switch, directory, or size limit; window-to-tray options continue to save automatically.

Delete a server profile from the service card. A confirmation dialog identifies the saved profile and address, defaults to Cancel, and requires an explicit second confirmation. At least one profile is retained. Removing the selected profile switches to another saved profile and stops its playback; it does not delete server music, favorites, or local cached media. Saved credentials are removed unless another profile still shares the same credential name.

The disk cache and decoded image memory are separate. Decoded covers and artist photos use an LRU texture budget that scales with the visible cover count (40–72 MiB, covering a 4K display at 200% scaling), and gallery images use a 16 MiB budget. Pending uploads honor the preceding frame's visible textures before a new visibility pass begins. Eviction drops the native texture handles; returning to an image reloads it from the disk cache. Only visible gallery/recommendation cards request images. At most two image downloads, decodes, or queued decoded results are retained at a time, and decoding/resizing runs outside the UI thread. Covers/photos keep their aspect ratio within 512 px; gallery images are bounded to 2048 px. The original cover shading remains unchanged, while artist photos no longer allocate an unused shaded copy. These budgets cover image texture payloads, not the entire process, graphics driver, fonts, or temporary decoding allocations.

To inspect the texture budget for an existing local media cache without network access, run `cargo run --locked --example texture_memory_probe -- <cache-directory>`. The report estimates decoded RGBA payloads from actual image dimensions and simulates the production LRU policy; it is not a process working-set measurement.

The album wall virtualizes rows: only the viewport and one adjacent row on each side create card widgets, while equal-height spacers preserve the complete scroll range. Filtering and sorting reuse a shared index list until a filter or the library changes; decade, artist, and genre options are rebuilt only when library data changes. Card interaction IDs follow album identity so hover and click state remain stable when rows enter the viewport. Native smooth wheel input, card animation timings, and the existing right-edge scrollbar styling stay in place.

Disk-cache hits update LRU access times in memory and save them with the next cache mutation instead of rewriting the full index for each image. Failed images wait 30 seconds before retrying, avoiding continuous requests for missing artwork. Run `cargo run --release --locked --example scroll_layout_probe` for a headless comparison of full-grid and virtualized egui layout. This synthetic CPU benchmark checks visible-card and scroll-height equivalence; it does not measure application FPS, GPU rendering, image decoding, or wheel input latency.

The player follows the Web layout: the compact bar places artwork, track details, transport controls, seek bar, and volume on one row. Selecting the artwork opens Now Playing with a blurred cover backdrop, centered two-column composition, and an orange play control during playback. Track titles open the album, artist names open the artist, and Escape collapses Now Playing. Space toggles playback in either player view.

Both player views share shuffle, repeat-off/repeat-all/repeat-one, and mute controls. Shuffle visits each queued track once before stopping or repeating, and Previous retraces that order. Seeking previews the time during a drag and commits on release. Focused seek bars support arrow keys (five seconds, or thirty with Shift) and Home/End; volume supports arrow keys and restores the previous audible level after muting.

Audio files use Rodio's file-aware decoder constructor so the decoder receives the complete file length and seekability. This allows FLAC seeking when the file has no seek table. Playback position comes directly from the audio sink; a failed seek displays a short notice instead of being hidden by a temporary position override. The seek regression fixture contains generated audio without a seek table, and tests compare samples after forward and backward seeks against sequential decoding. For an additional check with real audio output and complete local files, run `cargo run --locked --example seek_backend_probe -- <audio-file> [<audio-file> ...]`.

Build and run the optimized Windows client:

```powershell
cargo run --release
```

The release profile favors a smaller executable. Bundled fonts are compressed into the release executable and decompressed when the client starts, preserving the client's typography across supported interface languages and music metadata. Debug executables are larger because they include unoptimized code for development. Release executables use the Windows GUI subsystem and open without a terminal window.

The optional Update source URL is provided by the Windows client publisher. Leave it empty if no release channel has been provided; it is separate from the Mihonban service address and does not update the server. Check for updates reads version metadata, and Download and verify stages the new executable for manual replacement rather than silently installing it.

The update source points to a small JSON document hosted by the client release channel, for example:

```json
{
  "latest": "0.2.0",
  "download_url": "https://example.invalid/Mihonban-0.2.0.exe",
  "sha256": "...",
  "notes": "..."
}
```
