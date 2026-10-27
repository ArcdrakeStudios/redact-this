# Optional counts and voluntary feedback

The static app uses the shared v1 Arcdrake contract and client in `dist/shared/`.
The product adapter is `dist/product-feedback.js`. The package contains no backend,
service credentials or triage interface. Local file processing and export work
independently of this integration. No service activation is implied by the UI.

## Client behavior

All writes use exact same-origin `POST /api/events` or `POST /api/feedback`, JSON,
no query parameters, credentials omitted, no referrer and redirects rejected.
Endpoints follow the publication origin, including when the app is under
`/redact/`; do not replace them with a local, example or public cross-origin URL.

Counts default off. The visible allow/off controls save only `yes`/`no` under
`arcdrake.analytics.v1`; GPC or DNT `1` overrides opt-in. Every event rechecks the
choice. No retroactive count, identity, session, URL, filename, file content,
mask coordinates or other metadata is sent. Events contain only
`{product:"redact",event}`. They are action counts, not unique visitors:

- `page_view` on entry, only with an existing opt-in.
- `tool_start` when a selected file or generated sample enters the loader; a
  cancelled chooser does not count. Invalid inputs can count a start.
- `tool_complete` after a current successful PNG/PDF encoding reaches the browser
  download action. Failed, stale, cancelled or unreviewed PDF exports do not count.
  This cannot establish that the user saved, inspected or shared the file. Repeated
  successful exports count separately.
- `feedback_open` only when the user opens the form, subject to the same gate.

Feedback works with counts off. Only the form's explicit Send action posts
`{product:"redact",category,message,replyTo?}`. Categories are exactly `bug`, `idea`,
`usability`, `other`. The message is trimmed, 1–2000 JavaScript code units, with
tabs/newlines allowed and other controls rejected. The optional email is trimmed,
at most 254 code units and must match the shared email shape; omit when blank.
Unknown fields are rejected. No attachments or file contents are submitted.

Only HTTP 202 with exactly `{ok:true}` for events or `{ok:true,id}` with a valid
UUIDv4 feedback receipt is acceptance; extra fields are rejected. A single
10-second deadline covers fetch and JSON parsing, aborting a stalled send and
restoring controls without retry. The shared client preserves known error
codes (`invalid`, `origin`, `product`, `method`, `size`, `type`, `rate`, `unavailable`,
`capacity`); malformed HTML/JSON, network errors and redirects become unavailable.
The form preserves text after failure and does not automatically retry: a failed
connection can occur after storage succeeds. A receipt ID enables a deletion
request through the existing Arcdrake contact route, not privileged triage access.

## Visible notices and navigation

The full EN/DE shared notices disclose Arcdrake as recipient, authorized operators
and agents, optional reply email, no reply guarantee and provider connection
processing (including IP). Active-store feedback visibility ends at 30 days;
hourly deletion is subject to platform failures. Daily aggregates cover the current
UTC day plus 89 prior days. Backups/recovery have separate retention, and exports
must be deleted by feedback expiry or earlier on a deletion request. Do not call
these counts anonymous or claim the provider sees no connection metadata.

The widget links the existing Tools EN/DE privacy pages and Arcdrake company
EN/DE contact pages. The local loopback preview says there is no included backend;
on every host the UI explains that delivery depends on the host service. There
is no availability probe or automatic feedback submission. Language changes keep
the existing form and draft. Public hosting notices must be updated alongside
any activation.

## Host integration and activation

Use the reviewed shared hosting Worker with its `MEASUREMENT_FEEDBACK` service
binding. Forward only the exact API paths to the private backend, preserving the
original HTTPS URL, same-origin Origin and trusted platform `CF-Connecting-IP`.
Keep the explicit `HOST_PRODUCTS` HTTPS-origin/product map; for the Tools origin
its reviewed product list includes `redact`. Unknown origins/products fail closed.
Do not add wildcard CORS, public cross-origin intake, a public backend route,
workers.dev endpoint, or an origin inferred from forwarding headers. A missing
service binding must return JSON 503, never a false receipt or static HTML success.

Provisioning, binding/secrets, origin maps, existing free-tier availability,
provider backup retention and authorized runtime smoke testing are separate host
release steps. Keep `TRIAGE_TOKEN` and `ABUSE_KEY` server-only. Never put triage
credentials in browser configuration, URLs, public source or package contents.
The service stores counts and feedback with its bounded capacity, rate limits,
retention alarms and authenticated triage. This tool does not implement a second
API, store, inbox or permissive fallback.

Publish only the static package in `artifacts/release/`, keeping `.mjs` MIME types
and `connect-src 'self'`. Preserve the shared wrapper's language-control IDs/event
and CSP. After authorized integration, verify original request propagation,
opt-out/GPC/DNT, unavailable-service behavior, authenticated denial and retention
with synthetic data. Remove client hooks and service forwarding together for a
rollback; keep retained-store cleanup running. Browser/device checks must be
recorded separately from in-process tests.

## In-process verification without installing dependencies

```sh
node scripts/test-local.mjs
node scripts/package.mjs
```

The first command resolves the PDF fixture writer to the exact vendored module
shipped by this app. It explicitly excludes the comparison against installed
npm dependencies and `pdf-robustness.test.mjs`, which requires installed legacy
PDF.js. Run normal `npm test` with the locked dependencies installed for those
checks. Neither command starts a browser or server. DOM/raster doubles
test control flow and writer behavior; they do not establish browser rendering,
downloads, layout or device compatibility.
