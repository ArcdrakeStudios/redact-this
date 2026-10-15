# Third-party and asset notices

 The application ships no npm dependencies, vendored
libraries, remote scripts, external images or font files. Interface styling and
textual/glyph branding are project-authored; browser/system fonts provide glyphs.
The named font fallbacks do not bundle a font or grant rights to external font files.
Screenshots under `docs/screenshots/` show only synthetic local test data.

Node.js and Playwright/Chromium are development/test tools, not included in the
static release. Their own distributions retain their respective upstream licences.
Do not copy installed runtimes or browser binaries into a product release.

`dist/image.js` adapts image header validation and decoding from
[Shrink This Image](https://github.com/ArcdrakeStudios/shrink-this-image),
copyright 2026 Michael Eigner-Dietl, licensed under MIT. Compression functionality
is not included in this adapted helper.

Application source is available under the [MIT licence](LICENSE). Retain the
copyright and licence notices when redistributing it. Dependencies retain their
own licences.

## Development dependencies

Playwright is pinned in package-lock.json for browser regression tests and is licensed under Apache-2.0. It and its downloaded browser binaries are development tools, not bundled static application assets. Consult their distributed license files when installing or redistributing them.
