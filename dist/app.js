import './i18n.js';
import {mountImageSave} from './image-save.js';
import {loadImage} from './image.js';
import {region, paint, encode} from './regions.js';
import {load as loadPdf} from './pdf.js';
import {outputName} from './pdf-geometry.js';
import {measurement} from './product-feedback.js';
import {drawSample} from './sample.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const imageSave = mountImageSave($('loaded'), message => status(message));
const savedDownload = document.createElement('a');
savedDownload.textContent = 'Download PNG file';
savedDownload.hidden = true;
$('loaded').append(savedDownload);
let savedUrl = null;
function clearSavedImage() {
  imageSave.clear(); savedDownload.hidden = true; savedDownload.removeAttribute('href');
  if (savedUrl) URL.revokeObjectURL(savedUrl);
  savedUrl = null;
}
let bitmap = null, regions = [], previewing = false, origin = null, name = '';
let generation = 0, editRevision = 0, operation = null;
let pdf = null, pageIndex = 0, pageMasks = [], reviewed = [];

function status(message) { $('status').textContent = message; }
function closeBitmap() {
  if (bitmap?.close) bitmap.close();
  else if (bitmap) bitmap.width = bitmap.height = 1;
  bitmap = null;
  canvas.width = canvas.height = 1;
}
function begin(kind) {
  operation?.controller.abort();
  const next = {kind, controller:new AbortController(), focus:document.activeElement};
  operation = next; origin = null; render();
  return next;
}
function finish(op) {
  if (operation !== op) return;
  operation = null; render();
  if (pdf && (!document.activeElement || document.activeElement === document.body || document.activeElement === op.focus)) {
    (op.focus && !op.focus.disabled ? op.focus : $('page-number')).focus();
  }
}
function current(op, ticket) { return operation === op && !op.controller.signal.aborted && generation === ticket; }
function editable() { return bitmap && !previewing && !(pdf && operation); }
function changed() {
  clearSavedImage();
  editRevision++;
  if (pdf) reviewed[pageIndex] = false;
}
function applyZoom() {
  const value = pdf ? $('zoom').value : 'fit';
  canvas.style.width = value === 'fit' || !bitmap ? '' : `${bitmap.width * Number(value)}px`;
  canvas.style.maxWidth = value === 'fit' ? '100%' : 'none';
}

