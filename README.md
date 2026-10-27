# Redact This

**Cover private details in an image or PDF before you share it.**

Choose a JPG, PNG, WebP or PDF, draw solid black masks over the details you want
to hide, then download a new PNG or rasterized PDF. Processing stays in your
browser; your file is not uploaded. PDF browser acceptance is still pending; see
[the acceptance plan](docs/PDF_ACCEPTANCE.md) before preparing a release.

**[Open Redact This](https://tools.arcdrake.com/redact/)** ·
[Download source](https://github.com/ArcdrakeStudios/redact-this/archive/refs/heads/main.zip) · [All Arcdrake Tools](https://tools.arcdrake.com/) ·
[Report a bug](https://github.com/ArcdrakeStudios/redact-this/issues)

![Redact This with a synthetic example image](docs/screenshots/desktop.png)

[Mobile view](docs/screenshots/mobile.png). Both examples use invented information.

## How to use it

1. Choose a still image or PDF from your device, or try the built-in synthetic sample.
2. Drag over a name, face, number or other detail to cover it. You can also enter
   exact pixel coordinates and dimensions for a mask.
3. For PDFs, visit every page and mark it reviewed. Adding or removing a mask
   clears that page's review. Zoom changes the view, not the mask coordinates.
4. Preview and download the PNG or PDF. Open the downloaded file and check every
   detail on every page before sharing it.

Masks replace covered pixels with opaque black. There is no automatic detection:
you decide what to cover. Original embedded metadata is not copied to the new
image. The download name is based on the original filename; rename it if the name
contains information you do not want to share. Keep the original file private.

The interface is available in **English and German**. Use the language selector,
or open [English](https://tools.arcdrake.com/redact/?lang=en) or
[Deutsch](https://tools.arcdrake.com/redact/?lang=de) directly. Switching languages
preserves the selected image/PDF, page and masks.

## Privacy and supported files

File processing takes place in the current browser tab. The app has no account,
file upload or saved editing session. Optional usage counts default off; after
permission, only the product code and action type go to the host's same-origin
service as daily action totals. They are not unique visitor counts. GPC and DNT
override permission, and you can turn counts off at any time. File names, contents,
URLs and editing details never enter these counts. The host/provider still sees
connection metadata separately.

The **Give feedback** control offers problem, idea, ease-of-use and other categories.
Only **Send feedback** submits your message and optional reply email to Arcdrake;
opening the form or editing a file does not submit feedback. The visible notice
explains active storage, expiry, backups, exports and receipt-based deletion.
No message is saved in browser storage. A failed or unavailable backend preserves
your form text and cannot confirm receipt; there is no automatic retry. The static
local app includes no feedback backend, and editing/export do not depend on one.
See [service integration](docs/MEASUREMENT_FEEDBACK.md).

Your language and yes/no usage-count preference are saved in browser storage.
Refreshing or closing the tab clears the editing session;
files you download remain on your device. The hosting service receives ordinary
page requests; see the [Arcdrake Tools privacy notice](https://tools.arcdrake.com/privacy/).

- Still JPG, PNG and WebP inputs; PNG output.
- Up to 40 MB, 40 million decoded pixels and 16,384 pixels per side.
- Up to 200 masks per image.
- Animated PNG/WebP and SVG are rejected.
- PDF input: up to 40,000,000 bytes and 30 pages; fixed 150 DPI, at most
  8,192 pixels per side, 16 million pixels per page and 100 million pixels total.
- Up to 200 masks per PDF page. Encoded page images are limited to 80,000,000
  bytes total; the saved PDF is limited to 128,000,000 bytes.
- Local PDF font and CMap resources are cached for the open document: up to
  4,000,000 bytes each, 16,000,000 bytes total and 256 resources. Missing resources
  stop rendering and export; reconnect and choose the file again to retry.

Every PDF page is rendered onto opaque white, including pages without masks.
The fresh output contains only newly encoded page pixels with masks burned in;
source objects, metadata, attachments, actions and text layers are not copied.
There is no OCR or preservation of native text or vectors. Text is no longer
selectable or searchable; links, bookmarks, accessibility tags and signatures do
not survive. Source rotation and the visible crop are baked into the pixels;
the displayed physical page size is preserved. Output may be larger and small
text or fine lines may lose clarity.

Password-protected and other encrypted PDFs (including empty passwords), forms,
XFA, signatures, portfolios and optional content layers are rejected. Ordinary
annotation appearances use PDF.js display rendering; interactive annotations,
popup contents and links are not preserved. Strict PDF header/trailer validation
can reject files that another viewer repairs. Not every PDF encoding or appearance
is supported; compare the rendered pages with your original and inspect the download.

Large files may fail to load or export on devices with limited available memory,
even within these limits. File validation cannot guarantee support for every encoding.
Existing image browser checks cover Chromium and narrow layouts at 390 and 320 CSS pixels. PDF rendering,
downloads, CSP, cancellation and memory use still require browser acceptance. Safari,
Firefox, physical mobile devices and screen-reader compatibility have not been
verified.
PDF mode requires module workers, `Promise.withResolvers`,
`Map.prototype.getOrInsertComputed` and `Uint8Array.prototype.toHex`. Browsers
missing these APIs receive an update-browser message; image mode remains available.

## Run locally

Download and extract the source ZIP, or clone this repository. Open a terminal
in the resulting folder.

Requires Node.js 24 or newer. Vendored PDF assets are included; no package
installation or build step is needed to serve the app:

```sh
node scripts/serve.mjs
```

Open http://127.0.0.1:43148. Stop the server with Ctrl+C. Serve the app over HTTP(S);
opening `index.html` as a local file will not load its JavaScript modules.

## Development

The application source is in `dist/`. Install the locked development tools to run
the browser checks:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:ci
npm run test:pdf:browser
npm run test:i18n
npm run package:release
```

Browser checks start and stop their own local server. The package command creates
static files in `artifacts/release/` with a SHA-256 manifest; it does not deploy.
See [packaging and self-hosting](docs/RELEASING.md),
[contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md).

## Licence

An [Arcdrake](https://arcdrake.com/) product. Free to use, modify and redistribute under the [MIT licence](LICENSE).
The image header-validation and loading helper is adapted from [Shrink This Image](https://github.com/ArcdrakeStudios/shrink-this-image).
See [third-party notices](THIRD_PARTY_NOTICES.md) for attribution.

Feature requests are welcome in the issue tracker. To contribute an improvement,
see [the contribution guide](CONTRIBUTING.md).
