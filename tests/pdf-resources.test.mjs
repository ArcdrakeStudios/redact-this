import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPdfResourceCache} from '../dist/pdf-resources.js';
import {LocalPdf} from '../dist/pdf.js';
import {pageGeometry} from '../dist/pdf-geometry.js';

const urls = {standardFontDataUrl:'http://127.0.0.1/vendor/fonts/', cMapUrl:'http://127.0.0.1/vendor/cmaps/'};
const font = {kind:'standardFontDataUrl', filename:'LiberationSans-Regular.ttf'};
test('public font and CMap cache deduplicates requests and survives cleanup/offline with independent worker buffers', async () => {
  let calls = 0, online = true;
  const cache = createPdfResourceCache({fetchResource:async () => {
    calls++; assert(online); return new Response(new Uint8Array([1,2,3]));
  }});
  const factory = new cache.BinaryDataFactory(urls);
  for (const request of [font, {kind:'cMapUrl',filename:'Adobe-Japan1-UCS2.bcmap'}]) {
    const [first, second] = await Promise.all([factory.fetch(request), factory.fetch(request)]);
    structuredClone(first, {transfer:[first.buffer]});
    assert.deepEqual([...second], [1,2,3]);
  }
  online = false;
  assert.deepEqual([...(await factory.fetch(font))], [1,2,3]);
  assert.equal(calls,2); assert.equal(cache.bytes,6); cache.assertReady();
  cache.dispose(); assert.equal(cache.bytes,0);
  await assert.rejects(factory.fetch(font), {name:'AbortError'});
});

test('HTTP failures, empty, truncated and oversized resources poison the document instead of permitting fallback success', async () => {
  for (const response of [
    () => new Response('missing',{status:404}), () => new Response(new Uint8Array()),
    () => new Response(new Uint8Array([1,2,3]),{headers:{'content-length':'999'}}),
    () => new Response(new Uint8Array([1]),{headers:{'content-length':'2'}}),
    () => new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.error(new Error('truncated'));}})),
    () => new Response(new Uint8Array([1,2,3]))
  ]) {
    const cache = createPdfResourceCache({maxResourceBytes:2, fetchResource:async () => response()});
    await assert.rejects(new cache.BinaryDataFactory(urls).fetch(font), /Required local PDF resources/);
    assert.throws(() => cache.assertReady(), /Required local PDF resources/);
    assert.equal(cache.bytes,0); cache.dispose();
  }
});

test('concurrent streaming resources enforce the aggregate budget and resource-count limit', async () => {
  const cache = createPdfResourceCache({maxBytes:5, fetchResource:async () => new Response(new Uint8Array([1,2,3]))});
  const factory = new cache.BinaryDataFactory(urls);
  const results = await Promise.allSettled([factory.fetch(font), factory.fetch({...font,filename:'other.ttf'})]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
  assert.equal(cache.bytes,3); assert.throws(() => cache.assertReady()); cache.dispose();
  const limited = createPdfResourceCache({maxResources:1,fetchResource:async () => new Response(new Uint8Array([1]))});
  const limitedFactory = new limited.BinaryDataFactory(urls);
  await limitedFactory.fetch(font);
  await assert.rejects(limitedFactory.fetch({...font,filename:'other.ttf'})); limited.dispose();
});

test('HTTP compression uses decoded stream sizes rather than comparing pixels to wire Content-Length', async () => {
  const cache = createPdfResourceCache({fetchResource:async () => new Response(new Uint8Array([1,2,3]),
    {headers:{'content-encoding':'gzip','content-length':'2'}})});
  assert.deepEqual([...(await new cache.BinaryDataFactory(urls).fetch(font))],[1,2,3]);
  cache.assertReady(); assert.equal(cache.bytes,3); cache.dispose();
  const limited = createPdfResourceCache({maxResourceBytes:2,fetchResource:async () => new Response(new Uint8Array([1,2,3]),
    {headers:{'content-encoding':'br','content-length':'1'}})});
  await assert.rejects(new limited.BinaryDataFactory(urls).fetch(font),/Required local PDF resources/);
  assert.equal(limited.bytes,0); limited.dispose();
});

test('invalid resource paths and categories never reach fetch', async () => {
  let calls = 0;
  const cache = createPdfResourceCache({fetchResource:async () => {calls++; throw Error('unexpected');}});
  const factory = new cache.BinaryDataFactory(urls);
  for (const filename of ['../secret','..','https://elsewhere.test/a','%2fsecret','x?secret']) {
    await assert.rejects(factory.fetch({...font,filename}));
  }
  await assert.rejects(factory.fetch({kind:'arbitrary',filename:'x'}));
  assert.equal(calls,0); cache.dispose();
});

test('disposal aborts an in-flight public resource request without recording a recoverable success', async () => {
  const entered = Promise.withResolvers();
  const cache = createPdfResourceCache({fetchResource:async (_, {signal}) => {
    entered.resolve(); return new Promise((_,reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
  }});
  const pending = new cache.BinaryDataFactory(urls).fetch(font);
  await entered.promise; cache.dispose();
  await assert.rejects(pending,{name:'AbortError'}); assert.equal(cache.bytes,0);
});

test('PDF.js swallowed resource failure cannot return a canvas or export and disposal clears the cache', async () => {
  const cache = createPdfResourceCache({fetchResource:async () => new Response('missing',{status:404})});
  const factory = new cache.BinaryDataFactory(urls), previous = globalThis.document;
  const canvas = {width:0,height:0};
  globalThis.document = {createElement:() => canvas};
  const source = new LocalPdf({getPage:async () => ({
    getViewport:() => ({width:150,height:150}), cleanup(){},
    render:() => ({promise:factory.fetch(font).catch(() => {}),cancel(){}})
  }),cleanup:async () => {}}, {destroy:async () => {}}, [pageGeometry({view:[0,0,72,72]})], cache);
  try {
    await assert.rejects(source.export([[]]), /Required local PDF resources/);
    assert.deepEqual([canvas.width,canvas.height],[1,1]);
  } finally { await source.dispose(); globalThis.document = previous; }
  assert.throws(() => cache.assertReady(),{name:'AbortError'});
});
