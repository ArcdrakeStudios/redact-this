import {region} from './regions.js';

export const PDF_LIMITS = Object.freeze({
  dpi:150, bytes:40_000_000, pages:30, side:8192,
  pagePixels:16_000_000, totalPixels:100_000_000, masks:200,
  encodedBytes:80_000_000, outputBytes:128_000_000
});

export function pageGeometry({view, userUnit = 1, rotate = 0}) {
  if (!Array.isArray(view) || view.length !== 4 || !view.every(Number.isFinite) ||
      !Number.isFinite(userUnit) || userUnit <= 0 || !Number.isInteger(rotate) || rotate % 90) {
    throw new Error('This PDF has unsupported page geometry.');
  }
  const width = (view[2] - view[0]) * userUnit;
  const height = (view[3] - view[1]) * userUnit;
  const rotation = ((rotate % 360) + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  const displayWidth = turned ? height : width;
  const displayHeight = turned ? width : height;
  const pixelWidth = Math.ceil(displayWidth * PDF_LIMITS.dpi / 72);
  const pixelHeight = Math.ceil(displayHeight * PDF_LIMITS.dpi / 72);
  const pixels = pixelWidth * pixelHeight;
  if (!(width > 0 && height > 0) || !Number.isSafeInteger(pixels) ||
      pixelWidth > PDF_LIMITS.side || pixelHeight > PDF_LIMITS.side || pixels > PDF_LIMITS.pagePixels) {
    throw new Error('This PDF page exceeds the 150 DPI size limit.');
  }
  return Object.freeze({width, height, rotation, displayWidth, displayHeight, pixelWidth, pixelHeight, pixels});
}

export function validatePageBudget(pages) {
  if (!pages.length || pages.length > PDF_LIMITS.pages) throw new Error('PDFs must contain 1 to 30 pages.');
  if (pages.reduce((sum, page) => sum + page.pixels, 0) > PDF_LIMITS.totalPixels) {
    throw new Error('This PDF exceeds the total 100 megapixel limit at 150 DPI.');
  }
}

// PDF.js has already baked source rotation and the visible crop into the raster.
export function imagePlacement(g) {
  return {x:0, y:0, width:g.displayWidth, height:g.displayHeight};
}

export function validateMasks(masks, g) {
  if (!Array.isArray(masks) || masks.length > PDF_LIMITS.masks) throw new Error('Each page supports up to 200 masks.');
  return Array.from(masks, r => {
    if (!r || ![r.x,r.y,r.width,r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 ||
        r.width < 1 || r.height < 1 || r.x + r.width > g.pixelWidth || r.y + r.height > g.pixelHeight) {
      throw new Error('A PDF mask is outside the fixed page pixels.');
    }
    return region(r.x,r.y,r.x+r.width,r.y+r.height,g.pixelWidth,g.pixelHeight);
  });
}

export function validatePdfEnvelope(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > PDF_LIMITS.bytes) {
    throw new Error('Choose a non-empty PDF under 40 MB.');
  }
  const decode = chunk => new TextDecoder('latin1').decode(chunk);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(decode(bytes.subarray(0,16)))) {
    throw new Error('This file is damaged or is not a supported PDF.');
  }
  const tail = decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const end = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  const offset = end && Number(end[1]);
  if (!Number.isSafeInteger(offset) || offset < 1 || offset >= bytes.length) {
    throw new Error('This file is damaged or is not a supported PDF.');
  }
  const xref = decode(bytes.subarray(offset, offset + 128));
  if (!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(xref)) {
    throw new Error('This file is damaged or is not a supported PDF.');
  }
}

export function outputName(name, extension) {
  return (name.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0,70) || 'file') + '-redacted.' + extension;
}
