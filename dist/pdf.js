import {encode} from './regions.js';
import {createPdfResourceCache} from './pdf-resources.js';
import {PDF_LIMITS, pageGeometry, validatePageBudget, validatePdfEnvelope, validateMasks, imagePlacement} from './pdf-geometry.js';

const resource = path => new URL(`./vendor/pdfjs/${path}`, import.meta.url).href;
const aborted = () => new DOMException('Operation cancelled.', 'AbortError');
function check(signal) { if (signal?.aborted) throw aborted(); }
function release(canvas) { if (canvas) canvas.width = canvas.height = 1; }
function encodeAbortable(canvas, signal) {
  check(signal);
  return new Promise((resolve, reject) => {
    const stop = () => reject(aborted());
    signal?.addEventListener('abort', stop, {once:true});
    encode(canvas).then(resolve, reject).finally(() => signal?.removeEventListener('abort', stop));
  });
}

// Lazy imports keep image loading independent of PDF support in the browser.
export async function load(file, {signal, onProgress = () => {}} = {}) {
  let task;
  let resources;
  let encrypted = false;
  const stop = () => { resources?.dispose(); task?.destroy().catch(() => {}); };
  try {
    check(signal);
    if (!file || !file.size || file.size > PDF_LIMITS.bytes) throw new Error('Choose a non-empty PDF under 40 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    check(signal);
    validatePdfEnvelope(bytes);
    if (typeof window !== 'undefined' && (typeof Map.prototype.getOrInsertComputed !== 'function'
      || typeof Promise.withResolvers !== 'function' || typeof Uint8Array.prototype.toHex !== 'function'
      || typeof Worker !== 'function')) throw new Error('This browser does not support PDF redaction. Update your browser and try again.');
    const pdfjs = await import('./vendor/pdfjs/build/pdf.mjs');
    check(signal);
    pdfjs.GlobalWorkerOptions.workerSrc = resource('build/pdf.worker.mjs');
    resources = createPdfResourceCache();
    task = pdfjs.getDocument({
      data:bytes, cMapUrl:resource('cmaps/'), cMapPacked:true,
      standardFontDataUrl:resource('standard_fonts/'), wasmUrl:resource('wasm/'), iccUrl:resource('iccs/'),
      BinaryDataFactory:resources.BinaryDataFactory, useWorkerFetch:false,
      stopAtErrors:true, enableXfa:false, useSystemFonts:false, disableFontFace:true,
      // No source scripts or form sandbox is instantiated. WASM is disabled so
      // CSP needs neither eval nor wasm-unsafe-eval; local JS decoders are used.
      useWasm:false, isOffscreenCanvasSupported:false, isImageDecoderSupported:false,
      disableRange:true, disableStream:true, disableAutoFetch:true
    });
    task.onPassword = () => { encrypted = true; stop(); };
    signal?.addEventListener('abort', stop, {once:true});
    const doc = await task.promise;
    check(signal);
    const {info} = await doc.getMetadata();
    if (encrypted || info.EncryptFilterName) throw new Error('Encrypted PDFs are not supported, including PDFs with an empty password.');
    if (doc.isPureXfa || info.IsAcroFormPresent || info.IsXFAPresent || info.IsSignaturesPresent || info.IsCollectionPresent) {
      throw new Error('PDF forms, signatures and portfolios are not supported.');
    }
    if (doc.numPages < 1 || doc.numPages > PDF_LIMITS.pages) throw new Error('PDFs must contain 1 to 30 pages.');
    const optional = await doc.getOptionalContentConfig();
    // PDF.js 6.4.299 exposes groups through Symbol.iterator (not getGroups).
    // hasInitialVisibility only compares state; it does not detect layers.
    if (!optional[Symbol.iterator]().next().done) throw new Error('PDFs with optional content layers are not supported.');
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      check(signal);
      const page = await doc.getPage(n);
      try {
        pages.push(pageGeometry(page));
        validatePageBudget(pages);
      } finally { page.cleanup(); }
      onProgress(n, doc.numPages);
    }
    await doc.cleanup();
    check(signal);
    signal?.removeEventListener('abort', stop);
    resources.assertReady();
    return new LocalPdf(doc, task, Object.freeze(pages), resources);
  } catch (error) {
    resources?.dispose();
    await task?.destroy().catch(() => {});
    if (signal?.aborted) throw aborted();
    if (encrypted) throw new Error('Encrypted PDFs are not supported, including PDFs with an empty password.');
    if (error instanceof Error && /^(Choose |This |PDF|Encrypted |Required local PDF )/.test(error.message)) throw error;
    throw new Error('This PDF could not be read. It may be damaged or unsupported.');
  } finally { signal?.removeEventListener('abort', stop); }
}

