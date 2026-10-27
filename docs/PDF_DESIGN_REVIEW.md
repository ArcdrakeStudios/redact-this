# PDF integration design review

Historical design review scope: the initial source in `dist/`, `scripts/package.mjs`, existing tests,
and the pinned local PDF.js 6.4.299 / pdf-lib 1.17.1 APIs. PDF behavior described
below records recommendations against that baseline, not current defects or
browser verification. The current implementation follows the fresh raster writer,
bakes rotation into pixels, suppresses writer metadata, packages local resources
and has unit regressions; browser acceptance remains pending.
See [the acceptance plan](PDF_ACCEPTANCE.md) for synthetic fixtures and gates.

## Recommended data boundary

```text
Local File bytes -> PDF.js loading task -> one page raster at a time
  -> opaque background + final black masks -> freshly encoded PNG bytes
  -> new pdf-lib document -> new page + embedded masked image -> saved PDF
```

The writer should accept only masked PNG bytes and validated physical page sizes.
Use `PDFDocument.create()`, `addPage([width, height])`, `embedPng()`, image drawing
and `save()`. Do not load the input into pdf-lib or use `copyPages`, `copy`,
`embedPdf`, `embedPage` or `attach`. Rasterize unmasked pages too. Do not implement
redaction by drawing PDF rectangles over original content. This boundary removes
source object reuse from the export architecture rather than relying on a list
of metadata fields to delete.

## Prioritized integration findings

| Priority | Current source / API evidence | Pitfall and actionable recommendation |
| --- | --- | --- |
| P0 | `dist/app.js` owns one `bitmap`, `regions`, `generation` and `editRevision`; `choose()` clears old content before awaiting `loadImage()`. | Introduce document-scoped identity plus page-scoped masks and render identity. Invalidate the entire export on any page edit or replacement; a current-page revision is insufficient. Preserve clear-before-load on invalid replacement and switching between image/PDF modes. |
| P0 | Image export checks generation/revision after `encode()`, but its `catch` reports errors unconditionally and `finally` re-enables export unconditionally. | Extending this pattern to multiple overlapping tasks can let stale failures overwrite current status or controls. Guard success, failure, progress and finalization by operation ownership. Cancel or reject concurrent exports; snapshot every page's masks and geometry. Test delayed failure as well as delayed success. |
| P0 | `regions.paint()` draws an image and then fills integer rectangles black; `region()` floors/ceils boundaries. | Apply that invariant to final raster pixels, not CSS overlays or source PDF coordinates. Render all page content first, then masks, with reset canvas transform/compositing/alpha and an opaque background. Decode embedded output images to prove coverage; visible PDF overlays are insufficient. |
| P0 | `point()` maps CSS coordinates directly to bitmap pixels; PDF.js `getViewport()` incorporates scale, rotation and offsets. | Use a single authoritative viewport per page for both preview and export. Validate CropBox/MediaBox origins, UserUnit, rounded canvas bounds and rotated physical sizes. Store masks in stable page raster coordinates; avoid device-pixel-ratio or preview-scale changes moving masks. Preserve visible physical size when placing the raster into a fresh page. |
| P0 | PDF.js `getDocument({data})` accepts local typed arrays and generally transfers ownership to its worker. | Read a bounded local file, validate its signature and parsed structure, and pass data rather than a source URL. Do not reuse a detached buffer or log its contents. Reject empty/corrupt/password-required/unsupported input clearly, destroy abandoned loading tasks and never expose a partial PDF as success. A file extension or MIME type alone is not validation. |
| P0 | PDF.js defaults to recovery (`stopAtErrors: false`); `maxImageSize` can skip oversized images. | Consider `stopAtErrors: true`, but do not treat it as complete fidelity validation. Define handling for unsupported features and missing resources. Reject meaningful incomplete rendering, rather than silently exporting blank or omitted content. Reject passwords through the loading-task password path; do not add a credential prompt. |
| P0 | `dist/index.html` has `connect-src 'none'`, no explicit `worker-src` or `font-src`; PDF.js exposes `GlobalWorkerOptions.workerSrc`, `cMapUrl`, `standardFontDataUrl`, `iccUrl`, `wasmUrl` and `useWorkerFetch`. | Resolve the exact local module worker and support-resource URLs. Audit same-origin worker, font and WASM requirements against CSP before changing it; permit only the resources needed, with no external source fallback. Test the packaged page under its effective CSP, including fonts, CMaps and decoders. Do not broadly allow network access to hide loading errors. |
| P0 | `scripts/package.mjs` explicitly copies six application assets plus notices and refuses unexpected release entries. It does not copy `dist/vendor/`. | PDF source imports would work in a checkout yet fail in the package. Extend the reviewed allowlist/manifest to include required local libraries, worker, support resources and their licences. Test both a clean output directory and the documented repeat-package behavior; missing vendor files must fail checks. |
| P0 | PDF.js `render()` defaults to `AnnotationMode.ENABLE` and display intent; `ENABLE_FORMS` leaves interactive widgets for a separate layer. `enableXfa` defaults false. | Choose one explicit canvas appearance policy for preview and export. Do not import a full interactive viewer, annotation DOM, scripting or source links. Canvas output is not a guarantee that popup text or widgets without appearances are visible. Reject XFA and unsupported form/signature/annotation cases with a reason; no editing or signature-validity claims. |
| P0 | pdf-lib `create()` defaults `updateMetadata` to true and generates producer/creator/dates. | Choose `create({updateMetadata:false})` if avoiding automatic metadata, or document minimal newly generated fields. Never populate fields from input metadata or filename. Verify output object graphs and decoded streams, not just a raw sentinel search. Fresh writer metadata is not source metadata, but must not be described as an entirely metadata-free file without inspection. |
| P0 | Image limits are 40 MB, 40 million pixels and 16,384 pixels/side in `dist/image.js`; PDF adds pages, source images and writer-held buffers. | Define separate byte/page/per-page/aggregate/output budgets before allocation. Sequential rasterization bounds concurrent canvases, but pdf-lib retains embedded assets until serialization. Enforce aggregate budgets and fail atomically; do not silently lower quality or reuse image limits as a PDF memory guarantee. |
| P1 | `pagehide` closes the image and clears canvas/state; download URLs are revoked after one second. PDF.js exposes loading-task `destroy()`, render-task `cancel()` and page/document `cleanup()`. | Track each resource owner. Cancel active renders before cleanup, release canvases/bitmaps after use and destroy superseded documents; PDF.js cleanup must not race an active render. Test pagehide during load/export and real back/forward-cache restoration. Verify download URL lifetime on target browsers instead of assuming the image timeout works for large PDFs. |
| P1 | `dist/i18n.js` translates known strings and patterns through a MutationObserver; unknown messages remain English. Current localization tests inspect errors in `image.js` and `regions.js`. | Add explicit EN/DE PDF messages and extend coverage to new modules, page counters, progress and unsupported-input errors. Normalize library exceptions into bounded local messages; raw parser errors may reveal source text or remain untranslated. Preserve document state when switching language. |
| P1 | `dist/index.html` provides focusable canvas, coordinate form and live status for one image; browser tests cover image downloads and narrow layouts. | Add keyboard-accessible page navigation and page-specific mask labels; keep focused controls stable during render. Provide current page/total and export-all-pages wording. Verify touch cancellation, scrolling, small screens, long DE labels and actual downloaded PDF review. Existing image browser coverage does not establish PDF usability. |

