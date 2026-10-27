# Third-party and asset notices

The application vendors local PDF processing libraries; no remote scripts are used. Interface styling and
textual/glyph branding are project-authored; browser/system fonts provide glyphs.
The named font fallbacks do not bundle a font or grant rights to external font files.
Screenshots under `docs/screenshots/` show only synthetic local test data.

Node.js and Playwright/Chromium are development/test tools, not included in the
static release. Their own distributions retain their respective upstream licences.
Do not copy installed runtimes or browser binaries into a product release.

`dist/image.js` adapts image header validation and loading from
[Shrink This Image](https://github.com/ArcdrakeStudios/shrink-this-image),
copyright 2026 Michael Eigner-Dietl, licensed under MIT. Compression functionality
is not included in this adapted helper.

Application source is available under the [MIT licence](LICENSE). Retain the
copyright and licence notices when redistributing it. Dependencies retain their
own licences.

## Development dependencies

Playwright is pinned in package-lock.json for browser regression tests and is licensed under Apache-2.0. It and its downloaded browser binaries are development tools, not bundled static application assets. Consult their distributed license files when installing or redistributing them.

## Local PDF libraries

PDF.js 6.4.299 (Mozilla contributors), Apache-2.0; see dist/vendor/pdfjs/LICENSE.
Its distributed rendering resources retain upstream notices.
pdf-lib 1.17.1 (Andrew Dillon), MIT; see dist/vendor/pdf-lib/LICENSE.md.
The pdf-lib bundle includes @pdf-lib/standard-fonts, @pdf-lib/upng, pako and tslib.
Their distributed licence and copyright texts are collected in
`dist/vendor/pdf-lib/DEPENDENCY_LICENSES.txt` (packaged as
`vendor/pdf-lib/DEPENDENCY_LICENSES.txt`). The bundle also retains its embedded
Microsoft helper notice.
Versions are locked in package-lock.json. The static release includes the rendering
modules and resources with their upstream notices; the viewer and scripting sandbox
are excluded.