export class LocalPdf {
  #doc; #task; #resources; #active = null; #disposed = false; #busy = false; #destroying;
  constructor(doc, task, pages, resources) { this.#doc = doc; this.#task = task; this.pages = pages; this.#resources = resources; }
  async render(index, {signal} = {}) {
    check(signal);
    if (this.#disposed || this.#busy || !Number.isInteger(index) || !this.pages[index]) throw new Error('PDF page rendering is unavailable.');
    this.#busy = true;
    let page, canvas;
    const stop = () => this.#active?.cancel();
    signal?.addEventListener('abort', stop, {once:true});
    try {
      page = await this.#doc.getPage(index + 1);
      check(signal);
      if (this.#disposed) throw aborted();
      const g = this.pages[index];
      // getViewport applies UserUnit itself; do not multiply the scale twice.
      const viewport = page.getViewport({scale:PDF_LIMITS.dpi/72, rotation:g.rotation});
      canvas = document.createElement('canvas');
      canvas.width = g.pixelWidth; canvas.height = g.pixelHeight;
      this.#active = page.render({canvas, viewport,
        transform:[g.pixelWidth/viewport.width,0,0,g.pixelHeight/viewport.height,0,0],
        intent:'display', annotationMode:1, background:'rgb(255,255,255)'});
      await this.#active.promise;
      check(signal);
      if (this.#disposed) throw aborted();
      this.#resources?.assertReady();
      return canvas;
    } catch (error) {
      release(canvas);
      if (signal?.aborted || this.#disposed) throw aborted();
      this.#resources?.assertReady();
      throw new Error('This PDF page could not be rendered. No PDF was exported.');
    } finally {
      this.#active = null;
      // A cancelled operator list can still be winding down. PDF.js cleanup
      // then rejects; it must never replace AbortError or leave the busy lock set.
      try {
        page?.cleanup();
        if (!this.#disposed) await this.#doc.cleanup().catch(() => {});
      } finally {
        this.#busy = false;
        signal?.removeEventListener('abort', stop);
      }
      if (signal?.aborted || this.#disposed) { release(canvas); throw aborted(); }
    }
  }
  async export(masks, options = {}) {
    if (this.#disposed) throw aborted();
    return exportFlattened(this.pages, masks, (index, signal) => this.render(index, {signal}), options);
  }
  dispose() {
    this.#disposed = true;
    this.#resources?.dispose();
    this.#active?.cancel();
    return this.#destroying ??= this.#task.destroy();
  }
}

// The writer receives ONLY geometry, validated masks and newly rendered canvases.
// It never loads source PDF bytes or copies pages, objects, metadata or fields.
export async function exportFlattened(pages, masks, renderPage, {signal, onProgress = () => {}} = {}) {
  validatePageBudget(pages);
  if (!Array.isArray(masks) || masks.length !== pages.length) throw new Error('PDF masks do not match the page count.');
  const snapshot = pages.map((g,i) => validateMasks(masks[i], g));
  check(signal);
  const {PDFDocument, PDFName} = await import('./vendor/pdf-lib/pdf-lib.esm.min.js');
  const output = await PDFDocument.create({updateMetadata:false});
  let encodedBytes = 0;
  for (let index = 0; index < pages.length; index++) {
    let canvas;
    try {
      check(signal);
      canvas = await renderPage(index, signal);
      check(signal);
      const g = pages[index];
      if (canvas.width !== g.pixelWidth || canvas.height !== g.pixelHeight) throw new Error('PDF page pixels do not match the fixed geometry.');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable in this browser.');
      // White behind all transparent pixels, then opaque black over every mask.
      context.setTransform(1,0,0,1,0,0);
      context.globalAlpha = 1;
      context.save();
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height);
      context.restore();
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      context.fillStyle = '#000000';
      for (const r of snapshot[index]) context.fillRect(r.x,r.y,r.width,r.height);
      const blob = await encodeAbortable(canvas, signal);
      check(signal);
      encodedBytes += blob.size;
      if (encodedBytes > PDF_LIMITS.encodedBytes) throw new Error('The flattened PDF exceeds the output memory limit.');
      const image = await output.embedPng(new Uint8Array(await blob.arrayBuffer()));
      check(signal);
      // Flush each page image so pdf-lib can release decoded PNG pixel buffers.
      await output.flush();
      // Rotation is already in the raster. Preserve the displayed physical size
      // with an unrotated output page and a single full-page image placement.
      const page = output.addPage([g.displayWidth,g.displayHeight]);
      page.drawImage(image, imagePlacement(g));
      page.node.delete(PDFName.of('Annots'));
      page.node.Resources().delete(PDFName.of('Font'));
      onProgress(index + 1, pages.length);
    } finally { release(canvas); }
  }
  check(signal);
  const bytes = await output.save();
  check(signal);
  if (bytes.length > PDF_LIMITS.outputBytes) throw new Error('The flattened PDF exceeds the output memory limit.');
  return new Blob([bytes], {type:'application/pdf'});
}
