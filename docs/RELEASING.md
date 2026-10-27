# Packaging and self-hosting

The hosted app is at [tools.arcdrake.com/redact/](https://tools.arcdrake.com/redact/).
This repository contains its source and packaging tools. Repository CI and artifact
preparation do not deploy the hosted app.

## Create a static package

With Node.js 24 or newer, run from the repository root:

```sh
npm test
npm run package:release
```

The full test suite requires the locked dependencies from the development setup
in [CONTRIBUTING.md](../CONTRIBUTING.md). Packaging itself uses only Node.js and
the vendored assets. Browser checks also require the existing Playwright browsers.

The output in `artifacts/release/` contains:

- `index.html`, `style.css`, `app.js`, `i18n.js`, `i18n-messages.js`, `image.js`,
  `regions.js`, `pdf.js`, `pdf-geometry.js`, `pdf-resources.js`, `sample.js`,
  `product-feedback.js` and both `shared/measurement-*.mjs` modules
- Pinned local PDF.js 6.4.299 module and worker, recursively copied CMaps,
  standard fonts, ICC profiles, decoder resources and their licence notices
- pdf-lib 1.17.1 browser module and licence
- `LICENSE` and `THIRD_PARTY_NOTICES.md`
- `manifest.json`, listing SHA-256 hashes of the packaged files

Packaging uses explicit application/vendor files and named recursive resource
directories. It excludes the PDF viewer, sandbox, source maps and QuickJS scripting
runtime. Every included file except the manifest itself has a SHA-256 entry.
A clean output directory is created automatically. Repeating the command overwrites
the same approved files and produces the same manifest when inputs are unchanged.
Unexpected existing files and symbolic links cause refusal before package writes;
inspect them and prepare a fresh empty output directory if needed. Packaging never
silently carries stale assets into a release. No download or deployment takes place.
The manual **Prepare release artifact**
GitHub workflow runs checks and uploads a package identified by its source commit.

## Self-host

Publish the contents of `artifacts/release/` to a static HTTPS host. Do not publish
the repository root, development dependencies or test outputs. Keep the licence
and attribution notices with redistributed copies.

The app uses relative asset URLs and can run at a domain root or beneath a
directory such as `/redact/`. Redirect a directory URL without a trailing slash
to its trailing-slash form. Serve JavaScript, CSS and HTML with the correct MIME
types: `.js`/`.mjs` as `text/javascript`, `.wasm` as `application/wasm`, `.ttf` as
`font/ttf`, `.pfb` as `application/x-font-type1`, `.bcmap` as
`application/octet-stream` and `.icc` as `application/vnd.iccprofile`.
The local development server includes these mappings. File editing and downloads
need no backend, database or application secrets. Optional counts and voluntary
feedback require the host integration described in
[measurement and feedback](MEASUREMENT_FEEDBACK.md); the static server supplies
no API and does not acknowledge submissions. Do not include server-side secrets
in any public asset.

Deploy all files together and avoid immutable caching for unversioned asset names.
The HTML includes a Content Security Policy. PDF modules, workers, CMaps, fonts
and decoder resources must load from the same origin, including under a subpath.
Keep `script-src 'self'`, `worker-src 'self'`, `connect-src 'self'` and
`font-src 'self' blob:`; image preview/download uses `blob:`/`data:`. WASM execution
is disabled in favor of local JavaScript decoders, so no eval or
`wasm-unsafe-eval` permission is required. Do not add external resource fallbacks.
Send the CSP as an HTTP response header on HTML and worker script responses;
the document meta policy does not constrain a dedicated worker. Use the policy
in `scripts/security.mjs`, including `frame-ancestors 'none'` (header only).
Configure response headers including `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`. Document hosting access logs in your privacy notice.

After deployment, open the page in both languages, redact a synthetic image,
download it and inspect its pixels and dimensions. Check narrow layouts and the
browser console for loading errors. Keep the preceding complete package if you
need to roll back.

PDF output rasterizes every page at 150 DPI on opaque white, with no selectable
text, links, vectors, accessibility tags or preserved signatures. It copies no
source objects or metadata. Forms, passwords/encryption, optional layers, signatures
and portfolios are unsupported. See [README limits](../README.md#privacy-and-supported-files)
for byte/page/pixel/mask bounds and manual-review requirements. These are engineering
bounds, not guarantees of device memory capacity. Before release, complete the
[PDF acceptance plan](PDF_ACCEPTANCE.md), including downloaded-file object/pixel
inspection, all-page visual comparison, EN/DE, cancellation, packaged CSP/resource
requests and existing image regressions. Unit and packaging checks alone do not
establish PDF browser readiness; that acceptance is currently pending.


The consent window's immutable shared CSS has a narrowly pinned SHA-256 permission
in both the HTML meta policy and `scripts/security.mjs` HTTP policy:
`sha256-VHXTEYUc0+/a/3/pxtfczPbGydBF1J/t2RF/LB9heIo=`. Package tests hash the
canonical literal and verify the two policies agree. This permits that reviewed
style block, alongside same-origin stylesheets, without allowing arbitrary inline
CSS. Hosts that send an additional CSP must grant the same exact hash in every
intersecting `style-src` policy. Preserve all other directives; do not substitute
`unsafe-inline`. A shared-style change requires an intentional hash/policy review.
