import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,degrees,StandardFonts} from 'pdf-lib';
import {load} from '../dist/pdf.js';
import {createPdfResourceCache} from '../dist/pdf-resources.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Parsing only, no browser/canvas emulation or rendering claim. The modern
// PDF.js browser build needs these APIs which Node 24.14 does not supply.
globalThis.DOMMatrix ??= class {};
Uint8Array.prototype.toHex ??= function(){return Buffer.from(this).toString('hex');};
Map.prototype.getOrInsertComputed ??= function(key,fn){if(!this.has(key))this.set(key,fn(key));return this.get(key);};
const file = bytes => ({size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});

test('pinned PDF.js routes font fetches through the document cache again after cleanup without refetching bytes',async()=>{
  const input = await PDFDocument.create(), page = input.addPage([72,72]);
  page.drawText('Synthetic text',{x:2,y:20,size:7,font:await input.embedFont(StandardFonts.Helvetica)});
  let reads = 0;
  const cache = createPdfResourceCache({fetchResource:async url => {
    reads++;
    assert(url.endsWith('/standard_fonts/LiberationSans-Regular.ttf'));
    return new Response(await readFile(new URL(url)));
  }});
  const pdfjs = await import('../dist/vendor/pdfjs/build/pdf.mjs');
  const task = pdfjs.getDocument({data:await input.save(),useWasm:false,useSystemFonts:false,
    disableFontFace:true,useWorkerFetch:false,BinaryDataFactory:cache.BinaryDataFactory,
    standardFontDataUrl:new URL('../dist/vendor/pdfjs/standard_fonts/',import.meta.url).href});
  try {
    const parsed = await task.promise;
    for(let i=0;i<2;i++) {
      const renderedPage = await parsed.getPage(1);
      assert((await renderedPage.getOperatorList()).fnArray.length>0);
      cache.assertReady(); assert(cache.bytes>0);
      renderedPage.cleanup(); await parsed.cleanup();
    }
    assert.equal(reads,1);
  } finally {cache.dispose();await task.destroy();}
});

test('unsupported browser APIs fail with a capability message before PDF.js parsing',async()=>{
  const doc=await PDFDocument.create();doc.addPage([72,72]);const input=file(await doc.save());
  const previous=globalThis.window,worker=globalThis.Worker;
  try {
    globalThis.window={};globalThis.Worker=undefined;
    await assert.rejects(load(input),/This browser does not support PDF redaction/);
  } finally {
    if(previous===undefined)delete globalThis.window;else globalThis.window=previous;
    if(worker===undefined)delete globalThis.Worker;else globalThis.Worker=worker;
  }
});

test('pinned PDF.js loads a no-layer PDF and its actual viewport matches fixed user-unit geometry', async () => {
  const doc=await PDFDocument.create();
  for(const rotate of [0,90,180,270]) {
    const page=doc.addPage([200,300]);page.setCropBox(10,20,100,150);page.setRotation(degrees(rotate));
    page.node.set(PDFName.of('UserUnit'),doc.context.obj(2));
  }
  const bytes=await doc.save();
  const source=await load(file(bytes));
  try {
    assert.equal(source.pages.length,4);
    const pdfjs=await import('../dist/vendor/pdfjs/build/pdf.mjs');
    const task=pdfjs.getDocument({data:bytes.slice(),useWasm:false});
    const parsed=await task.promise;
    try {
      const config=await parsed.getOptionalContentConfig();
      assert.equal(config[Symbol.iterator]().next().done,true);
      for(let i=0;i<4;i++) {
        const viewport=(await parsed.getPage(i+1)).getViewport({scale:150/72});
        assert.equal(source.pages[i].pixelWidth,Math.ceil(viewport.width));
        assert.equal(source.pages[i].pixelHeight,Math.ceil(viewport.height));
      }
    } finally {await task.destroy();}
  } finally {await source.dispose();}
});

test('pinned PDF.js rejects real optional-content groups even at initial visibility', async () => {
  const doc=await PDFDocument.create();doc.addPage([72,72]);
  const group=doc.context.register(doc.context.obj({Type:'OCG',Name:'Synthetic layer'}));
  doc.catalog.set(PDFName.of('OCProperties'),doc.context.obj({OCGs:[group],D:{BaseState:'ON',Order:[group]}}));
  await assert.rejects(load(file(await doc.save())),/optional content layers/);
});

test('form input, invalid replacement bytes and aborted reads fail closed', async () => {
  const doc=await PDFDocument.create();const page=doc.addPage([72,72]);
  doc.getForm().createTextField('synthetic').addToPage(page);
  await assert.rejects(load(file(await doc.save())),/forms, signatures/);
  await assert.rejects(load(file(new TextEncoder().encode('not a PDF'))),/damaged/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(load(file(new Uint8Array([1])),{signal:controller.signal}),{name:'AbortError'});
});

// Minimal independent Standard Security revision-2 fixture, blank page only.
// Generates both password-required and valid empty-user-password encryption.
function encryptedPdf(password) {
  const padding=Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a','hex');
  const pad=value=>Buffer.concat([Buffer.from(value,'latin1'),padding]).subarray(0,32);
  const md5=bytes=>createHash('md5').update(bytes).digest();
  function rc4(key,input) {
    const s=Array.from({length:256},(_,i)=>i);let j=0;
    for(let i=0;i<256;i++){j=(j+s[i]+key[i%key.length])%256;[s[i],s[j]]=[s[j],s[i]];}
    let i=0;j=0;return Buffer.from(input.map(byte=>{
      i=(i+1)%256;j=(j+s[i])%256;[s[i],s[j]]=[s[j],s[i]];return byte^s[(s[i]+s[j])%256];
    }));
  }
  const id=md5(Buffer.from('synthetic-encrypted-fixture'));
  const owner=rc4(md5(pad('synthetic-owner')).subarray(0,5),pad(password));
  const permissions=Buffer.alloc(4);permissions.writeInt32LE(-4);
  const key=md5(Buffer.concat([pad(password),owner,permissions,id])).subarray(0,5);
  const user=rc4(key,padding),hex=bytes=>bytes.toString('hex');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> /P -4 >>`];
  let text='%PDF-1.4\n',offsets=[0];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(text);text+='xref\n0 5\n0000000000 65535 f \n';
  text+=offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  text+=`trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${hex(id)}><${hex(id)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}

test('password-required and empty-password encrypted PDFs both reject without a prompt', {timeout:3000},async()=>{
  for(const password of ['synthetic-password','']) {
    await assert.rejects(load(file(encryptedPdf(password))),/Encrypted PDFs are not supported/);
  }
});
