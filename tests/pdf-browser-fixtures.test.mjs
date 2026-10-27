import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument, PDFName, PDFRawStream, decodePDFRawStream} from 'pdf-lib';
import {createBrowserSourceFixture, createRejectedBrowserFixture,
  BROWSER_PAGE_SPECS, BROWSER_EXPECTED_PAGES} from './pdf-browser-fixtures.mjs';
import {SOURCE_MARKERS, encodeRgbPng, BACKGROUND} from './pdf-fixtures.mjs';
import {inspectPdfExport} from './pdf-export-inspection.mjs';
import {exportFlattened} from '../dist/pdf.js';

const sourceBytes=await createBrowserSourceFixture();
const key=PDFName.of;
test('accepted browser fixture has crop, user units and quarter turns, without forms or layers',async()=>{
  const doc=await PDFDocument.load(sourceBytes,{updateMetadata:false});
  assert.equal(doc.getPageCount(),4);
  for(const k of ['AcroForm','OCProperties']) assert.equal(doc.catalog.has(key(k)),false);
  for(const k of ['Metadata','OpenAction','Names']) assert.equal(doc.catalog.has(key(k)),true);
  assert.equal(doc.getTitle(),SOURCE_MARKERS[2]);
  doc.getPages().forEach((p,i)=>{
    const spec=BROWSER_PAGE_SPECS[i], [x,y,width,height]=spec.crop;
    assert.deepEqual(p.getCropBox(),{x,y,width,height});
    assert.equal(p.getRotation().angle,spec.rotation);
    assert.equal(p.node.lookup(key('UserUnit')).asNumber(),spec.unit);
    assert.equal(p.node.has(key('Annots')),false);
  });
  const streams=doc.context.enumerateIndirectObjects().map(([,v])=>v).filter(v=>v instanceof PDFRawStream)
    .map(s=>Buffer.from(decodePDFRawStream(s).decode()).toString('latin1'));
  for(const marker of [SOURCE_MARKERS[0],SOURCE_MARKERS[1]]) {
    assert.ok(streams.some(s=>s.includes(Buffer.from(marker).toString('hex').toUpperCase())));
  }
  assert.ok(streams.some(s=>s.includes('3 Tr')));
  assert.ok(streams.some(s=>s.includes(SOURCE_MARKERS[3])));
});

test('rejection controls independently contain AcroForm, optional layers or 31 pages',async()=>{
  const forms=await PDFDocument.load(await createRejectedBrowserFixture('forms'));
  assert.equal(forms.catalog.has(key('AcroForm')),true);
  const layers=await PDFDocument.load(await createRejectedBrowserFixture('layers'));
  assert.equal(layers.catalog.lookup(key('OCProperties')).lookup(key('OCGs')).size(),1);
  assert.equal((await PDFDocument.load(await createRejectedBrowserFixture('pages'))).getPageCount(),31);
});

