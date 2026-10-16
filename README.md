# Redact This

**Cover private details in an image before you share it.**

Choose a JPG, PNG or WebP, draw solid black masks over the details you want to hide,
then download a flattened PNG at the original resolution. Your image is processed
in your browser and is not uploaded.

**[Open Redact This](https://tools.arcdrake.com/redact/)** ·
[Download source](https://github.com/ArcdrakeStudios/redact-this/archive/refs/heads/main.zip) · [All Arcdrake Tools](https://tools.arcdrake.com/) ·
[Report a bug](https://github.com/ArcdrakeStudios/redact-this/issues)

![Redact This with a synthetic example image](docs/screenshots/desktop.png)

[Mobile view](docs/screenshots/mobile.png). Both examples use invented information.

## How to use it

1. Choose a still image from your device.
2. Drag over a name, face, number or other detail to cover it. You can also enter
   exact pixel coordinates and dimensions for a mask.
3. Preview the result and download the PNG.
4. Open the downloaded file and check every detail before sharing it.

Masks replace covered pixels with opaque black. There is no automatic detection:
you decide what to cover. Original embedded metadata is not copied to the new
image. The download name is based on the original filename; rename it if the name
contains information you do not want to share. Keep the original file private.

The interface is available in **English and German**. Use the language selector,
or open [English](https://tools.arcdrake.com/redact/?lang=en) or
[Deutsch](https://tools.arcdrake.com/redact/?lang=de) directly. Switching languages
preserves the image and masks.

## Privacy and supported files

Image processing takes place in the current browser tab. The app has no account,
image upload, analytics or saved editing session. Only your language preference is
saved in browser storage. Refreshing or closing the tab clears the editing session;
files you download remain on your device. The hosting service receives ordinary
page requests; see the [Arcdrake Tools privacy notice](https://tools.arcdrake.com/privacy/).

- Still JPG, PNG and WebP inputs; PNG output.
- Up to 40 MB, 40 million decoded pixels and 16,384 pixels per side.
- Up to 200 masks per image.
- Animated PNG/WebP and SVG are rejected. PDFs are unsupported.

Large images may fail to load or export on devices with limited available memory,
even within these limits. File validation cannot guarantee support for every encoding.
Browser checks cover Chromium and narrow layouts at 390 and 320 CSS pixels. Safari,
Firefox, physical mobile devices and screen-reader compatibility have not been
verified.

## Run locally

Download and extract the source ZIP, or clone this repository. Open a terminal
in the resulting folder.

Requires Node.js 24 or newer. No package installation or build step is needed:

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
