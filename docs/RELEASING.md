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

No package installation is needed for these two commands. Browser checks require
the development setup in [CONTRIBUTING.md](../CONTRIBUTING.md).

The output in `artifacts/release/` contains:

- `index.html`, `style.css`, `app.js`, `i18n.js`, `image.js`, `regions.js`
- `LICENSE` and `THIRD_PARTY_NOTICES.md`
- `manifest.json`, listing SHA-256 hashes of the packaged files

Packaging uses an explicit file list and refuses unexpected existing output files.
No build, download or deployment takes place. The manual **Prepare release artifact**
GitHub workflow runs checks and uploads a package identified by its source commit.

## Self-host

Publish the contents of `artifacts/release/` to a static HTTPS host. Do not publish
the repository root, development dependencies or test outputs. Keep the licence
and attribution notices with redistributed copies.

The app uses relative asset URLs and can run at a domain root or beneath a
directory such as `/redact/`. Redirect a directory URL without a trailing slash
to its trailing-slash form. Serve JavaScript, CSS and HTML with the correct MIME
types. No backend, database or application secrets are required.

Deploy all files together and avoid immutable caching for unversioned asset names.
The HTML includes a Content Security Policy; configure response headers appropriate
to your host, including `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`. Document hosting access logs in your privacy notice.

After deployment, open the page in both languages, redact a synthetic image,
download it and inspect its pixels and dimensions. Check narrow layouts and the
browser console for loading errors. Keep the preceding complete package if you
need to roll back.
