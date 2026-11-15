# Install-guide recording — run notes

Recorded 2026-11-15 ~00:25 Asia/Dhaka, real Google Chrome for Testing
158.0.8127.18 under Xvfb :99, fresh profile (`profile-install`).
Every frame in `install.mp4` and the 7 PNGs is a real frame from this
recording — nothing staged, no stills inserted, no speed-up (only
head/tail trimming: 2.8s of black pre-roll and the browser-close tail
cut; final video 60.2s).

## What the run proved (observed, not assumed)

- GitHub release page `v1.0.0-dev-20261115` loaded; asset
  `hiddengem-flow-extension.zip` downloaded (1,144,509 bytes) and its
  sha256 matched `12acf1aab667677110c50bdc6ef7c56532d41ff9caac81c532b67e54c21c86a2`.
- Zip extracted; `manifest.json` present in `hiddengem-flow-extension/`.
- `chrome://extensions` → Developer mode turned ON (real mouse click).
- "Load unpacked" → native GTK file picker → navigated
  Home → workspace → hgf-install-demo → selected
  `hiddengem-flow-extension` → Open.
- Extension installed: card "HiddenGem Flow 1.0.0" listed, service worker
  alive, extension id `pneahnlhdgcicnmeobifpdlllpikoagg`.
- Details page → "Allow User Scripts" turned ON (verified: the correct
  toggle in `extensions-toggle-row#allow-user-scripts`, and
  `chrome.userScripts.getScripts()` stopped throwing).
- Example.com → clicked the toolbar gem icon (located at runtime by
  template-matching `icon16.png`, score 0.984) → floating window opened:
  "HiddenGem Flow", "On: example.com", "DAILY TASKS", "User Scripts: ON".
- 0 page errors during the whole run.

## Files

- `install.mp4` — 60.2s, 1280x720, H.264, 609,481 bytes (< 25 MB GitHub limit)
- `01-release-download.png` — release page, Assets with the zip + sha256 (316 KB)
- `02-extracted-folder.png` — file:// listing of the extracted folder (249 KB)
- `03-developer-mode.png` — chrome://extensions, Developer mode ON (196 KB)
- `04-load-unpacked.png` — file picker, folder selected (59 KB)
- `05-extension-loaded.png` — HiddenGem Flow 1.0.0 details card (219 KB)
- `06-allow-user-scripts.png` — "Allow User Scripts" toggle ON (251 KB)
- `07-floating-window.png` — floating window on example.com (303 KB)

Frame timestamps (final video): 01@11.51s, 02@17.79s, 03@22.54s,
04@33.20s, 05@38.71s, 06@43.26s, 07@53.29s. Full step log with
timestamps: `~/workspace/hgf-install-demo/run-log.json`.

## Honest limitations

- The recording is Chrome for Testing, so a "Chrome for Testing
  v158.0.8127.18 is only for automated testing" banner shows at the top
  of pages and the download bubble shows the browser's temp filename
  (a UUID) instead of the zip name. The install steps themselves are
  identical to a normal Chrome.
- The GTK file picker is taller than the 1280x720 capture, so its
  bottom row (Cancel / Open buttons, ~y=815 on this display) is below
  the frame: the video shows the folder being selected, the actual
  "Open" click is just below the visible area.
- The release used here is the dev pre-release `v1.0.0-dev-20261115`,
  not the final v1.0.0 release (which is still reserved).
