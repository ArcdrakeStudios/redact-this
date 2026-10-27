import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {PDFDocument, PDFName, PDFRawStream, decodePDFRawStream} from 'pdf-lib';
import {pageGeometry, PDF_LIMITS, validatePageBudget, validateMasks, validatePdfEnvelope, imagePlacement, outputName} from '../dist/pdf-geometry.js';
import {exportFlattened, LocalPdf} from '../dist/pdf.js';
import {inspectPdfExport} from './pdf-export-inspection.mjs';

test('PDF geometry preserves crop dimensions, user units and all quarter turns', () => {
  for (const rotate of [0,90,180,270,-90,450]) {
    const g = pageGeometry({view:[10,20,210,120],userUnit:2,rotate});
    assert.equal(g.width,400); assert.equal(g.height,200);
    assert.equal(g.rotation,((rotate%360)+360)%360);
    const turned = g.rotation%180 !== 0;
    assert.equal(g.pixelWidth,Math.ceil((turned?200:400)*150/72));
    assert.equal(g.pixelHeight,Math.ceil((turned?400:200)*150/72));
    const p = imagePlacement(g);
    assert.equal(p.width,turned?200:400); assert.equal(p.height,turned?400:200);
    assert.equal(p.x,0); assert.equal(p.y,0);
  }
});
test('PDF page and document budgets reject nonfinite, invalid and excessive geometry', () => {
  for (const view of [[0,0,0,20],[0,0,-1,20],[0,0,Infinity,20],[0,0,1e6,1e6]]) assert.throws(() => pageGeometry({view}));
  for (const userUnit of [0,-1,NaN,Infinity]) assert.throws(() => pageGeometry({view:[0,0,10,10],userUnit}));
  assert.throws(() => pageGeometry({view:[0,0,10,10],rotate:45}));
  assert.throws(() => validatePageBudget([]));
  assert.throws(() => validatePageBudget(Array(31).fill({pixels:1})));
  assert.throws(() => validatePageBudget(Array(10).fill({pixels:11_000_000})));
  validatePageBudget([{pixels:PDF_LIMITS.totalPixels}]);
});
test('PDF masks are integer fixed pixels, bounded per page and copied before export', () => {
  const g = pageGeometry({view:[0,0,72,72]});
  const mask = {x:0,y:0,width:150,height:150};
  assert.deepEqual(validateMasks([mask],g),[mask]);
  assert.notEqual(validateMasks([mask],g)[0],mask);
  for (const bad of [{...mask,x:-1},{...mask,width:151},{...mask,height:0},{...mask,x:0.5},{...mask,x:NaN}]) assert.throws(() => validateMasks([bad],g));
  assert.throws(() => validateMasks(Array(201).fill(mask),g));
});
test('PDF envelope rejects truncation, wrong headers and invalid xref offsets', async () => {
  const doc = await PDFDocument.create(); doc.addPage([72,72]);
  const bytes = await doc.save();
  validatePdfEnvelope(bytes);
  assert.throws(() => validatePdfEnvelope(bytes.subarray(0,bytes.length-20)));
  assert.throws(() => validatePdfEnvelope(new TextEncoder().encode('%PDF-1.7\nstartxref\n0\n%%EOF\n')));
  assert.throws(() => validatePdfEnvelope(new TextEncoder().encode('<svg/>')));
});
test('output names sanitize source-only names and use the requested extension', () => {
  assert.equal(outputName('a private.file.pdf','pdf'),'a-private-file-redacted.pdf');
  assert.equal(outputName('🔒.png','png'),'--redacted.png');
  assert.equal(outputName('.pdf','pdf'),'file-redacted.pdf');
  assert.equal(outputName('a'.repeat(100)+'.pdf','pdf').length,83);
  assert.equal(outputName('salary.pdf.png','png'),'salary-pdf-redacted.png');
  assert.equal(outputName('../../private name.PDF','pdf'),'-private-name-redacted.pdf');
});

