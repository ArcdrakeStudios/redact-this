import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {deflateSync} from 'node:zlib';
import {PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream} from 'pdf-lib';
import {PDFDocument as WriterDocument} from '../dist/vendor/pdf-lib/pdf-lib.esm.min.js';
import {exportFlattened} from '../dist/pdf.js';
import {PDF_LIMITS, pageGeometry, validateMasks, validatePdfEnvelope} from '../dist/pdf-geometry.js';

// The installed legacy build supplies Node-compatible parsing/polyfills. No canvas
// rendering is performed here; this does not exercise the browser worker or CSP.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const tinyPage = () => pageGeometry({view:[0,0,2.88,1.92]});
const deferred = () => Promise.withResolvers();
const isAbort = error => error?.name === 'AbortError';
function released(canvas) {
  assert.equal(canvas.width, 1);
  assert.equal(canvas.height, 1);
}

async function withParsed(bytes, callback) {
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : Uint8Array.from(bytes);
  const task = pdfjs.getDocument({data, useSystemFonts:false, disableFontFace:true});
  try { return await callback(await task.promise); }
  finally { await task.destroy(); }
}

test('geometry agrees with installed PDF.js for cropped negative origins, fractional UserUnit and quarter turns', async () => {
  assert.equal(pdfjs.version, '6.4.299');
  const source = await PDFDocument.create();
  for (const userUnit of [0.5,1,2]) for (const angle of [0,90,180,270]) {
    const page = source.addPage([300,400]);
    page.setMediaBox(-80,-90,300,400);
    page.setCropBox(-25.5,-10.25,127.5,63.75);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(angle));
  }
  await withParsed(await source.save(), async doc => {
    assert.equal([...(await doc.getOptionalContentConfig())].length, 0,
      'the installed optional-content config is iterable');
    for (let n=1;n<=doc.numPages;n++) {
      const page = await doc.getPage(n);
      assert.deepEqual(page.view, [-25.5,-10.25,102,53.5]);
      const g = pageGeometry(page), viewport = page.getViewport({scale:150/72});
      assert.equal(g.pixelWidth, Math.ceil(viewport.width));
      assert.equal(g.pixelHeight, Math.ceil(viewport.height));
      assert.equal(g.width, 127.5*page.userUnit);
      assert.equal(g.height, 63.75*page.userUnit);
      assert(Object.isFrozen(g));
      const corners = [[page.view[0],page.view[1]],[page.view[2],page.view[3]]]
        .map(([x,y]) => viewport.convertToViewportPoint(x,y));
      assert(Math.abs(Math.min(...corners.map(p=>p[0]))) < 1e-8);
      assert(Math.abs(Math.min(...corners.map(p=>p[1]))) < 1e-8);
    }
  });
});

