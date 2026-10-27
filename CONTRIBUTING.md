# Contributing

Small, focused fixes are welcome. Please open an issue before starting a substantial
change so its scope can be discussed. Fork the repository, create a branch and
submit a pull request against `main`.

Use synthetic examples in reports, screenshots and tests. Do not attach private
images or personal information. Report security vulnerabilities through the private
channel described in [SECURITY.md](SECURITY.md).

## Development setup

Use Node.js 24 or newer:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:ci
npm run test:pdf:browser
npm run test:i18n
npm run package:release
```

On Linux, use `npx playwright install --with-deps chromium` to install browser
system libraries as well. Browser checks start and stop their own local server.
Packaging creates local static files and does not deploy them.

## Preparing a pull request

Explain the problem, the change and how you checked it. Include a regression check
for behavioral fixes and mention any checks you could not run. Update documentation
and screenshots when the user experience changes.

Keep dependencies small and preserve the documented privacy behavior. Include
licence and attribution information when adding third-party material. Public text
should help users or contributors understand the product.

Pull requests must pass the required CI check before merging. Contributor pull
requests are reviewed by a maintainer.
Some contributor workflow runs require maintainer approval. Be respectful and
constructive. Contributions are made under the repository's [MIT licence](LICENSE).

See [language integration](docs/LOCALIZATION.md) when changing interface text or coordinating language within the same page.

Accepted changes can be included in future updates to the hosted app. Deployment
is managed separately from pull request merging.