function render() {
  const loaded = Boolean(bitmap || pdf);
  const locked = Boolean(pdf && operation);
  $('loaded').hidden = !loaded; $('empty').hidden = loaded;
  $('cancel').hidden = !operation || operation.kind === 'restore';
  $('pdf-controls').hidden = $('pdf-notice').hidden = !pdf;
  canvas.hidden = !bitmap;
  canvas.setAttribute('aria-label',pdf
    ? 'PDF page editor. Draw a rectangle with the pointer, or use the coordinate form to add a mask with a keyboard.'
    : 'Image editor. Draw a rectangle with the pointer, or use the coordinate form to add a mask with a keyboard.');
  $('export').textContent = pdf ? 'Download PDF ↗' : navigator.share && navigator.canShare ? 'Export PNG' : 'Download PNG ↗';
  $('export').disabled = !bitmap || Boolean(operation) || Boolean(pdf && !reviewed.every(Boolean));
  $('undo').disabled = !bitmap || !regions.length || locked;
  $('add').disabled = !editable();
  for (const id of ['x','y','width','height']) $(id).disabled = !editable();
  $('preview').disabled = !bitmap || locked;
  $('preview').textContent = previewing ? 'Back to editor' : 'Preview output';
  $('mode-title').textContent = previewing ? '01 / Flattened output preview' : '01 / Mark private details';
  $('hint').textContent = previewing ? 'Exactly the pixels that will export' : 'Drag to cover a region';
  $('coordinate-note').textContent = pdf ? 'PDF coordinates use fixed 150 DPI page pixels, independent of zoom. Masks are solid black.' : 'Masks are solid black, never blur. Coordinates use original image pixels.';
  if (pdf) {
    const g = pdf.pages[pageIndex];
    $('dimensions').textContent = `${g.pixelWidth} × ${g.pixelHeight} px · 150 DPI`;
    $('page-number').textContent = `Page ${pageIndex + 1} of ${pdf.pages.length}`;
    $('previous-page').disabled = Boolean(operation) || pageIndex === 0;
    $('next-page').disabled = Boolean(operation) || pageIndex === pdf.pages.length - 1;
    $('review-page').disabled = Boolean(operation) || Boolean(bitmap && reviewed[pageIndex]);
    $('review-page').textContent = !bitmap ? 'Show page' : reviewed[pageIndex] ? 'Page reviewed' : 'Mark page reviewed';
    $('review-count').textContent = `${reviewed.filter(Boolean).length} of ${pdf.pages.length} pages reviewed`;
    $('zoom').disabled = !bitmap || Boolean(operation);
  }
  if (bitmap) paint(canvas, bitmap, regions);
  applyZoom();
  $('count').textContent = `${regions.length} opaque mask${regions.length === 1 ? '' : 's'}`;
  $('regions').replaceChildren();
  regions.forEach((r,i) => {
    const row = document.createElement('div'); row.className = 'region';
    const label = document.createElement('div'); label.textContent = `Mask ${i + 1}`;
    const detail = document.createElement('small'); detail.textContent = `X ${r.x} · Y ${r.y} · ${r.width} × ${r.height} px`;
    label.append(detail);
    const button = document.createElement('button');
    button.textContent = 'Remove'; button.setAttribute('aria-label', `Remove mask ${i + 1}`); button.disabled = locked;
    button.onclick = () => {
      if (pdf && operation) return;
      regions.splice(i,1); changed(); render();
    };
    row.append(label, button); $('regions').append(row);
  });
}
function defaults() {
  $('width').value = Math.min(100, bitmap.width); $('height').value = Math.min(100, bitmap.height);
  $('x').value = $('y').value = 0;
}

async function choose(file) {
  clearSavedImage();
  void measurement.track('tool_start');
  const ticket = ++generation;
  editRevision++;
  const oldPdf = pdf; pdf = null;
  closeBitmap(); regions = []; pageMasks = []; reviewed = []; pageIndex = 0;
  previewing = false; origin = null;
  const op = begin('load');
  status('Reading your file locally…');
  try {
    await oldPdf?.dispose();
    if (!current(op,ticket)) return;
    name = file.name;
    $('filename').textContent = name;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      const next = await loadPdf(file, {signal:op.controller.signal, onProgress:(n,total) => {
        if (current(op,ticket)) status(`Checking PDF page ${n} of ${total}…`);
      }});
      if (!current(op,ticket)) {await next.dispose(); return;}
      pdf = next; pageMasks = next.pages.map(() => []); reviewed = next.pages.map(() => false);
      regions = pageMasks[0];
      status('Rendering PDF page 1…');
      const pixels = await pdf.render(0, {signal:op.controller.signal});
      if (!current(op,ticket)) {pixels.width = pixels.height = 1; return;}
      bitmap = pixels;
      $('zoom').value = 'fit';
      status('PDF ready. Mask and mark every page reviewed before downloading.');
    } else {
      const next = await loadImage(file);
      if (!current(op,ticket)) {next.close(); return;}
      bitmap = next;
      $('dimensions').textContent = `${bitmap.width.toLocaleString()} × ${bitmap.height.toLocaleString()} px · original resolution`;
      status('Image ready. Cover every private detail before exporting.');
    }
    defaults();
  } catch (error) {
    if (operation === op && ticket === generation) {
      const failed = pdf; pdf = null;
      closeBitmap(); regions = []; pageMasks = []; reviewed = [];
      await failed?.dispose().catch(() => {});
      if (operation === op && ticket === generation) status(error.name === 'AbortError' ? 'Operation cancelled. No file was exported.' : error.message);
    }
  } finally { finish(op); }
}

