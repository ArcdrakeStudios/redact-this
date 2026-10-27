import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {PDFDocument, PDFDict, PDFArray, PDFName, PDFString, PDFHexString,
  PDFRawStream, decodePDFRawStream} from 'pdf-lib';

// Deliberately narrow acceptance profile: fresh, opaque, lossless page rasters.
// This is an independent test oracle, not a general PDF sanitizer or renderer.
const name = value => value instanceof PDFName ? value.decodeText() : undefined;
const get = (dict, key) => dict.lookup(PDFName.of(key));
const number = (dict, key, fallback) => get(dict, key)?.asNumber() ?? fallback;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const forbiddenKeys = new Set(('AcroForm Annots AA A OpenAction JavaScript JS EmbeddedFiles EF AF '
  + 'Metadata PieceInfo RichMedia XFA Collection Outlines StructTreeRoot ActualText Alt '
  + 'OCProperties OPI SMask Mask Encrypt').split(' '));
const forbiddenTypes = new Set(['Action', 'Annot', 'Filespec', 'EmbeddedFile', 'Metadata', 'Font']);
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .01,
  `${label}: expected ${expected}, got ${actual}`);

function decodeStream(stream) {
  return Buffer.from(decodePDFRawStream(stream).decode());
}

function checkMarkers(bytes, markers) {
  for (const marker of markers) {
    assert.ok(!Buffer.from(bytes).includes(Buffer.from(marker)), `source marker retained: ${marker}`);
    assert.ok(!Buffer.from(bytes).includes(Buffer.from(marker, 'utf16le')), `source UTF-16 marker retained: ${marker}`);
  }
}

function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

// PDF image streams contain decoded PNG pixel rows, not a complete PNG file.
// Support unfiltered/raw Flate and PNG DecodeParms predictors (all five filters).
export function inspectImagePixels(stream) {
  assert.ok(stream instanceof PDFRawStream, 'image must be a stream');
  const dict = stream.dict;
  assert.equal(name(get(dict, 'Subtype')), 'Image');
  assert.equal(number(dict, 'BitsPerComponent'), 8, 'only lossless 8-bit rasters are accepted');
  const space = name(get(dict, 'ColorSpace'));
  assert.ok(['DeviceRGB', 'DeviceGray'].includes(space), 'unsupported image color space');
  const channels = space === 'DeviceRGB' ? 3 : 1;
  for (const key of ['SMask', 'Mask', 'ImageMask', 'Decode', 'Alternates', 'OPI']) {
    assert.ok(!dict.has(PDFName.of(key)), `image ${key} is unsupported`);
  }
  const width = number(dict, 'Width'), height = number(dict, 'Height');
  assert.ok(Number.isSafeInteger(width) && width > 0 && width <= 16384);
  assert.ok(Number.isSafeInteger(height) && height > 0 && height <= 16384);
  assert.ok(width * height <= 40_000_000, 'image exceeds inspection pixel limit');
  const filter = get(dict, 'Filter');
  assert.ok(!filter || name(filter) === 'FlateDecode', 'only raw/Flate lossless images are accepted');
  const rowBytes = width * channels;
  const parms = get(dict, 'DecodeParms');
  const predictor = parms ? number(parms, 'Predictor', 1) : 1;
  const limit = (rowBytes + 1) * height;
  const raw = filter ? inflateSync(stream.contents, {maxOutputLength: limit}) : Buffer.from(stream.contents);
  if (predictor === 1) {
    assert.equal(raw.length, rowBytes * height, 'wrong image pixel byte count');
    return {width, height, channels, pixels: raw};
  }
  assert.ok(predictor >= 10 && predictor <= 15, 'unsupported image predictor');
  assert.equal(number(parms, 'Columns', 1), width);
  assert.equal(number(parms, 'Colors', 1), channels);
  assert.equal(number(parms, 'BitsPerComponent', 8), 8);
  assert.equal(raw.length, (rowBytes + 1) * height, 'wrong PNG predictor byte count');
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filterByte = raw[y * (rowBytes + 1)];
    assert.ok(filterByte <= 4, 'invalid PNG row filter');
    if (predictor !== 15) assert.equal(filterByte, predictor - 10, 'PNG predictor/filter mismatch');
    for (let x = 0; x < rowBytes; x++) {
      const pos = y * rowBytes + x;
      const left = x >= channels ? pixels[pos - channels] : 0;
      const above = y ? pixels[pos - rowBytes] : 0;
      const upperLeft = y && x >= channels ? pixels[pos - rowBytes - channels] : 0;
      const correction = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filterByte];
      pixels[pos] = (raw[y * (rowBytes + 1) + 1 + x] + correction) & 255;
    }
  }
  return {width, height, channels, pixels};
}

