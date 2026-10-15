import {loadImage} from './image.js';
import {region, paint, encode} from './regions.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
let bitmap = null;
let regions = [];
let previewing = false;
let generation = 0;
let editRevision = 0;
let origin = null;
let name = '';

function status(message) { $('status').textContent = message; }

function render() {
  $('loaded').hidden = !bitmap;
  $('empty').hidden = Boolean(bitmap);
  if (!bitmap) return;
  paint(canvas, bitmap, regions);
  $('undo').disabled = !regions.length;
  $('add').disabled = previewing;
  $('preview').textContent = previewing ? 'Back to editor' : 'Preview output';
  $('mode-title').textContent = previewing ? '01 / Flattened output preview' : '01 / Mark private details';
  $('hint').textContent = previewing ? 'Exactly the pixels that will export' : 'Drag to cover a region';
  $('count').textContent = `${regions.length} opaque mask${regions.length === 1 ? '' : 's'}`;
  $('regions').replaceChildren();
  regions.forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'region';
    const label = document.createElement('div');
    label.textContent = `Mask ${i + 1}`;
    const detail = document.createElement('small');
    detail.textContent = `X ${r.x} · Y ${r.y} · ${r.width} × ${r.height} px`;
    label.append(detail);
    const button = document.createElement('button');
    button.textContent = 'Remove'; button.setAttribute('aria-label', `Remove mask ${i + 1}`);
    button.onclick = () => {regions.splice(i, 1); editRevision++; render();};
    row.append(label, button); $('regions').append(row);
  });
}

async function choose(file) {
  const ticket = ++generation;
  editRevision++;
  if (bitmap) bitmap.close();
  bitmap = null; regions = []; previewing = false; origin = null;
  canvas.width = canvas.height = 1;
  render(); status('Reading your image locally…');
  try {
    const next = await loadImage(file);
    if (ticket !== generation) {next.close(); return;}
    bitmap = next; name = file.name;
    $('filename').textContent = name;
    $('dimensions').textContent = `${bitmap.width.toLocaleString()} × ${bitmap.height.toLocaleString()} px · original resolution`;
    $('width').value = Math.min(100, bitmap.width);
    $('height').value = Math.min(100, bitmap.height);
    $('x').value = 0; $('y').value = 0;
    render(); status('Image ready. Cover every private detail before exporting.');
  } catch (error) {
    if (ticket === generation) status(error.message);
  }
}

function add(r) {
  if (regions.length >= 200) {status('This image has reached the 200-mask limit.'); return;}
  regions.push(r); editRevision++; render(); status(`Mask ${regions.length} added. Solid black pixels will replace this region.`);
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return {x: (event.clientX - rect.left) * bitmap.width / rect.width, y: (event.clientY - rect.top) * bitmap.height / rect.height};
}

canvas.addEventListener('pointerdown', event => {
  if (!bitmap || previewing || event.button !== 0) return;
  origin = { ...point(event), id: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!origin || origin.id !== event.pointerId) return;
  paint(canvas, bitmap, regions);
  try {
    const p = point(event), r = region(origin.x, origin.y, p.x, p.y, bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.strokeStyle = '#ddff77'; context.lineWidth = Math.max(2, bitmap.width / canvas.clientWidth * 2);
    context.strokeRect(r.x, r.y, r.width, r.height);
  } catch {}
});
canvas.addEventListener('pointerup', event => {
  if (!origin || origin.id !== event.pointerId) return;
  const from = origin; origin = null;
  try { const p = point(event); add(region(from.x, from.y, p.x, p.y, bitmap.width, bitmap.height)); }
  catch (error) {render(); status(error.message);}
});
canvas.addEventListener('pointercancel', () => {origin = null; render();});
canvas.addEventListener('keydown', event => {
  if (event.key === 'Escape') {origin = null; render();}
});

$('choose').onclick = $('replace').onclick = () => $('file').click();
$('file').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await choose(file);
};
$('region-form').onsubmit = event => {
  event.preventDefault();
  if (!bitmap || previewing) return;
  try {
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(id => Number($(id).value));
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1) throw new Error('Use whole pixel coordinates and positive dimensions.');
    add(region(x, y, x + w, y + h, bitmap.width, bitmap.height));
  } catch (error) {status(error.message);}
};
$('undo').onclick = () => {regions.pop(); editRevision++; render(); status('Last mask removed.');};
$('preview').onclick = () => {previewing = !previewing; origin = null; render();};
$('export').onclick = async () => {
  if (!bitmap) return;
  const ticket = generation;
  const snapshot = editRevision;
  const maskCount = regions.length;
  $('export').disabled = true;
  status('Encoding a new PNG from the visible pixels…');
  const output = document.createElement('canvas');
  try {
    paint(output, bitmap, regions);
    const blob = await encode(output);
    if (ticket !== generation) return;
    if (snapshot !== editRevision) {
      status('Masks changed while encoding. Review the current image and download again.');
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (name.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 70) || 'image') + '-redacted.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    status(`PNG downloaded with ${maskCount} opaque mask${maskCount === 1 ? '' : 's'}. Review the downloaded image before sharing.`);
  } catch (error) {status(error.message);}
  finally {output.width = output.height = 1; $('export').disabled = false;}
};

window.addEventListener('pagehide', () => {
  generation++; editRevision++;
  bitmap?.close(); bitmap = null; regions = []; previewing = false; origin = null;
  canvas.width = canvas.height = 1;
});
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    render();
    status('The previous image was cleared when this page closed. Choose it again to continue.');
  }
});
