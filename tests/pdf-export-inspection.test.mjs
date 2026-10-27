import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument, PDFName, PDFString, PDFHexString, PDFRawStream,
  decodePDFRawStream, rgb} from 'pdf-lib';
import {createSourceFixture, createRasterFixture, expectedRasterPages,
  SOURCE_MARKERS, PAGE_SPECS} from './pdf-fixtures.mjs';
import {inspectPdfExport} from './pdf-export-inspection.mjs';

const sourceBytes = await createSourceFixture();
const options = () => ({sourceBytes, sourceMarkers: SOURCE_MARKERS, expectedPages: expectedRasterPages()});
const key = PDFName.of;

test('synthetic source includes mixed pages, rotation, hidden text, metadata, attachment, form and action', async () => {
  const doc = await PDFDocument.load(sourceBytes, {updateMetadata: false});
  assert.equal(doc.getPageCount(), 3);
  doc.getPages().forEach((p,i) => {
    assert.equal(p.getWidth(), PAGE_SPECS[i].width);
    assert.equal(p.getHeight(), PAGE_SPECS[i].height);
    assert.equal(p.getRotation().angle, PAGE_SPECS[i].rotation);
  });
  assert.equal(doc.getTitle(), SOURCE_MARKERS[2]);
  assert.equal(doc.getForm().getTextField('synthetic-field').getText(), SOURCE_MARKERS[4]);
  assert.ok(doc.catalog.has(key('Metadata')));
  assert.ok(doc.catalog.has(key('OpenAction')));
  assert.ok(doc.catalog.lookup(key('Names')).has(key('EmbeddedFiles')));
  const streams = doc.context.enumerateIndirectObjects().map(([,v]) => v)
    .filter(v => v instanceof PDFRawStream).map(v => Buffer.from(decodePDFRawStream(v).decode()).toString('latin1'));
  assert.ok(streams.some(s => /3 Tr/.test(s)), 'invisible text rendering mode exists');
  assert.ok(streams.some(s => s.includes(Buffer.from(SOURCE_MARKERS[1]).toString('hex').toUpperCase())), 'OCR-like text exists');
  assert.ok(streams.some(s => s.includes(SOURCE_MARKERS[3])), 'attachment bytes exist');
  assert.ok(!Buffer.from(sourceBytes).includes(Buffer.from(SOURCE_MARKERS[3])), 'compressed attachment defeats a raw byte search');
});

for (const encoding of ['raw', 'flate', 'png', 'predictor']) {
  test(`accept independent fresh multipage ${encoding} raster with baked masks`, async () => {
    const result = await inspectPdfExport(await createRasterFixture({encoding}), options());
    assert.equal(result.pageCount, 3);
    assert.deepEqual(result.pages.map(p => [p.width,p.height]), [[667,500],[625,375],[438,313]]);
  });
}

test('accept classic cross-reference output without object streams', async () => {
  await inspectPdfExport(await createRasterFixture({objectStreams: false}), options());
});

test('reject the original and copied source pages even when saved to a new document', async () => {
  await assert.rejects(inspectPdfExport(sourceBytes, options()));
  const original = await PDFDocument.load(sourceBytes), copy = await PDFDocument.create();
  for (const page of await copy.copyPages(original, original.getPageIndices())) copy.addPage(page);
  await assert.rejects(inspectPdfExport(await copy.save(), options()));
});

test('reject missing, extra and reordered pages or wrong page dimensions', async () => {
  const good = await createRasterFixture();
  for (const expectedPages of [expectedRasterPages().slice(0,2), [...expectedRasterPages(), expectedRasterPages()[0]],
    expectedRasterPages().reverse(), expectedRasterPages().map(p => ({...p,width:p.width+1}))]) {
    await assert.rejects(inspectPdfExport(good, {...options(), expectedPages}), /page (count|width)/);
  }
});

test('reject unmasked image pixels and vector cover boxes', async () => {
  await assert.rejects(inspectPdfExport(await createRasterFixture({masked:false}), options()), /not baked black/);
  const overlay = await createRasterFixture({masked:false, mutation: doc => {
    doc.getPage(0).drawRectangle({x:32,y:168,width:64,height:48,color:rgb(0,0,0)});
  }});
  await assert.rejects(inspectPdfExport(overlay, options()), /non-raster/);
});

