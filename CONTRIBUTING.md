# Contributing

Please open an issue before a substantial change. Small, focused fixes are welcome.
Fork the repository, create a branch and submit a pull request against `main`.
Use synthetic inputs in reports, screenshots and tests; do not post private data.

Use Node.js 24 and Python 3. Install development tools with `npm ci`, then run:

```sh
npx playwright install chromium
npm test
npm run test:ci
npm run package:release
```

On Linux, `npx playwright install --with-deps chromium` installs required browser
libraries. CI uses disposable GitHub-hosted runners. Maintainer approval is needed
before an outside contributor's workflow runs; approval is not a code review.

Keep the app dependency-light and preserve its documented privacy and scope.
Include a regression check for behavioral fixes and explain verification limits.
Review must cover code, public copy, dependency rights and screenshots. Contributions
are provided under the repository's MIT license. Be respectful and constructive.

## Maintainer workflow

Main requires a pull request, passing `verify` CI, resolved conversations and linear
history. Squash merge approved changes. Force pushes and branch deletion are blocked.
CODEOWNERS assigns review to @SirDragonheart. A separate review rule requires one
approval, with a PR-only exception for the owner account: founder-authored PRs must
record independent Claude review and resolved findings before that exception is used.
The exception does not bypass CI or permit direct pushes. GitHub enforces the checks;
the independent-review evidence requirement is a maintainer procedure.

See [release procedure](docs/RELEASING.md) and [security reporting](SECURITY.md).