// Opaque synthetic canvases test writer/oracle interoperability without browser
// rendering. The separate browser suite must prove the source rendering itself.
function canvasFor(expected,{maskColor,maskAlpha,skipWhite=false}={}) {
  const {pixelWidth:width,pixelHeight:height}=expected;
  const pixels=Buffer.alloc(width*height*3);
  for(let i=0;i<pixels.length;i+=3) pixels.set(BACKGROUND,i);
  function fill(x,y,w,h,color) {
    for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) pixels.set(color,(yy*width+xx)*3);
  }
  // Give every requested outside region a small surrounding safety margin.
  for(const r of expected.colorRegions) {
    const x=Math.floor((r.x-.01)*width),y=Math.floor((r.y-.01)*height);
    fill(x,y,Math.ceil((r.width+.02)*width),Math.ceil((r.height+.02)*height),r.rgb);
  }
  for(const p of expected.probes) fill(Math.floor(p.x*width)-1,Math.floor(p.y*height)-1,3,3,p.rgb);
  const alpha=Buffer.alloc(width*height,255);
  for(const p of expected.probes.filter(p=>p.rgb.every(v=>v===255))) {
    const x=Math.floor(p.x*width),y=Math.floor(p.y*height);
    fill(x-1,y-1,3,3,[0,0,0]);
    for(let yy=y-1;yy<=y+1;yy++) for(let xx=x-1;xx<=x+1;xx++) alpha[yy*width+xx]=0;
  }
  const ctx={globalCompositeOperation:'source-over',globalAlpha:1,fillStyle:'#000000',
    setTransform(...m){assert.deepEqual(m,[1,0,0,1,0,0]);},
    save(){this.prior=this.globalCompositeOperation;},restore(){this.globalCompositeOperation=this.prior;},
    fillRect(x,y,w,h){
      const behind=this.globalCompositeOperation==='destination-over';
      if(behind && skipWhite)return;
      const color=(!behind && maskColor) || this.fillStyle.slice(1).match(/../g).map(h=>parseInt(h,16));
      for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) {
        const i=yy*width+xx,a=alpha[i]/255,s=!behind && maskAlpha!==undefined?maskAlpha:this.globalAlpha;
        const out=s+a*(1-s),amount=behind?s*(1-a):s;
        for(let c=0;c<3;c++) pixels[i*3+c]=Math.round((color[c]*amount+pixels[i*3+c]*(behind?a:a*(1-s)))/(out||1));
        alpha[i]=Math.round(out*255);
      }
    }};
  return {width,height,getContext:()=>ctx,
    toBlob(callback){callback(new Blob([encodeRgbPng(width,height,pixels)],{type:'image/png'}));}};
}
async function writerOutput(canvasOptions) {
  const pages=BROWSER_EXPECTED_PAGES.map(p=>({...p,
    displayWidth:p.rotation%180?p.height:p.width,displayHeight:p.rotation%180?p.width:p.height,
    pixels:p.pixelWidth*p.pixelHeight}));
  const blob=await exportFlattened(pages,pages.map(p=>[p.maskPixels]),async i=>canvasFor(pages[i],canvasOptions));
  return new Uint8Array(await blob.arrayBuffer());
}
const options=()=>({expectedPages:BROWSER_EXPECTED_PAGES,sourceBytes,sourceMarkers:SOURCE_MARKERS});

test('real writer output passes independent placement, 150 DPI, masked pixels and privacy checks for all rotations',async()=>{
  const result=await inspectPdfExport(await writerOutput(),options());
  assert.deepEqual(result.pages.map(p=>[p.width,p.height]),[[600,400],[750,500],[1000,600],[300,450]]);
});

test('pixel oracle rejects incorrect mask color, partial opacity and omitted white compositing',async()=>{
  for(const configuration of [{maskColor:[128,128,128]},{maskAlpha:.5},{skipWhite:true}]) {
    await assert.rejects(inspectPdfExport(await writerOutput(configuration),options()),/mask is not baked black|outside pixel/);
  }
});

test('rotation support still rejects wrong rotation, placement, units, resolution and privacy leaks',async()=>{
  const good=await writerOutput();
  const mutations=[
    ['rotation',doc=>doc.getPage(1).node.set(key('Rotate'),doc.context.obj(90)),/rotation/],
    ['placement',doc=>doc.getPage(1).node.set(key('Contents'),doc.context.register(doc.context.flateStream(
      Buffer.from('q 240 0 0 360 0 0 cm /Unused Do Q')))),/image placement/],
    ['units',doc=>doc.getPage(1).node.set(key('UserUnit'),doc.context.obj(2)),/UserUnit/],
    ['metadata',doc=>doc.setTitle(SOURCE_MARKERS[2]),/metadata|marker/],
    ['action',doc=>doc.catalog.set(key('OpenAction'),doc.context.obj({S:'Named',N:'Print'})),/forbidden/],
  ];
  for(const [label,mutate,pattern] of mutations) {
    const doc=await PDFDocument.load(good,{updateMetadata:false});mutate(doc);
    await assert.rejects(inspectPdfExport(await doc.save(),options()),pattern,label);
  }
  const wrongResolution=BROWSER_EXPECTED_PAGES.map(p=>({...p,pixelWidth:p.pixelWidth-1}));
  await assert.rejects(inspectPdfExport(good,{...options(),expectedPages:wrongResolution}),/pixel width/);
  const wrongColor=BROWSER_EXPECTED_PAGES.map(p=>({...p,colorRegions:p.colorRegions.map(r=>({...r,rgb:[1,2,3]}))}));
  await assert.rejects(inspectPdfExport(good,{...options(),expectedPages:wrongColor}),/outside color region/);
  // Output rotation stays baked into pixels, with displayed physical dimensions.
});
