import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const moduleSpecifier = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
const {chromium} = await import(moduleSpecifier).catch(() => {throw new Error('Browser checks require an installed playwright package or PLAYWRIGHT_MODULE pointing to its index.mjs.');});
await mkdir('artifacts', {recursive:true});
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1100}, acceptDownloads:true});
const page = await context.newPage();
const passed = [], errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const value of body) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

async function upload(buffer, name='private.png', mimeType='image/png') {
  await page.locator('#file').setInputFiles({name, mimeType, buffer});
  await page.locator('#loaded').waitFor({state:'visible'});
}

async function download() {
  const pending = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await pending;
  await file.saveAs('artifacts/redacted.png');
  return readFile('artifacts/redacted.png');
}

async function pixels(buffer) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
    const c = document.createElement('canvas'); c.width=image.width; c.height=image.height;
    const ctx=c.getContext('2d'); ctx.drawImage(image,0,0); image.close();
    return {width:c.width, height:c.height, mask:[...ctx.getImageData(40,40,1,1).data], outside:[...ctx.getImageData(200,150,1,1).data]};
  }, buffer.toString('base64'));
}

try {
  await page.goto('http://127.0.0.1:43148');
  await page.screenshot({path:'artifacts/desktop-empty.png',fullPage:true});
  const fixtures = await page.evaluate(() => {
    const c=document.createElement('canvas'); c.width=640; c.height=400;
    const ctx=c.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,640,400);
    ctx.fillStyle='#193d2c'; ctx.fillRect(0,0,640,70); ctx.fillStyle='white'; ctx.font='bold 26px sans-serif'; ctx.fillText('PRIVATE / Example document',30,45);
    ctx.fillStyle='#ea2747'; ctx.fillRect(20,20,100,100);
    ctx.fillStyle='#243e32'; ctx.font='22px sans-serif'; ctx.fillText('Name: Alex Example',30,170);ctx.fillText('Account: 1234 5678',30,220);ctx.fillText('Only share what you intend.',30,320);
    return {png:c.toDataURL('image/png').split(',')[1], jpg:c.toDataURL('image/jpeg').split(',')[1], webp:c.toDataURL('image/webp').split(',')[1]};
  });
  const raw=Buffer.from(fixtures.png,'base64');
  const metadata=chunk('tEXt',Buffer.from('Comment\0SECRET_ORIGINAL_METADATA'));
  const source=Buffer.concat([raw.subarray(0,33),metadata,raw.subarray(33)]);
  await upload(source);
  await page.locator('#x').fill('20'); await page.locator('#y').fill('20'); await page.locator('#width').fill('100'); await page.locator('#height').fill('100');
  await page.locator('#add').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('.region').count(),1); passed.push('keyboard coordinates add opaque mask');
  await page.locator('#preview').click(); assert.equal(await page.locator('#add').isDisabled(),true);
  await page.screenshot({path:'artifacts/desktop-preview.png',fullPage:true});
  const output=await download(), result=await pixels(output);
  assert.deepEqual(result.mask,[0,0,0,255]); assert.deepEqual(result.outside,[255,255,255,255]); assert.equal(result.width,640);assert.equal(result.height,400);
  assert.equal(output.includes(Buffer.from('SECRET_ORIGINAL_METADATA')),false); assert.deepEqual([...output.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  passed.push('real PNG download has opaque redacted pixels and unchanged outside pixels at original resolution');
  passed.push('original embedded metadata is absent from freshly encoded output');
  await page.locator('#preview').click();
  const bounds=await page.locator('#canvas').boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height*.45);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.65);await page.mouse.up();
  assert.equal(await page.locator('.region').count(),2);passed.push('pointer drag adds second mask');
  await page.locator('#undo').click();assert.equal(await page.locator('.region').count(),1);
  await page.getByRole('button',{name:'Remove mask 1'}).click();assert.equal(await page.locator('.region').count(),0);assert.equal(await page.locator('#undo').isDisabled(),true);passed.push('undo and remove restore editable state');
  for (const [format,type] of [['jpg','image/jpeg'],['webp','image/webp']]) {
    await upload(Buffer.from(fixtures[format],'base64'),`test.${format}`,type);
    await page.locator('#add').click(); assert.deepEqual((await pixels(await download())).mask,[0,0,0,255]);
  }
  passed.push('JPG and WebP inputs export actual opaque PNG pixels');
  const exif=Buffer.from([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const jpeg=Buffer.from(fixtures.jpg,'base64');
  await upload(Buffer.concat([jpeg.subarray(0,2),exif,jpeg.subarray(2)]),'portrait.jpg','image/jpeg');
  assert.match(await page.locator('#dimensions').innerText(),/400 × 640/);
  await page.locator('#add').click();
  const oriented=await download();
  assert.equal((await pixels(oriented)).width,400);assert.equal((await pixels(oriented)).height,640);
  assert.equal(oriented.includes(Buffer.from('Exif')),false);passed.push('EXIF orientation applied to pixels without retaining original EXIF');
  await page.locator('#file').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await page.getByRole('status').filter({hasText:'supported'}).waitFor();assert.equal(await page.locator('#loaded').isVisible(),false);passed.push('invalid replacement hides old image and export');
  const huge=Buffer.from(raw);huge.writeUInt32BE(10000,16);huge.writeUInt32BE(10000,20);
  await page.locator('#file').setInputFiles({name:'huge.png',mimeType:'image/png',buffer:huge});
  await page.getByRole('status').filter({hasText:'too large'}).waitFor();passed.push('oversized decoded dimensions rejected before decode');
  await upload(source);await page.locator('#add').click();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:320,height:720});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));passed.push('390 and 320 pixel mobile layout has no overflow');
  const chooser=page.waitForEvent('filechooser');await page.locator('#replace').focus();await page.keyboard.press('Enter');await (await chooser).setFiles({name:'keyboard.png',mimeType:'image/png',buffer:raw});await page.getByRole('status').filter({hasText:'Image ready'}).waitFor();passed.push('keyboard replacement opens real file chooser');
  let downloads=0;page.on('download',()=>downloads++);
  for (const change of ['add','remove','replace']) {
    if (change==='remove') await page.locator('#add').click();
    await page.evaluate(() => {
      window.__toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback,...args) {
        window.__toBlob.call(this,blob=>{window.__releaseEncoding=()=>callback(blob);},...args);
      };
    });
    await page.locator('#export').click();
    await page.waitForFunction(()=>typeof window.__releaseEncoding==='function');
    if(change==='add') await page.locator('#add').click();
    else if(change==='remove') await page.getByRole('button',{name:'Remove mask 1'}).click();
    else await upload(raw);
    await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.__toBlob;window.__releaseEncoding();delete window.__releaseEncoding;});
    await page.waitForFunction(()=>!document.getElementById('export').disabled);
    if(change!=='replace') assert.match(await page.locator('#status').innerText(),/Masks changed/);
    assert.equal(downloads,0);
  }
  passed.push('delayed encoding cancels stale output after mask add, remove, or image replacement');
  await page.evaluate(()=>{dispatchEvent(new Event('pagehide'));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  assert.equal(await page.locator('#loaded').isVisible(),false);await upload(raw);passed.push('restored page resets closed bitmap and accepts a fresh image');
  await context.setOffline(true);await page.locator('#add').click();await download();passed.push('redaction and export works offline after loading');
  assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith('http://127.0.0.1:43148/')));passed.push('no external requests or uncaught runtime errors');
  const report={browser:browser.version(),passed,errors,requests};await writeFile('artifacts/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