test('envelope accepts ordinary classic and object-stream PDFs with PDF line endings and trailing whitespace', async () => {
  const doc = await PDFDocument.create(); doc.addPage([72,72]);
  for (const useObjectStreams of [false,true]) {
    const bytes = await doc.save({useObjectStreams});
    for (const suffix of ['', '\n', '\r\n\t\f ']) {
      const candidate = Buffer.concat([bytes,Buffer.from(suffix)]);
      validatePdfEnvelope(candidate);
      await withParsed(candidate, parsed => assert.equal(parsed.numPages,1));
    }
  }
  // A minimal valid blank document, including exact byte offsets, exercises
  // CR-only/CRLF syntax independently of pdf-lib's serializer.
  for (const eol of ['\n','\r','\r\n']) {
    let text=`%PDF-1.7${eol}`;
    const offsets=[0];
    const objects=['<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [-10 -20 62 52] /Resources << >> >>'];
    objects.forEach((body,i)=>{offsets.push(text.length);text+=`${i+1} 0 obj${eol}${body}${eol}endobj${eol}`;});
    const xref=text.length;
    text+=`xref${eol}0 4${eol}0000000000 65535 f ${eol}`;
    text+=offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n ${eol}`).join('');
    text+=`trailer${eol}<< /Size 4 /Root 1 0 R >>${eol}startxref${eol}${xref}${eol}%%EOF${eol}`;
    const bytes=Buffer.from(text);
    validatePdfEnvelope(bytes);
    await withParsed(bytes,async parsed=>assert.deepEqual((await parsed.getPage(1)).view,[-10,-20,62,52]));
  }
});

test('envelope fails closed for truncation, junk after EOF, unsupported headers and nonsensical offsets', async () => {
  const doc = await PDFDocument.create(); doc.addPage([72,72]);
  const bytes = await doc.save({useObjectStreams:false});
  const text = Buffer.from(bytes).toString('latin1');
  for (const candidate of [
    new Uint8Array(), bytes.subarray(0,bytes.length-10),
    Buffer.concat([bytes,Buffer.from('appended non-PDF payload')]),
    Buffer.from(text.replace('%PDF-1.7','%PDF-9.9'),'latin1'),
    ...['0','-1','1.5','9007199254740992',String(bytes.length+1)]
      .map(offset => Buffer.from(text.replace(/startxref\s+\d+/,`startxref\n${offset}`),'latin1')),
  ]) assert.throws(() => validatePdfEnvelope(candidate));
  assert.throws(() => validatePdfEnvelope(new ArrayBuffer(10)));
});

test('masks reject fractional/nonfinite/string/outside coordinates and copy edge-touching rectangles', () => {
  const g = tinyPage(), good = {x:0,y:0,width:g.pixelWidth,height:g.pixelHeight};
  const source = [good], snapshot = validateMasks(source,g);
  good.x = 1; source.length = 0;
  assert.deepEqual(snapshot,[{x:0,y:0,width:g.pixelWidth,height:g.pixelHeight}]);
  for (const bad of [null,{}, {x:0,y:0,width:0,height:1},
    ...[NaN,Infinity,-Infinity,0.5,'1',-1].map(x=>({x,y:0,width:1,height:1})),
    {x:g.pixelWidth,y:0,width:1,height:1}, {x:0,y:g.pixelHeight,width:1,height:1},
  ]) assert.throws(() => validateMasks([bad],g));
  assert.equal(validateMasks(Array.from({length:PDF_LIMITS.masks},()=>({x:0,y:0,width:1,height:1})),g).length,200);
});

test('sparse mask lists are rejected during validation before any rendering', async () => {
  const g = tinyPage();
  let validationError, renders=0;
  try {validateMasks(new Array(1),g);} catch(error) {validationError=error;}
  await assert.rejects(exportFlattened([g],[new Array(1)],async () => {renders++; return raster(g);}));
  assert.deepEqual({rejected:Boolean(validationError),renders},{rejected:true,renders:0});
});

function chunk(type,data) {
  const body = Buffer.concat([Buffer.from(type),data]);
  let crc=0xffffffff;
  for (const value of body) {crc^=value;for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const out=Buffer.alloc(data.length+12); out.writeUInt32BE(data.length); body.copy(out,4);
  out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4); return out;
}
function png(width,height,pixels) {
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=6;
  const rows=Buffer.alloc(height*(width*4+1));
  for(let y=0;y<height;y++) Buffer.from(pixels.subarray(y*width*4,(y+1)*width*4)).copy(rows,y*(width*4+1)+1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

// Deliberately small stand-in: integer fillRect, source-over/destination-over,
// save/restore and PNG encoding only. It models partial-alpha compositing, but
// cannot prove actual browser Canvas/PDF.js rendering or font/color fidelity.
function raster(g,{encode}={}) {
  const width=g.pixelWidth, height=g.pixelHeight, pixels=new Uint8Array(width*height*4);
  for(let i=0;i<pixels.length;i+=4) pixels.set([240,30,60,255],i);
  pixels.set([30,60,90,128],0);
  const stack=[];
  const ctx={globalAlpha:1,globalCompositeOperation:'source-over',fillStyle:'#000000',
    setTransform(...m){assert.deepEqual(m,[1,0,0,1,0,0]);},
    save(){stack.push([this.globalAlpha,this.globalCompositeOperation,this.fillStyle]);},
    restore(){[this.globalAlpha,this.globalCompositeOperation,this.fillStyle]=stack.pop();},
    fillRect(x,y,w,h){
      const color=this.fillStyle==='#ffffff'?[255,255,255]:[0,0,0];
      for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) {
        const i=(yy*width+xx)*4, alpha=pixels[i+3]/255;
        if(this.globalCompositeOperation==='destination-over') {
          for(let c=0;c<3;c++) pixels[i+c]=Math.round(pixels[i+c]*alpha+color[c]*(1-alpha));
          pixels[i+3]=255;
        } else pixels.set([...color,255],i);
      }
    }};
  return {width,height,getContext:()=>ctx,
    toBlob(callback){
      const blob=new Blob([png(width,height,pixels)],{type:'image/png'});
      if(encode) encode(callback,blob); else callback(blob);
    }};
}
async function outputDoc(blob) {
  return PDFDocument.load(await blob.arrayBuffer(),{updateMetadata:false});
}
function imageRgb(doc,index) {
  const resources=doc.getPage(index).node.Resources();
  assert.equal(resources.has(PDFName.of('Font')),false);
  const objects=resources.lookup(PDFName.of('XObject'));
  assert.equal(objects.keys().length,1);
  const image=objects.lookup(objects.keys()[0]);
  assert(image instanceof PDFRawStream);
  assert.equal(image.dict.has(PDFName.of('SMask')),false);
  return decodePDFRawStream(image).decode();
}

test('export snapshots all page masks before awaits and composites partial-alpha pixels onto white', async () => {
  const pages=[tinyPage(),tinyPage()], masks=pages.map(()=>[{x:1,y:1,width:2,height:2}]);
  const canvases=[];
  const blob=await exportFlattened(pages,masks,async index=>{
    // Change the current and a future page after the writer starts.
    if(index===0) {masks[0][0].x=0; masks[1][0].width=1; masks[1].length=0; masks.push([]);}
    const canvas=raster(pages[index]); canvases.push(canvas); return canvas;
  });
  const doc=await outputDoc(blob);
  for(let n=0;n<2;n++) {
    const rgb=imageRgb(doc,n), g=pages[n];
    assert.deepEqual([...rgb.subarray(0,3)],[142,157,172]);
    for(let y=1;y<3;y++) for(let x=1;x<3;x++) {
      const offset=(y*g.pixelWidth+x)*3;
      assert.deepEqual([...rgb.subarray(offset,offset+3)],[0,0,0]);
    }
    assert.deepEqual([...rgb.subarray(3,6)],[240,30,60]);
  }
  canvases.forEach(released);
});

const multiply=(a,b)=>[
  a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
  a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
  a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5],
];
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
function imageMatrix(page) {
  const contents=page.node.Contents();
  const text=contents.asArray().map(ref=>Buffer.from(decodePDFRawStream(page.doc.context.lookup(ref)).decode()).toString('latin1')).join('\n');
  const number='(-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)';
  const expression=new RegExp(Array(6).fill(number).join('\\s+')+'\\s+cm','gi');
  const matrices=[...text.matchAll(expression)].map(match=>match.slice(1).map(Number));
  assert(matrices.length>0,'content contains an image placement matrix');
  return matrices.reduce(multiply,[1,0,0,1,0,0]);
}

test('serialized image matrices cover the complete page and preserve raster corner orientation for every rotation', async () => {
  const pages=[0,90,180,270].map(rotate=>pageGeometry({view:[-2,-3,7.5,3.25],userUnit:2,rotate}));
  const blob=await exportFlattened(pages,pages.map(()=>[]),async i=>raster(pages[i]));
  const doc=await outputDoc(blob), matrices=doc.getPages().map(imageMatrix);
  await withParsed(await blob.arrayBuffer(),async parsed=>{
    for(let i=0;i<pages.length;i++) {
      const viewport=(await parsed.getPage(i+1)).getViewport({scale:1});
      const matrix=multiply(viewport.transform,matrices[i]);
      for(const [x,y,expected] of [[0,1,[0,0]],[1,1,[pages[i].displayWidth,0]],
        [0,0,[0,pages[i].displayHeight]],[1,0,[pages[i].displayWidth,pages[i].displayHeight]]]) {
        point(matrix,x,y).forEach((value,k)=>assert(Math.abs(value-expected[k])<1e-8));
      }
    }
  });
});

test('pre-aborted export validates without rendering or returning a blob', async () => {
  let renders=0;
  await assert.rejects(exportFlattened([tinyPage()],[[]],async()=>{renders++;},
    {signal:AbortSignal.abort()}),isAbort);
  assert.equal(renders,0);
});

test('abort during deferred encoding releases the raster and cannot return partial output', async () => {
  const entered=deferred(), controller=new AbortController(); let complete,canvas;
  const pending=exportFlattened([tinyPage()],[[]],async()=>{
    canvas=raster(tinyPage(),{encode(callback,blob){complete=()=>callback(blob); entered.resolve();}});
    return canvas;
  },{signal:controller.signal});
  await entered.promise; controller.abort(); complete();
  await assert.rejects(pending,isAbort); released(canvas);
});

test('abort releases the raster even when the PNG encoder never calls back', {timeout:1000},async () => {
  const entered=deferred(),controller=new AbortController();let canvas;
  const pending=exportFlattened([tinyPage()],[[]],async()=>{
    canvas=raster(tinyPage(),{encode(){entered.resolve();}});return canvas;
  },{signal:controller.signal});
  await entered.promise;controller.abort();
  await assert.rejects(pending,isAbort);released(canvas);
});

test('late-page rendering failure rejects the complete export and releases all completed rasters', async () => {
  const pages=[tinyPage(),tinyPage(),tinyPage()], seen=[], progress=[];
  await assert.rejects(exportFlattened(pages,pages.map(()=>[]),async index=>{
    seen.forEach(released);
    if(index===2) throw new Error('synthetic final-page failure');
    const canvas=raster(pages[index]); seen.push(canvas); return canvas;
  },{onProgress:n=>progress.push(n)}),/synthetic final-page failure/);
  assert.equal(seen.length,2); assert.deepEqual(progress,[1,2]); seen.forEach(released);
});

test('context, geometry, PNG encoding and embedding failures release the owned canvas', async t => {
  for(const kind of ['context','geometry','encode-throw','encode-null','encode-type','bad-png']) {
    await t.test(kind,async()=>{
      const g=tinyPage(),canvas=raster(g); let progress=0;
      if(kind==='context') canvas.getContext=()=>null;
      if(kind==='geometry') canvas.width++;
      if(kind==='encode-throw') canvas.toBlob=()=>{throw new Error('synthetic encoder failure');};
      if(kind==='encode-null') canvas.toBlob=callback=>callback(null);
      if(kind==='encode-type') canvas.toBlob=callback=>callback(new Blob(['x'],{type:'image/jpeg'}));
      if(kind==='bad-png') canvas.toBlob=callback=>callback(new Blob(['broken'],{type:'image/png'}));
      await assert.rejects(exportFlattened([g],[[]],async()=>canvas,{onProgress:()=>progress++}));
      released(canvas); assert.equal(progress,0);
    });
  }
});

test('writer embedding, flush and save errors reject atomically and allow a fresh export', async t => {
  for(const method of ['embedPng','flush','save']) await t.test(method,async t=>{
    const canvas=raster(tinyPage());
    const stub=t.mock.method(WriterDocument.prototype,method,async()=>{throw new Error(`synthetic ${method} failure`);});
    await assert.rejects(exportFlattened([tinyPage()],[[]],async()=>canvas),new RegExp(`synthetic ${method} failure`));
    released(canvas); stub.mock.restore();
    assert.equal((await exportFlattened([tinyPage()],[[]],async()=>raster(tinyPage()))).type,'application/pdf');
  });
});

test('encoded byte limit is enforced before reading an oversized PNG buffer', async () => {
  const canvas=raster(tinyPage()); let reads=0;
  canvas.toBlob=callback=>callback({type:'image/png',size:PDF_LIMITS.encodedBytes+1,
    arrayBuffer(){reads++; throw new Error('oversized PNG must not be read');}});
  await assert.rejects(exportFlattened([tinyPage()],[[]],async()=>canvas),/memory limit/);
  assert.equal(reads,0); released(canvas);
});

test('writer boundary ignores source-data properties and emits only new image resources', async () => {
  const g=tinyPage(),canvas=raster(g);
  for(const object of [g,canvas]) {
    // Geometry is frozen; a wrapper can carry unrelated data without giving the
    // writer access. Throwing getters prove these channels are never consumed.
    if(!Object.isFrozen(object)) for(const key of ['sourceBytes','metadata','attachments','text','actions']) {
      Object.defineProperty(object,key,{get(){throw new Error(`source channel read: ${key}`);}});
    }
  }
  const geometry={...g};
  for(const key of ['sourceBytes','metadata','attachments','text','actions']) Object.defineProperty(geometry,key,
    {get(){throw new Error(`source channel read: ${key}`);}});
  const blob=await exportFlattened([geometry],[[]],async()=>canvas);
  const doc=await outputDoc(blob);
  imageRgb(doc,0);
  for(const key of ['Metadata','Names','OpenAction','AA','AcroForm','Outlines','OCProperties']) {
    assert.equal(doc.catalog.has(PDFName.of(key)),false);
  }
  for(const [,object] of doc.context.enumerateIndirectObjects()) if(object instanceof PDFRawStream) {
    const subtype=object.dict.get(PDFName.of('Subtype'));
    if(subtype) assert.equal(subtype.toString(),'/Image');
    else assert(!/\b(?:BT|Tj|TJ)\b/.test(Buffer.from(decodePDFRawStream(object).decode()).toString('latin1')));
  }
  // pdf-lib metadata getters create an empty Info dictionary in memory.
  // Assert the serialized-file policy before invoking those getters.
  assert.equal(doc.context.trailerInfo.Info,undefined,'no source or generated metadata');
  assert.equal(doc.getTitle(),undefined); assert.equal(doc.getAuthor(),undefined);
  await withParsed(await blob.arrayBuffer(),async parsed=>{
    const page=await parsed.getPage(1);
    assert.deepEqual((await page.getTextContent()).items,[]);
  });
  released(canvas);
});

// LocalPdf is intentionally private. Execute its unchanged class body with a
// fake PDF.js document to exercise cleanup ordering without a browser, worker,
// network, or source rendering. A missing class anchor fails loudly.
async function localPdfHarness({cleanupFailure=false,cancelled=false}={}) {
  const source=await readFile(new URL('../dist/pdf.js',import.meta.url),'utf8');
  const body=source.match(/class LocalPdf\s*\{[\s\S]*?\n\}\s*\n\n\/\/ The writer/);
  assert(body,'private adapter class anchor');
  const classSource=body[0].slice(0,body[0].lastIndexOf('// The writer')).trim();
  const canvases=[], entered=deferred(), finish=deferred(); let cleanupCalls=0,renderCalls=0;
  const page={cleanup(){return !cancelled;},getViewport(){return {width:6,height:4};},
    render(){renderCalls++;entered.resolve();return {promise:renderCalls===1?finish.promise:Promise.resolve(),
      cancel(){finish.reject(new Error('render cancelled'));}};}};
  const doc={async getPage(){return page;},async cleanup(){
    cleanupCalls++;
    if(cleanupFailure && cleanupCalls===1) throw new Error('startCleanup: Page 1 is currently rendering.');
  }};
  const Adapter=runInNewContext(`(${classSource})`,{
    DOMException, Number, Error, exportFlattened, PDF_LIMITS,
    aborted:()=>new DOMException('Operation cancelled.','AbortError'),
    check(signal){if(signal?.aborted) throw new DOMException('Operation cancelled.','AbortError');},
    release(canvas){if(canvas) canvas.width=canvas.height=1;},
    document:{createElement(){const canvas={width:0,height:0};canvases.push(canvas);return canvas;}},
  });
  return {adapter:new Adapter(doc,{async destroy(){}},[tinyPage()]),canvases,entered,finish};
}

test('render cancellation with successful cleanup releases raster and resets busy state', async () => {
  const h=await localPdfHarness(),controller=new AbortController();
  const pending=h.adapter.render(0,{signal:controller.signal});
  await h.entered.promise; controller.abort();
  await assert.rejects(pending,isAbort); released(h.canvases[0]);
  const retry=await h.adapter.render(0);
  assert.equal(retry,h.canvases[1]);
  assert.equal(h.canvases.length,2);
  retry.width=retry.height=1;
});

test('cancelled render preserves AbortError and permits retry when PDF.js cleanup rejects', async () => {
  const h=await localPdfHarness({cleanupFailure:true,cancelled:true}),controller=new AbortController();
  const pending=h.adapter.render(0,{signal:controller.signal});
  await h.entered.promise; controller.abort();
  const error=await pending.then(()=>null,error=>error);
  const retry=await h.adapter.render(0).then(canvas=>({canvas}),error=>({error}));
  released(h.canvases[0]);
  if(retry.canvas) retry.canvas.width=retry.canvas.height=1;
  assert.deepEqual({error:error?.name,canvases:h.canvases.length},{error:'AbortError',canvases:2},
    'cleanup failure must preserve cancellation and allow retry to reach the renderer');
  assert.equal(retry.error,undefined,'cleanup failure must not leave the busy guard set');
  assert.equal(h.canvases.length,2,'retry reaches the renderer');
});
