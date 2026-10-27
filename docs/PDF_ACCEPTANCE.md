# Raster PDF acceptance plan

This is a contributor test specification, not a record of passing PDF tests.
The editor in `dist/app.js` now implements image and raster PDF editing with
pinned PDF.js 6.4.299 and pdf-lib 1.17.1. Unit/parser/writer and packaging checks
are separate from browser acceptance. Browser, download,
physical-device and assistive-technology checks below remain acceptance gates.
Use only generated documents with invented content. Keep test receipts and
generated output out of release assets.

For an attended run, start the local server with `npm start`, then run
`npm run test:pdf:browser` in another terminal. It exercises a real worker,
crop/UserUnit/rotation, all-page review gating, EN/DE, fresh output inspection,
invalid replacement and local requests. It does not cover the full matrix below.
Set `REDACT_TEST_URL` to a local packaged/subpath URL to check that artifact.
The script is authored but has not been run as part of worker verification.

## Required output contract

Rasterize **every page**, including pages without masks, and build a fresh PDF
from the resulting masked pixels. Never copy source pages, PDF objects, metadata,
attachments, text layers, fields or actions. A black PDF rectangle over original
content is not acceptable. The embedded image itself must contain opaque black
pixels throughout each selected rectangle. Source bytes must never reach the
writer; only masked image bytes and validated page dimensions may cross that
boundary. A sanitized source filename may inform the download name, but must not
be inserted into document metadata.

Preview and export must use the same rotation, crop, annotation policy, background
and raster geometry. Preserve page order and physical visible-page size, allowing
only documented pixel rounding. No OCR, automatic detection, search/replace,
password entry, form editing, signature preservation or vector-preserving output.
Keep the original private and inspect every downloaded page before sharing.

## Synthetic fixture set

Give each source-data channel a different invented sentinel, such as
`SYN_TEXT_P2_7Q4`, `SYN_META_7Q4`, `SYN_ATTACH_7Q4` and `SYN_ACTION_7Q4`.
Record where each is stored and whether it is supposed to remain visible as
unmasked pixels. Include a separate known-color patch outside every mask.

| Fixture | Construction |
| --- | --- |
| Basic multipage | Four numbered pages: selectable text, scanned image, mixed text/image, blank page. Mix A4 portrait and Letter landscape. Mask details on pages 1 and 3; leave page 2 unmasked. |
| Geometry | Corner labels and grids; `/Rotate` 0/90/180/270; nonzero and negative box origins; CropBox smaller than MediaBox; fractional dimensions; nondefault UserUnit. Put a sentinel outside CropBox. |
| Appearance | Embedded and nonembedded fonts, German umlauts and sharp S, CJK requiring CMaps, transparency, soft masks, ICC color, gradients and small 6/8/10-point text. Include supported JPEG2000/JBIG2 image samples generated locally. |
| Annotations | Highlight, ink, stamp, sticky-note icon and popup text; print-only and display-only appearances; a link with an action; a widget with and without an appearance; optional-content layers with different defaults. |
| Hidden data | Info and XMP metadata, attachment, hidden/off-page text, invisible text over a scan, JavaScript/open action, outline, form field and a synthetic signature field. Include compressed streams and an incremental revision holding an older sentinel. |
| Rejections | Empty/truncated bytes, non-PDF renamed `.pdf`, PDF with wrong MIME/extension, password-required PDF, malformed page tree, zero-page input, XFA and unsupported form/signature cases. |
| Resource pressure | Tiny compressed input with huge dimensions or images; many small pages; one large page; documents immediately below, at and above each configured bound. |

Fixtures containing fields or signatures may be rejection tests. They must never
be used to imply supported editing or signature validity. Hidden-data fixtures
that the importer accepts must satisfy the full output inspection below.

## Acceptance matrix

P0 blocks PDF integration; P1 blocks compatibility or usability claims for the
affected environment. Record fixture revision, app revision, locale, browser/OS,
actual limits, output size, elapsed time and result. A skipped row is unverified.