async function switchPage(index) {
  if (!pdf || operation || index < 0 || index >= pdf.pages.length) return;
  const source = pdf, ticket = generation;
  closeBitmap(); pageIndex = index; regions = pageMasks[index]; previewing = false;
  const op = begin('page');
  status(`Rendering PDF page ${index + 1}…`);
  try {
    const pixels = await source.render(index, {signal:op.controller.signal});
    if (!current(op,ticket)) {pixels.width = pixels.height = 1; return;}
    bitmap = pixels; defaults();
    status('Review this page. Masks stay attached to their page when navigating.');
  } catch (error) {
    if (operation === op && ticket === generation) status(error.name === 'AbortError' ? 'Operation cancelled. No file was exported.' : error.message);
  } finally { finish(op); }
}

function add(r) {
  if (!editable()) return;
  if (regions.length >= 200) {status(pdf ? 'This page has reached the 200-mask limit.' : 'This image has reached the 200-mask limit.'); return;}
  regions.push(r); changed(); render(); status(`Mask ${regions.length} added. Solid black pixels will replace this region.`);
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)*bitmap.width/rect.width, y:(event.clientY-rect.top)*bitmap.height/rect.height};
}
canvas.addEventListener('pointerdown', event => {
  if (!editable() || event.button !== 0) return;
  origin = {...point(event), id:event.pointerId}; canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!origin || origin.id !== event.pointerId || !editable()) return;
  paint(canvas, bitmap, regions);
  try {
    const p = point(event), r = region(origin.x,origin.y,p.x,p.y,bitmap.width,bitmap.height);
    const context = canvas.getContext('2d'); context.strokeStyle = '#ddff77';
    context.lineWidth = Math.max(2, bitmap.width/canvas.clientWidth*2); context.strokeRect(r.x,r.y,r.width,r.height);
  } catch {}
});
canvas.addEventListener('pointerup', event => {
  if (!origin || origin.id !== event.pointerId || !editable()) return;
  const from = origin; origin = null;
  try {const p = point(event); add(region(from.x,from.y,p.x,p.y,bitmap.width,bitmap.height));}
  catch (error) {render(); status(error.message);}
});
canvas.addEventListener('pointercancel', () => {origin = null; render();});
canvas.addEventListener('keydown', event => {if (event.key === 'Escape') {origin = null; render();}});
$('choose').onclick = $('replace').onclick = () => $('file').click();
$('file').onchange = async event => {const file = event.target.files[0]; event.target.value = ''; if (file) await choose(file);};
$('sample').onclick = async () => {
  if ($('sample').disabled) return;
  const ticket = generation;
  $('sample').disabled = true;
  const sample = document.createElement('canvas');
  try {
    const blob = await encode(drawSample(sample));
    if (generation === ticket) await choose(new File([blob], 'synthetic-sample.png', {type:'image/png'}));
  } catch (error) { if (generation === ticket) status(error.message); }
  finally { sample.width = sample.height = 1; $('sample').disabled = false; }
};
$('cancel').onclick = () => {if (!operation || operation.kind === 'restore') return; operation.controller.abort(); status('Cancelling operation…');};
$('previous-page').onclick = () => switchPage(pageIndex-1);
$('next-page').onclick = () => switchPage(pageIndex+1);
$('zoom').onchange = () => {origin = null; render();};
$('review-page').onclick = () => {
  if (!pdf || operation) return;
  if (!bitmap) return switchPage(pageIndex);
  const hadFocus = document.activeElement === $('review-page');
  reviewed[pageIndex] = true; render(); status('Page marked reviewed. Inspect every page before sharing.');
  if (hadFocus) ($('next-page').disabled ? $('export').disabled ? $('page-number') : $('export') : $('next-page')).focus();
};
$('region-form').onsubmit = event => {
  event.preventDefault(); if (!editable()) return;
  try {
    const [x,y,w,h] = ['x','y','width','height'].map(id => Number($(id).value));
    if (![x,y,w,h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1) throw new Error('Use whole pixel coordinates and positive dimensions.');
    add(region(x,y,x+w,y+h,bitmap.width,bitmap.height));
  } catch (error) {status(error.message);}
};
$('undo').onclick = () => {if (!bitmap || (pdf && operation)) return; regions.pop(); changed(); render(); status('Last mask removed.');};
$('preview').onclick = () => {if (!bitmap || (pdf && operation)) return; previewing = !previewing; origin = null; render();};
function download(blob, extension) {
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = outputName(name,extension); link.click();
  setTimeout(() => URL.revokeObjectURL(link.href),extension === 'pdf' ? 60_000 : 1000);
}
$('export').onclick = async () => {
  if (!bitmap || operation || (pdf && !reviewed.every(Boolean))) return;
  const ticket = generation, snapshot = editRevision, source = pdf, maskCount = regions.length;
  const masks = pageMasks.map(page => page.map(r => ({...r})));
  const op = begin('export');
  const output = document.createElement('canvas');
  try {
    let blob;
    if (source) {
      // Drop the editing raster during export. The adapter holds one page at a time.
      closeBitmap(); render();
      blob = await source.export(masks, {signal:op.controller.signal, onProgress:(n,total) => {
        if (current(op,ticket)) status(`Flattening PDF page ${n} of ${total}…`);
      }});
    } else {
      status('Encoding a new PNG from the visible pixels…');
      paint(output,bitmap,regions); blob = await encode(output);
    }
    if (!current(op,ticket)) return;
    if (snapshot !== editRevision) {status('Masks changed while encoding. Review the current image and download again.'); return;}
    clearSavedImage();
    const canShare = !source && imageSave.set(blob, outputName(name, 'png'));
    if (canShare) {
      savedUrl = URL.createObjectURL(blob); savedDownload.href = savedUrl;
      savedDownload.download = outputName(name, 'png'); savedDownload.hidden = false;
    } else download(blob, source ? 'pdf' : 'png');
    void measurement.track('tool_complete');
    status(canShare ? (document.documentElement.lang === 'de' ? 'PNG bereit. Wähle „Bild speichern oder teilen“ oder den Datei-Download. Prüfe vor dem Teilen alle Masken.' : 'PNG ready. Choose “Save or share image” or the file download. Review every mask before sharing.') : source ? 'PDF downloaded. Open it and inspect every page before sharing.' : `PNG downloaded with ${maskCount} opaque mask${maskCount === 1 ? '' : 's'}. Review the downloaded image before sharing.`);
  } catch (error) {
    if (operation === op && ticket === generation) status(error.name === 'AbortError' ? 'Operation cancelled. No file was exported.' : error.message);
  } finally {
    output.width = output.height = 1;
    // Reload the editing page after export or cancel without retaining a second raster.
    if (source && operation === op && ticket === generation) {
      op.kind = 'restore'; render();
      op.controller = new AbortController();
      try {
        const pixels = await source.render(pageIndex, {signal:op.controller.signal});
        if (operation === op && ticket === generation && !op.controller.signal.aborted) bitmap = pixels;
        else pixels.width = pixels.height = 1;
      } catch {
        if (operation === op && ticket === generation) status('The editing page could not be restored. Choose the file again.');
      }
    }
    finish(op);
  }
};
window.addEventListener('pagehide', () => {
  clearSavedImage();
  generation++; editRevision++; operation?.controller.abort(); operation = null;
  const oldPdf = pdf; pdf = null; oldPdf?.dispose().catch(() => {});
  closeBitmap(); regions = []; pageMasks = []; reviewed = []; previewing = false; origin = null;
});
window.addEventListener('pageshow', event => {
  if (event.persisted) {render(); status('The previous file was cleared when this page closed. Choose it again to continue.');}
});
render();
