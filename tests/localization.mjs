import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const shrink = JSON.parse(await readFile('package.json')).name === 'shrink-this-image';
const url = `http://127.0.0.1:${shrink ? 4178 : 43148}`;
const server = spawn(process.execPath, ['scripts/serve.mjs'], {stdio:['ignore','pipe','inherit'],windowsHide:true});
let browser;
try {
  await new Promise((resolve,reject) => {server.stdout.once('data',resolve); server.once('error',reject);});
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({locale:'en-US',acceptDownloads:true});
  const page = await context.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/?lang=de');
  await page.waitForFunction(()=>document.documentElement.lang==='de');
  assert.match(await page.locator('h1').innerText(), shrink ? /Verkleinere/ : /Verdecke/);
  assert.equal(await page.locator('#language').inputValue(),'de');
  assert.equal(await page.evaluate(()=>localStorage.getItem('arcdrake-tools-language')),'de');
  // Every explicit core validation/encoding failure has a German translation.
  const sources=await Promise.all((shrink?['image']:['image','regions','pdf','pdf-geometry','pdf-resources']).map(name=>readFile(`dist/${name}.js`,'utf8')));
  const messages=sources.flatMap(source=>[...source.matchAll(/(?:new Error|throw Error)\('([^']+)'\)/g)].map(match=>match[1]));
  const missing=await page.evaluate(async messages=>{const {translate}=await import('./i18n.js');return messages.filter(message=>translate(message)===message);},messages);
  assert.deepEqual(missing,[]);
  // Static markup must not silently retain English copy as new UI is added.
  const untranslated=await page.evaluate(async markup=>{
    const {translate}=await import('./i18n.js');
    const allowed=new Set(['▰','Redact This','▧','Redact This / Arcdrake','ARCDRAKE','.','01','02','KB','MB','Arcdrake']);
    const source=new DOMParser().parseFromString(markup,'text/html');
    const walker=document.createTreeWalker(source.documentElement,NodeFilter.SHOW_TEXT),missing=[];
    while(walker.nextNode()){const node=walker.currentNode,text=node.data.trim();if(text&&!node.parentElement.closest('script,style,noscript')&&!allowed.has(text)&&translate(text)===text)missing.push(text);}
    return missing;
  },await readFile('dist/index.html','utf8'));
  assert.deepEqual(untranslated,[]);
  await page.locator('#file').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('beschädigt'));
  await page.selectOption('#language','en');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('damaged'));
  // A generated local fixture avoids any external image or upload service.
  const bytes=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200;const ctx=canvas.getContext('2d');ctx.fillStyle='#ee6600';ctx.fillRect(0,0,300,200);return Array.from(Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0)));});
  await page.locator('#file').setInputFiles({name:'Mein-Original.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Image ready'));
  if (shrink) {
    await page.selectOption('#target','custom'); await page.fill('#custom-size','250'); await page.selectOption('#format','image/png');
    await page.click('#shrink'); await page.locator('#result').waitFor({state:'visible'});
    const href=await page.locator('#download').getAttribute('href');
    await page.selectOption('#language','de');
    assert.equal(await page.locator('#download').getAttribute('href'),href);
    assert.equal(await page.locator('#custom-size').inputValue(),'250');
    assert.equal(await page.locator('#format').inputValue(),'image/png');
    assert.match(await page.locator('#result-info').innerText(),/unter/);
    assert.match(await page.locator('#status').innerText(),/Original war bereits klein|Fertig/);
    const download=page.waitForEvent('download'); await page.click('#download'); assert.equal((await download).suggestedFilename(),'Mein-Original-small.png');
  } else {
    await page.fill('#x','10'); await page.fill('#width','50'); await page.click('#add'); await page.click('#preview');
    const before=await page.locator('#canvas').evaluate(canvas=>canvas.toDataURL());
    await page.selectOption('#language','de');
    assert.equal(await page.locator('#canvas').evaluate(canvas=>canvas.toDataURL()),before);
    assert.equal(await page.locator('#x').inputValue(),'10');
    assert.equal(await page.locator('#count').innerText(),'1 deckende Maske');
    assert.match(await page.locator('#preview').innerText(),/Zurück/);
    assert.equal(await page.locator('#regions button').getAttribute('aria-label'),'Maske 1 entfernen');
    const download=page.waitForEvent('download'); await page.click('#export'); assert.equal((await download).suggestedFilename(),'Mein-Original-redacted.png');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('heruntergeladen'));
  }
  assert.equal(await page.locator('#filename').innerText(),'Mein-Original.png');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('arcdrake-language-change',{detail:{language:'en'}})));
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.match(page.url(),/lang=en/);
  await page.goto(url); assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.goto(url+'/?lang=de'); assert.equal(await page.locator('html').getAttribute('lang'),'de');
  await page.goto(url); assert.equal(await page.locator('html').getAttribute('lang'),'de');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
  await mkdir('artifacts',{recursive:true}); await page.screenshot({path:'artifacts/german-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000}); await page.screenshot({path:'artifacts/german-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: German/English static UI, validation errors, retained image/settings/masks/result, exports, shared event, query/preference, mobile width; no browser errors.');
} finally {await browser?.close(); server.kill();}