function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

function pageImage(doc, page, expected, contentStreams, usedImages) {
  close(page.getWidth(), expected.width, 'page width');
  close(page.getHeight(), expected.height, 'page height');
  assert.equal(page.getRotation().angle % 360, 0, 'output rotation must be baked into pixels');
  close(number(page.node, 'UserUnit', 1), 1, 'output UserUnit');
  const box = page.getMediaBox();
  close(box.x, 0, 'media box x'); close(box.y, 0, 'media box y');
  const crop = page.getCropBox();
  for (const key of ['x', 'y', 'width', 'height']) close(crop[key], box[key], `crop box ${key}`);
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map(item => doc.context.lookup(item)) : [contents];
  assert.ok(streams.length > 0 && streams.every(s => s instanceof PDFRawStream), 'missing page streams');
  const text = streams.map(stream => {
    contentStreams.add(stream); return decodeStream(stream).toString('latin1');
  }).join('\n').replace(/%[^\r\n]*/g, ' ');
  // No strings, inline images, text, paths, clipping, forms or graphics-state tricks.
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const operands = [], stack = [], draws = [];
  let matrix = [1,0,0,1,0,0];
  for (const token of tokens) {
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      const value = Number(token); assert.ok(Number.isFinite(value)); operands.push(value);
    } else if (/^\/[A-Za-z0-9_.#-]+$/.test(token)) {
      operands.push(token.slice(1).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h,16))));
    } else if (token === 'cm') {
      assert.equal(operands.length, 6, 'bad cm operands');
      assert.ok(operands.every(v => typeof v === 'number'));
      matrix = multiply(matrix, operands.splice(0));
    } else if (token === 'q') {
      assert.equal(operands.length, 0); stack.push([...matrix]);
    } else if (token === 'Q') {
      assert.equal(operands.length, 0); assert.ok(stack.length, 'unbalanced Q'); matrix = stack.pop();
    } else if (token === 'Do') {
      assert.equal(operands.length, 1); assert.equal(typeof operands[0], 'string');
      draws.push({resource: operands.pop(), matrix: [...matrix]});
    } else assert.fail(`non-raster page content operator/token: ${token}`);
  }
  assert.equal(operands.length, 0); assert.equal(stack.length, 0, 'unbalanced q');
  assert.equal(draws.length, 1, 'each page must paint exactly one fresh full-page raster');
  const draw = draws[0];
  [expected.width,0,0,expected.height,0,0].forEach((v,i) => close(draw.matrix[i], v, 'image placement'));
  const resources = page.node.Resources();
  const fonts = resources && get(resources, 'Font');
  assert.ok(!fonts || fonts.keys().length === 0, 'font resources retained');
  const xobjects = resources && get(resources, 'XObject');
  assert.ok(xobjects instanceof PDFDict && xobjects.keys().length === 1, 'unexpected XObjects');
  const image = get(xobjects, draw.resource);
  assert.ok(image instanceof PDFRawStream && name(get(image.dict, 'Subtype')) === 'Image', 'source page/form reused');
  assert.ok(!usedImages.has(image), 'one image reused across pages');
  usedImages.add(image);
  return inspectImagePixels(image);
}

function pixelAt(image, x, y) {
  assert.ok(x >= 0 && x < image.width && y >= 0 && y < image.height, 'pixel outside raster');
  const offset = (y * image.width + x) * image.channels;
  return image.channels === 1 ? Array(3).fill(image.pixels[offset]) : [...image.pixels.subarray(offset, offset + 3)];
}

/** expectedPages uses PDF points for dimensions, normalized top-left masks/probes.
 * Source bytes enable decoded stream reuse checks; markers are synthetic canaries.
 * Rejecting an unsupported encoding is intentional, never a successful inspection.
 */
