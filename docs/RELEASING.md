# Release procedure

The canonical source is https://github.com/ArcdrakeStudios/redact-this.
The planned shared product home is `tools.arcdrake.com`; its production launch is
separate from source publication. This repository does not automatically deploy.

1. Merge through the protected pull-request workflow with `verify` passing and
   review findings resolved. Record independent review for an owner-authored PR.
2. Dispatch **Prepare release artifact** on `main`. The `release` environment
   requires owner approval and restricts runs to main. It repeats tests and packages
   the checked-out SHA. The artifact is named with that SHA and retained for 30 days.
3. Inspect the package manifest/hashes. Download and retain the artifact and manifest
   in the deployment release archive before GitHub retention expires.
4. Website deployment belongs to the separate infrastructure workflow. Pin this
   public commit and artifact hash there; verify routing, security headers and user
   journeys on the production origin. No credentials or deployment hooks live here.
5. Keep the previous verified artifact and manifest. Roll back through the same
   infrastructure workflow to those exact bytes, then check the live product.

Do not deploy from a contributor branch, arbitrary tag or local working directory.
Static host logs and origin-dependent browser behavior require separate deployment
verification. The initial source publication is not evidence of a live public site.
