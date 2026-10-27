// Synthetic data only. Nothing here reads a user document or product implementation.
import {deflateSync} from 'node:zlib';
import {
  PDFDocument, PDFName, PDFString, StandardFonts, TextRenderingMode,
  degrees, rgb, setTextRenderingMode,
} from 'pdf-lib';

export const SOURCE_MARKERS = Object.freeze([
  'SYNTHETIC_VISIBLE_TEXT', 'SYNTHETIC_HIDDEN_OCR', 'SYNTHETIC_METADATA',
  'SYNTHETIC_ATTACHMENT', 'SYNTHETIC_FORM_VALUE', 'SYNTHETIC_ACTION',
]);
export const PAGE_SPECS = Object.freeze([
  {width: 320, height: 240, rotation: 0},
  {width: 180, height: 300, rotation: 90},
  {width: 210, height: 150, rotation: 180},
]);
export const DISPLAY_PAGES = PAGE_SPECS.map(p => p.rotation % 180
  ? {width: p.height, height: p.width} : {width: p.width, height: p.height});
export const MASK = Object.freeze({x: .1, y: .1, width: .2, height: .2});
export const BACKGROUND = [32, 160, 224];

export async function createSourceFixture({objectStreams = true} = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(SOURCE_MARKERS[2]);
  doc.setAuthor(SOURCE_MARKERS[2]);
  doc.setSubject(SOURCE_MARKERS[2]);
  doc.setKeywords([SOURCE_MARKERS[2]]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of PAGE_SPECS) {
    const page = doc.addPage([spec.width, spec.height]);
    page.setRotation(degrees(spec.rotation));
    page.drawRectangle({x: 0, y: 0, width: spec.width, height: spec.height,
      color: rgb(...BACKGROUND.map(v => v / 255))});
    page.drawRectangle({x: 0, y: 0, width: 20, height: 20, color: rgb(1, 0, 0)});
    page.drawText(SOURCE_MARKERS[0], {x: 40, y: 40, font, size: 8});
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText(SOURCE_MARKERS[1], {x: 30, y: 65, font, size: 8});
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
  }
  const field = doc.getForm().createTextField('synthetic-field');
  field.setText(SOURCE_MARKERS[4]);
  field.addToPage(doc.getPage(0), {x: 50, y: 80, width: 180, height: 20});
  await doc.attach(Buffer.from(SOURCE_MARKERS[3]), 'synthetic-note.txt', {
    mimeType: 'text/plain', description: SOURCE_MARKERS[3],
  });
  const metadata = doc.context.flateStream(Buffer.from(`<metadata>${SOURCE_MARKERS[2]}</metadata>`),
    {Type: 'Metadata', Subtype: 'XML'});
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(metadata));
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(doc.context.obj({
    Type: 'Action', S: 'JavaScript', JS: PDFString.of(`/* ${SOURCE_MARKERS[5]} */`),
  })));
  return doc.save({useObjectStreams: objectStreams});
}

export function rasterPixels(width, height, {masked = true, color = BACKGROUND} = {}) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const covered = masked && x >= width * MASK.x && x < width * (MASK.x + MASK.width)
      && y >= height * MASK.y && y < height * (MASK.y + MASK.height);
    pixels.set(covered ? [0, 0, 0] : color, (y * width + x) * 3);
  }
  return pixels;
}

function pngChunk(type, payload) {
  const data = Buffer.concat([Buffer.from(type), payload]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(payload.length + 12);
  result.writeUInt32BE(payload.length); data.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

export function encodeRgbPng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 3 + 1) + 1,
    y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}

// Positive controls are generated independently of any future product exporter.
// mutation(doc) creates precise negative controls, including unreachable objects.
export async function createRasterFixture({encoding = 'flate', masked = true,
  pages = DISPLAY_PAGES, mutation, objectStreams = true, dpi = 150} = {}) {
  const doc = await PDFDocument.create({updateMetadata:false});
  for (const {width, height} of pages) {
    const page = doc.addPage([width, height]);
    const pixelWidth=Math.ceil(width*dpi/72),pixelHeight=Math.ceil(height*dpi/72);
    const pixels = rasterPixels(pixelWidth, pixelHeight, {masked});
    if (encoding === 'png') {
      const image = await doc.embedPng(encodeRgbPng(pixelWidth, pixelHeight, pixels));
      page.drawImage(image, {x: 0, y: 0, width, height});
    } else {
      let data = pixels;
      const dict = {Type: 'XObject', Subtype: 'Image', Width: pixelWidth, Height: pixelHeight,
        BitsPerComponent: 8, ColorSpace: 'DeviceRGB'};
      if (encoding === 'predictor') {
        // PNG Sub filter, one filter byte per row; exercises real DecodeParms.
        data = Buffer.alloc((pixelWidth * 3 + 1) * pixelHeight);
        for (let y = 0; y < pixelHeight; y++) {
          const row = y * (pixelWidth * 3 + 1); data[row] = 1;
          for (let x = 0; x < pixelWidth * 3; x++) data[row + 1 + x] =
            (pixels[y * pixelWidth * 3 + x] - (x >= 3 ? pixels[y * pixelWidth * 3 + x - 3] : 0)) & 255;
        }
        dict.DecodeParms = {Predictor: 15, Colors: 3, BitsPerComponent: 8, Columns: pixelWidth};
      }
      const stream = encoding === 'raw' ? doc.context.stream(data, dict) : doc.context.flateStream(data, dict);
      const ref = doc.context.register(stream);
      page.node.set(PDFName.of('Resources'), doc.context.obj({XObject: {Raster: ref}}));
      page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(
        Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Raster Do\nQ\n`))));
    }
  }
  if (mutation) await mutation(doc);
  return doc.save({useObjectStreams: objectStreams});
}

export function expectedRasterPages() {
  return DISPLAY_PAGES.map(page => ({...page, masks: [MASK], outsideRgb:BACKGROUND,
    probes: [{x: .7, y: .7, rgb: BACKGROUND}]}));
}