| Priority / case | Procedure | Pass condition |
| --- | --- | --- |
| P0 / all pages | Export Basic multipage, then repeat with zero masks. | Four pages in order, including blank and unmasked pages; every page contains only freshly encoded raster content. No copied source text or page resources. |
| P0 / burned pixels | Cover a bright patch and text using pointer and coordinate form, including edge-touching and overlapping rectangles. Decode output image streams. | Every pixel in each normalized mask is RGB 0,0,0 and opaque; known outside pixels agree with the chosen source render. No unmasked image copy, hidden thumbnail or recoverable original under the mask. |
| P0 / page isolation | Add different masks to pages 1 and 3; navigate repeatedly, undo and remove on each. Export while viewing page 2. | Masks stay with their pages; undo/removal affects the intended page; export includes all pages and their current masks. |
| P0 / geometry | Mask each corner on all Geometry pages, resize the viewport and test high device-pixel ratio. | Preview and embedded pixels agree; no shifted or clipped masks, double rotation or off-by-one disclosure. Output visible sizes and aspect ratios match the selected crop after rotation. Out-of-crop source content is absent. |
| P0 / async replacement | Delay document loading, page rendering and PNG encoding separately. Replace A with B, then with an invalid file or a still image. Complete A last. | Only current input can update canvas, status, controls or download. Invalid replacement clears old content and export. Superseded resources are released. |
| P0 / async edits | Delay export; add/remove/undo a mask on another page. Change page during a pending render; trigger two exports; navigate away during export. | Export uses a consistent document-wide snapshot or is discarded with a localized retry message. No stale page, old download, obsolete error or control re-enable from an earlier operation. |
| P0 / unsupported input | Try each Rejections fixture after a valid input. | Clear EN/DE reason, no password prompt, no partial-success download and no previous file left exportable. File selection remains usable. Treat MIME and extension as hints, not proof. |
| P0 / page failure | Force failure on the final page, PNG encoding, embedding and final serialization. | No apparently complete partial PDF; actionable localized failure; retry/replacement works without stale state. |
| P0 / annotations | Compare Appearance and Annotations source renders with preview and output at identical settings. | Supported visible appearances are baked before masks; no interactive layers/actions survive. Differences in display/print intent are explicit. Reject unsupported appearances rather than silently omitting meaningful content. |
| P0 / structural privacy | Perform the independent inspection below on accepted Hidden data and Basic fixtures. | No source-data channels survive; masked source text is unrecoverable as PDF text or original image data. |
| P0 / local processing | In an attended browser session, record requests during load, navigation, preview, export, replacement and failure. Test a packaged copy with external network blocked. | Only reviewed local static resources load; no file bytes, names, extracted text or errors are transmitted or persisted. No external links/actions are executed. |
| P0 / limits | Exercise every bound and the compressed-resource fixtures. Fail a late page and attempt export again. | Limits checked before corresponding allocations; no silent page omission or resolution reduction. Failure clears download state and offers a smaller-file remedy. |
| P1 / quality | Inspect small text, linework and masks at 100% and 200%; compare pages across supported encodings. | Readability and raster limitations disclosed; no clipping, missing glyphs or blank images. Record size/time; do not promise lossless source fidelity or a smaller output. |
| P1 / EN and DE | Start with each query locale; switch language on page 3 with masks and during progress/error states. | Selection, masks, page and geometry survive; page counts, limits, progress, errors, accessible names and download instructions translate. Filenames and page pixels do not. |
| P1 / keyboard | Tab through file selection, page controls, coordinate form, mask removal, preview and export. Use Enter/Space, Escape and invalid coordinates. | Visible focus and logical order; all essential actions available without dragging; page/count labels and errors announced; no focus loss to hidden controls or keyboard trap. |
| P1 / mobile | At 320 and 390 CSS px, portrait/landscape, test touch drag, cancellation, scroll and navigation; then test a physical phone. | Controls and coordinate inputs remain reachable; no accidental mask after scrolling/cancel; page identity stays clear; downloaded PDF can be opened and reviewed. Emulation alone does not prove device support. |
| P1 / lifecycle | Replace/export repeatedly; close and restore the page, including a real back/forward-cache cycle. | Old sensitive page pixels and masks do not reappear. Workers, render tasks, bitmaps, canvases and blob URLs are cleaned up; memory does not grow without bound. |
| P0 / image regression | Repeat existing JPG/PNG/WebP mask/export, invalid replacement, EXIF orientation and stale encoding checks. | Existing original-resolution PNG behavior, image limits, metadata removal and EN/DE behavior remain intact. |

