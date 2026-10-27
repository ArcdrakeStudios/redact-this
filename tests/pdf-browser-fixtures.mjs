// Invented documents only. No product code is used to compute the oracle.
import {readFile} from 'node:fs/promises';
import {PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb,
  setTextRenderingMode, TextRenderingMode} from 'pdf-lib';
import {SOURCE_MARKERS, BACKGROUND} from './pdf-fixtures.mjs';

export const BROWSER_PAGE_SPECS = [
  {media:[360,288], crop:[24,36,288,192], unit:1, rotation:0},
  {media:[288,432], crop:[24,48,192,288], unit:1.25, rotation:90},
  {media:[288,216], crop:[12,24,240,144], unit:2, rotation:180},
  {media:[432,288], crop:[36,24,288,192], unit:.75, rotation:270},
];
const patches = [
  {x:.2,y:.2,rgb:[224,32,64]}, {x:.8,y:.2,rgb:[32,192,64]},
  {x:.2,y:.8,rgb:[64,32,224]}, {x:.8,y:.8,rgb:[224,192,32]},
];
function displayed(x, y, rotation) {
  return {0:[x,y],90:[1-y,x],180:[1-x,1-y],270:[y,1-x]}[rotation];
}
export const BROWSER_EXPECTED_PAGES = BROWSER_PAGE_SPECS.map((s, index) => {
  const width = s.crop[2] * s.unit, height = s.crop[3] * s.unit;
  const turned = s.rotation % 180 !== 0;
  const pixelWidth = Math.ceil((turned ? height : width) * 150 / 72);
  const pixelHeight = Math.ceil((turned ? width : height) * 150 / 72);
  // Distinct rectangles make accidentally sharing/reordering mask arrays visible.
  const maskPixels = {x:30+index*11,y:Math.round(pixelHeight*.42),width:65+index*7,height:40+index*5};
  return {width:turned?height:width,height:turned?width:height,rotation:0,
    sourceRotation:s.rotation,pixelWidth,pixelHeight,maskPixels,
    masks:[{x:maskPixels.x/pixelWidth,y:maskPixels.y/pixelHeight,
      width:maskPixels.width/pixelWidth,height:maskPixels.height/pixelHeight}],
    colorRegions:patches.map(p => {
      const [x,y] = displayed(p.x,p.y,s.rotation);
      return {x:x-.035,y:y-.035,width:.07,height:.07,rgb:p.rgb};
    }), probes:[[.6,.35],[.5,.65]].map(([x,y])=>{
      const [px,py]=displayed(x,y,s.rotation); return {x:px,y:py,rgb:BACKGROUND};
    }).concat([
      // Blank gutter proves opaque white compositing beyond colored artwork.
      {x:displayed(.02,.02,s.rotation)[0],y:displayed(.02,.02,s.rotation)[1],rgb:[255,255,255]}]),
  };
});

export async function createBrowserSourceFixture() {
  const doc = await PDFDocument.create();
  doc.setTitle(SOURCE_MARKERS[2]); doc.setAuthor(SOURCE_MARKERS[2]);
  doc.setSubject(SOURCE_MARKERS[2]); doc.setKeywords([SOURCE_MARKERS[2]]);
  const fonts = await Promise.all([StandardFonts.Helvetica,StandardFonts.Courier].map(name=>doc.embedFont(name)));
  for (const [index,s] of BROWSER_PAGE_SPECS.entries()) {
    const font=fonts[index%fonts.length];
    const p = doc.addPage(s.media), [x,y,w,h] = s.crop;
    p.setCropBox(x,y,w,h); p.setRotation(degrees(s.rotation));
    p.node.set(PDFName.of('UserUnit'), doc.context.obj(s.unit));
    // Deliberately leave an unpainted gutter; source PDF has no white rectangle.
    p.drawRectangle({x:x+w*.05,y:y+h*.05,width:w*.9,height:h*.9,
      color:rgb(...BACKGROUND.map(c=>c/255))});
    for (const patch of patches) p.drawRectangle({x:x+w*(patch.x-.1),
      y:y+h*(1-patch.y-.1),width:w*.2,height:h*.2,
      color:rgb(...patch.rgb.map(c=>c/255))});
    p.drawText(SOURCE_MARKERS[0],{x:x+w*.3,y:y+h*.5,font,size:5});
    p.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
    p.drawText(SOURCE_MARKERS[1],{x:x+w*.3,y:y+h*.6,font,size:5});
    p.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
    p.node.delete(PDFName.of('Annots'));
  }
  // Do NOT call getForm(): this importer intentionally rejects AcroForm PDFs.
  await doc.attach(Buffer.from(SOURCE_MARKERS[3]),'synthetic-note.txt',{mimeType:'text/plain'});
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.flateStream(
    Buffer.from(`<metadata>${SOURCE_MARKERS[2]}</metadata>`),{Type:'Metadata',Subtype:'XML'})));
  doc.catalog.set(PDFName.of('OpenAction'),doc.context.register(doc.context.obj({
    Type:'Action',S:'JavaScript',JS:PDFString.of(`globalThis.__syntheticPdfActionRan = true; /* ${SOURCE_MARKERS[5]} */`),
  })));
  return Buffer.from(await doc.save());
}

export async function createRejectedBrowserFixture(kind) {
  if (kind === 'encrypted-password' || kind === 'encrypted-empty-password') {
    return readFile(new URL(`./fixtures/${kind}.pdf`, import.meta.url));
  }
  const doc = await PDFDocument.create(); doc.addPage([144,144]);
  if (kind === 'forms') {
    const field = doc.getForm().createTextField('synthetic'); field.setText(SOURCE_MARKERS[4]);
    field.addToPage(doc.getPage(0),{x:10,y:10,width:100,height:20});
  } else if (kind === 'layers') {
    const layer = doc.context.register(doc.context.obj({Type:'OCG',Name:PDFString.of('Synthetic layer')}));
    doc.catalog.set(PDFName.of('OCProperties'),doc.context.obj({OCGs:[layer],D:{Order:[layer],ON:[layer]}}));
  } else if (kind === 'pages') {
    for (let i=1;i<31;i++) doc.addPage([144,144]);
  } else throw new Error(`Unknown fixture kind: ${kind}`);
  return Buffer.from(await doc.save());
}
