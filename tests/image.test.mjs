import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectImage} from '../dist/image.js';

const damaged = {name: 'Error', message: 'This file is damaged or is not a supported JPG, PNG or WebP image.'};
const animatedPng = {name: 'Error', message: 'Animated PNG is not supported. Choose a still image.'};
const animatedWebp = {name: 'Error', message: 'Animated WebP is not supported. Choose a still image.'};
const ascii = text => new TextEncoder().encode(text);

// Synthetic header fixtures exercise inspection, not browser decoding or CRC validation.
function pngChunk(type, payload = new Uint8Array(0)) {
  const bytes = new Uint8Array(12 + payload.length);
  new DataView(bytes.buffer).setUint32(0, payload.length);
  bytes.set(ascii(type), 4);
  bytes.set(payload, 8);
  return bytes;
}

function png(...chunks) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 320);
  view.setUint32(4, 240);
  header.set([8, 2], 8);
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...pngChunk('IHDR', header), ...chunks.flatMap(chunk => [...chunk]),
    ...pngChunk('IEND'),
  ]).buffer;
}

function webpChunk(type, payload) {
  const bytes = new Uint8Array(8 + payload.length + payload.length % 2);
  bytes.set(ascii(type));
  new DataView(bytes.buffer).setUint32(4, payload.length, true);
  bytes.set(payload, 8);
  return bytes;
}

function vp8x(flags = 0) {
  return webpChunk('VP8X', new Uint8Array([flags, 0, 0, 0, 63, 1, 0, 239, 0, 0]));
}

function webp(...chunks) {
  const bytes = new Uint8Array(12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  bytes.set(ascii('RIFF'));
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(ascii('WEBP'), 8);
  let offset = 12;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

test('still PNG headers return dimensions and type', () => {
  assert.deepEqual(inspectImage(png()), {width: 320, height: 240, type: 'image/png'});
});

test('PNG acTL rejects animation after a valid IHDR', () => {
  assert.throws(() => inspectImage(png(pngChunk('acTL', new Uint8Array(8)))), animatedPng);
});

test('PNG rejects a chunk length extending beyond the file', () => {
  const buffer = png(pngChunk('tEXt'));
  new DataView(buffer).setUint32(33, 0xffffffff);
  assert.throws(() => inspectImage(buffer), damaged);
});

test('still WebP VP8X headers return dimensions and type', () => {
  assert.deepEqual(inspectImage(webp(vp8x())), {width: 320, height: 240, type: 'image/webp'});
});

test('WebP VP8X animation flag is rejected', () => {
  assert.throws(() => inspectImage(webp(vp8x(2))), animatedWebp);
});

for (const type of ['ANIM', 'ANMF']) {
  test(`WebP ${type} rejects animation after a still VP8X header`, () => {
    assert.throws(() => inspectImage(webp(vp8x(), webpChunk(type, new Uint8Array(0)))), animatedWebp);
  });
}

test('WebP rejects a chunk length extending beyond the RIFF container', () => {
  const buffer = webp(vp8x());
  new DataView(buffer).setUint32(16, 0xffffffff, true);
  assert.throws(() => inspectImage(buffer), damaged);
});

test('WebP rejects a RIFF length extending beyond the file', () => {
  const buffer = webp(vp8x());
  new DataView(buffer).setUint32(4, buffer.byteLength, true);
  assert.throws(() => inspectImage(buffer), damaged);
});