## Quality, size and memory budgets

Implemented PDF limits are **40,000,000 input bytes, 30 pages, 150 DPI,
16,000,000 raster pixels per page, 8,192 pixels per side, 100,000,000 raster
pixels per document, 200 masks per page, 80,000,000 encoded image bytes and
128,000,000 saved PDF bytes**. These are engineering bounds, not verified device
capacity. Test below/at/above each during acceptance; keep image limits separate.
Reject an over-budget document instead of silently shrinking it or omitting pages.

At 150 DPI an A4 page is about 1,240 x 1,754 pixels: approximately 8.7 MB for
one RGBA buffer. Twenty such buffers alone approach 174 MB, before preview,
decoded source images, masks, PNG buffers, writer objects and final Blob copies.
A 16-million-pixel page costs 64 MB per RGBA buffer. Device-pixel ratio must not
silently multiply export resolution. Validate finite positive viewport dimensions
and arithmetic before canvas creation; account for UserUnit and rotated bounds.

Render/export sequentially, retain at most the necessary page buffers, and release
each promptly. pdf-lib still retains embedded assets until save; sequential work
does not establish a constant-memory bound. Input byte limits and PDF.js
`maxImageSize`/`canvasMaxAreaInBytes` are not whole-document memory limits; skipped
oversized source images can also make a misleading incomplete render. Measure
peak memory, failure recovery, output bytes and elapsed time on actual target
devices. Record a bounded stress-test timeout; treat a hang or crashed tab as a
failure, not evidence that the nominal limits are safe.

## Independent no-source-data export verification

1. Open the output with an independent local parser. Check page count, order,
   boxes and rotation; traverse all indirect objects, including unreferenced
   objects, object streams and decoded compressed streams. Do not inspect only
   the visible page tree or search only raw PDF bytes.
2. Allow only the new page tree, page dictionaries, image XObjects, necessary
   image color-space/encoding resources and minimal image-placement streams.
   Inspect image masks/alpha too. Each page must reference only freshly masked
   raster content. Investigate extra objects rather than relying on an exact
   byte layout or object count.
3. Verify no source Info/XMP, attachments/EmbeddedFiles, annotations, AcroForm/XFA,
   JavaScript, OpenAction/AA, launch/URI actions, outlines, optional-content
   structures, text fonts/operators, source thumbnails or prior revisions remain.
   Newly generated library metadata is distinct from copied metadata: record it
   explicitly, or suppress it under the chosen metadata policy.
4. Extract text: it must be empty, even on unmasked pages. Search decoded strings
   and streams for channel-specific sentinels. Absence of plaintext alone is not
   proof: compression, alternate encodings and original image data can hide it.
5. Decode every embedded page image and inspect the mask rectangles, including
   boundaries, for opaque black pixels. Compare known outside pixels against the
   matching renderer output. Ensure no second unmasked image resource exists.
6. Independently render the final PDF and inspect every page for legibility,
   ordering, crop, rotation and full coverage. Visual inspection cannot replace
   object/pixel checks; parser checks cannot establish appearance fidelity.

## Honest release limits and verification status

Raster output loses selectable/searchable text, vector quality, accessibility
tags, bookmarks, layers, editable forms and signature validity. It may be larger
than the original and render differently across viewers, fonts or color systems.
Manual masks cover only what the user selects; filename sanitization removes
unsafe characters, not sensitive words. Memory cleanup is not guaranteed secure
erasure. Document the supported annotation policy and reject unsupported files
clearly rather than claiming universal PDF compatibility.

No PDF browser acceptance row is recorded as run by this document. Unit checks
cover geometry, actual pinned PDF.js parsing/viewport APIs, layer/form rejection,
fake-boundary UI races, password-required/empty-password encryption rejection,
cancellation recovery, fresh-writer object/pixel inspection at 150 DPI,
translations and static packaging. Node parser checks use compatibility shims and
do not establish browser rendering. The writer bakes rotation into the page pixels
and uses unrotated output pages at the displayed physical size; it suppresses
generated metadata. Browser/localization scripts launch a browser;
run them only in an environment where that is authorized. Physical mobile,
Firefox, Safari, screen-reader and real lifecycle checks require explicit receipts
before making compatibility claims.