## Rendering and support decisions to make concrete

Set the raster scale explicitly (PDF points to chosen DPI), use lossless PNG for
the masked raster, and fill each new output page with its corresponding image.
If page rotation is already baked into pixels, do not rotate the new page again.
Use the same crop, background, optional-content defaults, annotation mode and
intent in preview/export. Lossless PNG preserves the rendered pixels, not the
original PDF's vector detail, color fidelity or semantics.

Appearance streams, nonembedded fonts, CMaps, ICC profiles, transparency and
WASM-backed image codecs are fidelity risks even when parsing succeeds. A worker
is a responsiveness boundary, not a complete resource or security sandbox. Keep
dependencies pinned, retain notices, and review upstream security changes before
updating. Local-only operation still needs an audited request trace and storage
check; disabling auto-fetch alone does not establish that source data stays local.

Reject password-required documents; reject other encrypted variants unless a
tested policy can identify and support them without a password or bypass. Keep
forms, signatures and unsupported dynamic content outside v1's supported editing
scope. Unsupported content must produce a clear rejection rather than a success
that silently drops meaningful visible material. Do not promise detection of every
possible PDF rendering discrepancy.

## Integration verification order

1. Establish the fresh-writer boundary and document-wide snapshot/cancellation
   rules. Run pure geometry/budget/state checks and independent output-object,
   decoded-image and text-extraction checks on synthetic files.
2. Exercise limits and late-page/encoding/save failures. Verify that no partial
   output or older document becomes downloadable.
3. Verify the complete static package, relative URLs, manifest and notices without
   external resources. A successful image-only package is not a PDF package check.
4. In an authorized attended environment, run actual browser/download/CSP,
   EN/DE, keyboard, mobile, visual-rendering and stale-task scenarios from the
   acceptance plan. Independently inspect every synthetic exported page.
5. Re-run image regressions. Record unsupported browsers/devices and unrun gates;
   keep manual review, raster quality, file-size and filename privacy limits visible.

This review changes no application behavior and records no completed PDF browser
acceptance. It identifies integration gates for the current source, not findings
about a deployed PDF feature.