function chunk(type,data) {
  const body = Buffer.concat([Buffer.from(type),data]);
  let crc = 0xffffffff;
  for (const value of body) {crc ^= value; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const result = Buffer.alloc(data.length+12); result.writeUInt32BE(data.length); body.copy(result,4); result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);
  return result;
}
function png(width,height,pixels) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=6;
  const rows = Buffer.alloc(height*(width*4+1));
  for (let y=0;y<height;y++) Buffer.from(pixels.subarray(y*width*4,(y+1)*width*4)).copy(rows,y*(width*4+1)+1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
// A small synthetic raster exercises the writer without launching a browser.
// Browser canvas/PDF.js rendering still requires the attended acceptance gate.
function raster(width,height) {
  const pixels = new Uint8Array(width*height*4);
  for (let i=0;i<pixels.length;i+=4) {pixels[i]=240;pixels[i+1]=30;pixels[i+2]=60;pixels[i+3]=255;}
  pixels.fill(0,0,4); // transparent source pixel must become white
  const ctx = {globalCompositeOperation:'source-over',globalAlpha:1,fillStyle:'',
    setTransform(){},save(){this.saved=this.globalCompositeOperation;},restore(){this.globalCompositeOperation=this.saved;},
    fillRect(x,y,w,h){
      const rgb=this.fillStyle==='#ffffff'?[255,255,255]:[0,0,0];
      for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) {
        const i=(yy*width+xx)*4;
        if(this.globalCompositeOperation==='destination-over' && pixels[i+3]) continue;
        pixels.set([...rgb,255],i);
      }
    }};
  return {width,height,getContext:()=>ctx,toBlob(callback){callback(new Blob([png(width,height,pixels)],{type:'image/png'}));}};
}

test('writer embeds only freshly masked opaque RGB pixels, bakes rotation, and releases every raster', async () => {
  const pages = [0,90,180,270].map(rotate => pageGeometry({view:[0,0,2.88,1.92],rotate}));
  const canvases = [], progress = [];
  const masks = pages.map(() => [{x:1,y:1,width:2,height:2}]);
  const blob = await exportFlattened(pages,masks,async index => {
    assert(canvases.every(c=>c.width===1&&c.height===1),'previous raster released before next render');
    const g=pages[index], canvas=raster(g.pixelWidth,g.pixelHeight); canvases.push(canvas); return canvas;
  }, {onProgress:n=>progress.push(n)});
  assert.equal(blob.type,'application/pdf'); assert.deepEqual(progress,[1,2,3,4]);
  assert(canvases.every(c=>c.width===1&&c.height===1));
  const bytes=await blob.arrayBuffer();
  const doc=await PDFDocument.load(bytes,{updateMetadata:false});
  assert.equal(doc.context.trailerInfo.Info,undefined,'no generated names or timestamps');
  assert.equal(doc.getPageCount(),4);
  assert.equal(doc.catalog.has(PDFName.of('AcroForm')),false);
  assert.equal(doc.catalog.has(PDFName.of('Names')),false);
  assert.equal(doc.catalog.has(PDFName.of('OpenAction')),false);
  assert.equal(doc.catalog.has(PDFName.of('Metadata')),false);
  doc.getPages().forEach((page,index) => {
    const g=pages[index];
    assert.equal(page.getWidth(),g.displayWidth); assert.equal(page.getHeight(),g.displayHeight); assert.equal(page.getRotation().angle,0);
    assert.equal(page.node.has(PDFName.of('Annots')),false);
    assert.equal(page.node.Resources().has(PDFName.of('Font')),false);
    const xobjects=page.node.Resources().lookup(PDFName.of('XObject'));
    assert.equal(xobjects.keys().length,1);
    const image=xobjects.lookup(xobjects.keys()[0]); assert(image instanceof PDFRawStream);
    assert.equal(image.dict.get(PDFName.of('SMask')),undefined,'no transparency mask');
    const rgb=decodePDFRawStream(image).decode();
    assert.deepEqual([...rgb.subarray(0,3)],[255,255,255]);
    const offset=(g.pixelWidth+1)*3;
    assert.deepEqual([...rgb.subarray(offset,offset+3)],[0,0,0]);
    assert.deepEqual([...rgb.subarray(3,6)],[240,30,60]);
  });
  // Exercise the independent object/pixel/placement checker on product output,
  // including every quarter turn, not just on its own positive fixtures.
  await inspectPdfExport(bytes,{expectedPages:pages.map(g=>({
    width:g.displayWidth,height:g.displayHeight,
    pixelWidth:g.pixelWidth,pixelHeight:g.pixelHeight,
    masks:[{x:1/g.pixelWidth,y:1/g.pixelHeight,width:2/g.pixelWidth,height:2/g.pixelHeight}],
    probes:[{x:0,y:0,rgb:[255,255,255]},{x:1/g.pixelWidth,y:0,rgb:[240,30,60]}]
  }))});
});
test('writer cancellation releases partial raster and never returns a PDF', async () => {
  const pages=[pageGeometry({view:[0,0,2.88,1.92]})], controller=new AbortController();
  let canvas;
  await assert.rejects(exportFlattened(pages,[[]],async () => {
    canvas=raster(pages[0].pixelWidth,pages[0].pixelHeight); controller.abort(); return canvas;
  },{signal:controller.signal}), {name:'AbortError'});
  assert.equal(canvas.width,1); assert.equal(canvas.height,1);
});

