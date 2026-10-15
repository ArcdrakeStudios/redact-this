# Third-party and asset notices

Reviewed 14 October 2026. The application ships no npm dependencies, vendored
libraries, remote scripts, external images or font files. Interface styling and
textual/glyph branding are project-authored; browser/system fonts provide glyphs.
The named font fallbacks do not bundle a font or grant rights to external font files.
Screenshots under `docs/screenshots/` show only synthetic local test data.

Node.js and Playwright/Chromium are development/test tools, not included in the
static release. Their own distributions retain their respective upstream licences.
Do not copy installed runtimes or browser binaries into a product release.

`dist/image.js` adapts header validation and decoding from the owner-authored
Shrink This Image project. This provenance is retained from the original README;
compression functionality is not included. The owner authorized MIT preparation
for both products. No independent external library or third-party notice was found
in that helper. This inventory does not assert ownership of any future user image.

The root MIT licence records the owner's requested licence for this repository.
It does not silently replace any licence attached to future third-party material.
Retain upstream notices and resolve conflicting rights before adding such material.

## Development dependencies

Playwright is pinned in package-lock.json for browser regression tests and is licensed under Apache-2.0. It and its downloaded browser binaries are development tools, not bundled static application assets. Consult their distributed license files when installing or redistributing them.