export async function inspectPdfExport(bytes, {expectedPages, sourceBytes, sourceMarkers = []}) {
  assert.ok(expectedPages?.length, 'explicit expected pages are required');
  const doc = await PDFDocument.load(bytes, {updateMetadata: false, throwOnInvalidObject: true});
  assert.equal(doc.isEncrypted, false, 'encrypted output');
  assert.equal(doc.getPageCount(), expectedPages.length, 'page count');
  const sourceStreams = new Set();
  if (sourceBytes) {
    const source = await PDFDocument.load(sourceBytes, {updateMetadata: false});
    for (const [, object] of source.context.enumerateIndirectObjects()) {
      if (object instanceof PDFRawStream && !['ObjStm', 'XRef'].includes(name(get(object.dict, 'Type')))) {
        sourceStreams.add(digest(decodeStream(object)));
      }
    }
  }
  const contentStreams = new Set(), usedImages = new Set();
  const images = doc.getPages().map((page, i) => pageImage(doc, page, expectedPages[i], contentStreams, usedImages));
  const seen = new Set();
  function inspect(object) {
    if (!object || seen.has(object)) return;
    seen.add(object);
    if (object instanceof PDFString || object instanceof PDFHexString || object instanceof PDFName) {
      checkMarkers(Buffer.from(object.decodeText()), sourceMarkers);
    } else if (object instanceof PDFArray) {
      object.asArray().forEach(inspect);
    } else if (object instanceof PDFRawStream) {
      inspect(object.dict);
      const type = name(get(object.dict, 'Type'));
      assert.ok(contentStreams.has(object) || usedImages.has(object) || ['ObjStm', 'XRef'].includes(type),
        'unexpected/orphan stream retained');
      const decoded = usedImages.has(object) ? inspectImagePixels(object).pixels : decodeStream(object);
      checkMarkers(decoded, sourceMarkers);
      assert.ok(!sourceStreams.has(digest(decoded)), 'source stream reused');
    } else if (object instanceof PDFDict) {
      assert.ok(!forbiddenTypes.has(name(get(object, 'Type'))), 'forbidden source object type');
      assert.notEqual(name(get(object, 'Subtype')), 'Form', 'source form XObject retained');
      for (const [key, value] of object.entries()) {
        // pdf-lib creates an empty annotation array while normalizing drawImage.
        if (name(key) === 'Annots' && doc.context.lookup(value) instanceof PDFArray
          && doc.context.lookup(value).size() === 0) continue;
        assert.ok(!forbiddenKeys.has(name(key)), `forbidden PDF key: ${name(key)}`);
        if (name(key) === 'Font') assert.ok(value instanceof PDFDict && value.keys().length === 0, 'font resource retained');
        inspect(key); inspect(value);
      }
    }
  }
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  assert.equal(info,undefined,'output metadata must be absent');
  for (const [, object] of doc.context.enumerateIndirectObjects()) inspect(object);
  images.forEach((image, index) => {
    const expected = expectedPages[index];
    assert.equal(image.width,expected.pixelWidth ?? Math.ceil(expected.width*150/72),'fixed DPI pixel width');
    assert.equal(image.height,expected.pixelHeight ?? Math.ceil(expected.height*150/72),'fixed DPI pixel height');
    for (const rect of expected.masks ?? []) {
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
        && rect.x + rect.width <= 1 && rect.y + rect.height <= 1, 'invalid expected mask');
      // Every interior pixel is tested. Exclude a fractional boundary pixel only.
      const left = Math.ceil(rect.x * image.width), top = Math.ceil(rect.y * image.height);
      const right = Math.floor((rect.x + rect.width) * image.width);
      const bottom = Math.floor((rect.y + rect.height) * image.height);
      assert.ok(right > left && bottom > top, 'expected mask has no interior pixels');
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        assert.deepEqual(pixelAt(image, x, y), [0,0,0], `mask is not baked black: page ${index+1}, ${x},${y}`);
      }
    }
    for (const probe of expected.probes ?? []) {
      assert.deepEqual(pixelAt(image, Math.floor(probe.x * image.width), Math.floor(probe.y * image.height)),
        probe.rgb, `outside pixel: page ${index+1}`);
    }
    for (const rect of expected.colorRegions ?? []) {
      const left = Math.ceil(rect.x * image.width), top = Math.ceil(rect.y * image.height);
      const right = Math.floor((rect.x + rect.width) * image.width);
      const bottom = Math.floor((rect.y + rect.height) * image.height);
      assert.ok(right > left && bottom > top, 'expected color region has no interior pixels');
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        assert.deepEqual(pixelAt(image, x, y), rect.rgb, `outside color region: page ${index+1}, ${x},${y}`);
      }
    }
    if(expected.outsideRgb) {
      for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
        const boundary=(expected.masks??[]).some(r=>x>=Math.floor(r.x*image.width)
          && x<Math.ceil((r.x+r.width)*image.width) && y>=Math.floor(r.y*image.height)
          && y<Math.ceil((r.y+r.height)*image.height));
        if(!boundary) assert.deepEqual(pixelAt(image,x,y),expected.outsideRgb,`outside pixel: page ${index+1}, ${x},${y}`);
      }
    }
  });
  return {pageCount: images.length, pages: images.map(({width,height,channels}) => ({width,height,channels}))};
}