test('reject a single wrong pixel inside a mask, not just a center sample', async () => {
  const bad = await createRasterFixture({encoding:'raw', mutation: doc => {
    const stream = doc.getPage(0).node.Resources().lookup(key('XObject')).lookup(key('Raster'));
    stream.contents[(51 * 667 + 68) * 3] = 1;
  }});
  await assert.rejects(inspectPdfExport(bad, options()), /not baked black/);
});

test('reject black-everywhere output that destroys unmasked colored content', async () => {
  const bad = await createRasterFixture({encoding:'raw', mutation: doc => {
    for (const page of doc.getPages()) page.node.Resources().lookup(key('XObject')).lookup(key('Raster')).contents.fill(0);
  }});
  await assert.rejects(inspectPdfExport(bad, options()), /outside pixel/);
});

test('reject 72 DPI output and damaged outside areas that preserve the single probe',async()=>{
  await assert.rejects(inspectPdfExport(await createRasterFixture({dpi:72}),options()),/fixed DPI/);
  const damaged=await createRasterFixture({encoding:'raw',mutation:doc=>{
    const image=doc.getPage(0).node.Resources().lookup(key('XObject')).lookup(key('Raster'));
    image.contents[0]=0;
  }});
  await assert.rejects(inspectPdfExport(damaged,options()),/outside pixel/);
});

const mutations = {
  'source Info metadata': doc => doc.setTitle(SOURCE_MARKERS[2]),
  'XML metadata stream': doc => doc.catalog.set(key('Metadata'), doc.context.register(
    doc.context.flateStream(Buffer.from('<metadata>synthetic</metadata>'), {Type:'Metadata',Subtype:'XML'}))),
  'compressed attachment': doc => doc.attach(Buffer.from(SOURCE_MARKERS[3]), 'synthetic.txt'),
  'form field': doc => doc.getForm().createTextField('synthetic').setText(SOURCE_MARKERS[4]),
  'open action': doc => doc.catalog.set(key('OpenAction'), doc.context.obj({S:'JavaScript',JS:PDFString.of('synthetic()')})),
  'page action': doc => doc.getPage(0).node.set(key('AA'), doc.context.obj({O:{S:'Named',N:'Print'}})),
  'link annotation': doc => doc.getPage(0).node.set(key('Annots'), doc.context.obj([{Type:'Annot',Subtype:'Link',Rect:[0,0,20,20]}])),
  'orphan hidden string': doc => doc.context.register(PDFHexString.fromText(SOURCE_MARKERS[1])),
  'orphan compressed stream': doc => doc.context.register(doc.context.flateStream(Buffer.from('BT (hidden) Tj ET'))),
  'orphan font': doc => doc.context.register(doc.context.obj({Type:'Font',Subtype:'Type1',BaseFont:'Helvetica'})),
  'source form XObject': doc => doc.context.register(doc.context.obj({Type:'XObject',Subtype:'Form'})),
  'transparent mask': doc => doc.getPage(0).node.Resources().lookup(key('XObject')).lookup(key('Raster')).dict.set(key('SMask'), key('None')),
  'lossy image encoding': doc => doc.getPage(0).node.Resources().lookup(key('XObject')).lookup(key('Raster')).dict.set(key('Filter'),key('DCTDecode')),
  'wrong image placement': doc => doc.getPage(0).node.set(key('Contents'), doc.context.register(
    doc.context.flateStream(Buffer.from('q 160 0 0 240 0 0 cm /Raster Do Q')))),
  'text in page content': doc => doc.getPage(0).node.set(key('Contents'), doc.context.register(
    doc.context.flateStream(Buffer.from('q 320 0 0 240 0 0 cm /Raster Do Q BT (secret) Tj ET')))),
};
for (const [label, mutation] of Object.entries(mutations)) {
  test(`reject known-bad control: ${label}`, async () => {
    await assert.rejects(inspectPdfExport(await createRasterFixture({mutation}), options()));
  });
}

test('reject reuse of decoded source streams, independent of PDF object numbering/compression', async () => {
  const bytes = await createRasterFixture();
  await assert.rejects(inspectPdfExport(bytes, {...options(),sourceBytes:bytes}), /source stream reused/);
});

test('reject malformed files rather than reporting successful inspection', async () => {
  await assert.rejects(inspectPdfExport(Buffer.from('%PDF-1.7\ninvalid'), options()));
});