test('cancelled render keeps AbortError when cleanup rejects and permits the next render', async () => {
  const previousDocument=globalThis.document;
  globalThis.document={createElement:()=>({width:0,height:0})};
  let active, destroyed=0, cancelled=0, cleanup=0;
  const g=pageGeometry({view:[0,0,72,144],userUnit:2,rotate:90});
  const page={getViewport(options){
    assert.deepEqual(options,{scale:150/72,rotation:90});
    return {width:g.pixelWidth,height:g.pixelHeight};
  },cleanup(){},render(options){
    assert.equal(options.canvas.width,g.pixelWidth);
    assert.equal(options.canvas.height,g.pixelHeight);
    assert.equal(options.background,'rgb(255,255,255)');
    assert.equal(options.annotationMode,1);
    const pending=Promise.withResolvers();
    active={promise:pending.promise,cancel(){cancelled++;pending.reject(new Error('cancelled'));},done:pending.resolve};
    return active;
  }};
  const source=new LocalPdf({getPage:async()=>page,cleanup:async()=>{cleanup++;throw Error('still rendering');}},
    {destroy:async()=>{destroyed++;}},[g]);
  try {
    const controller=new AbortController(), first=source.render(0,{signal:controller.signal});
    await new Promise(resolve=>setImmediate(resolve));
    controller.abort();
    await assert.rejects(first,{name:'AbortError'});
    const next=source.render(0);
    await new Promise(resolve=>setImmediate(resolve)); active.done();
    assert.equal((await next).width,g.pixelWidth);
    assert.equal(cancelled,1); assert.equal(cleanup,2);
    await Promise.all([source.dispose(),source.dispose()]);
    assert.equal(destroyed,1);
    await assert.rejects(source.render(0),/unavailable/);
  } finally {globalThis.document=previousDocument;}
});

test('a late page failure or abort after encoding never returns a partial PDF', async () => {
  const pages=[0,0].map(()=>pageGeometry({view:[0,0,2.88,1.92]}));
  const canvases=[];
  await assert.rejects(exportFlattened(pages,[[],[]],async index=>{
    if(index===1) throw Error('synthetic late failure');
    const c=raster(pages[0].pixelWidth,pages[0].pixelHeight);canvases.push(c);return c;
  }),/synthetic late failure/);
  assert(canvases.every(c=>c.width===1&&c.height===1));
  const controller=new AbortController();
  await assert.rejects(exportFlattened([pages[0]],[[]],async()=>{
    const c=raster(pages[0].pixelWidth,pages[0].pixelHeight);
    const original=c.toBlob;c.toBlob=callback=>original(blob=>{controller.abort();callback(blob);});return c;
  },{signal:controller.signal}),{name:'AbortError'});
});

test('abort during post-render cleanup releases the finished raster and returns AbortError',async()=>{
  const previous=globalThis.document,canvas={width:0,height:0};
  globalThis.document={createElement:()=>canvas};
  const cleanup=Promise.withResolvers(),controller=new AbortController();
  const source=new LocalPdf({getPage:async()=>({
    getViewport:()=>({width:150,height:150}),render:()=>({promise:Promise.resolve(),cancel(){}}),cleanup(){}
  }),cleanup:()=>cleanup.promise},{destroy:async()=>{}},[pageGeometry({view:[0,0,72,72]})]);
  try {
    const rendering=source.render(0,{signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));
    await assert.rejects(source.render(0),/unavailable/,'cleanup retains exclusive ownership');
    controller.abort();cleanup.resolve();await assert.rejects(rendering,{name:'AbortError'});
    assert.equal(canvas.width,1);assert.equal(canvas.height,1);
  } finally {await source.dispose();globalThis.document=previous;}
});
