// Attended command: node tests/pdf-browser.mjs
// Starts/stops its own local server. Intentionally excluded from npm test.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {PDFDocument, PDFName, decodePDFRawStream} from 'pdf-lib';
import {inspectPdfExport} from './pdf-export-inspection.mjs';
import {SOURCE_MARKERS, encodeRgbPng} from './pdf-fixtures.mjs';
import {createBrowserSourceFixture, createRejectedBrowserFixture,
  BROWSER_EXPECTED_PAGES as expectedPages} from './pdf-browser-fixtures.mjs';

const moduleSpecifier = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
const {chromium} = await import(moduleSpecifier).catch(() => {
  throw new Error('Requires installed Playwright or PLAYWRIGHT_MODULE pointing to index.mjs.');
});
const base = 'http://127.0.0.1:43148';
const artifactDir = 'artifacts/pdf-browser';
await mkdir(artifactDir,{recursive:true});
const source = await createBrowserSourceFixture();
const image = encodeRgbPng(160,120,Buffer.alloc(160*120*3,224));
const report = {browser:null,passed:[],failed:[],requests:[],externalRequests:[],pageErrors:[],consoleErrors:[],failedRequests:[],serverErrors:[],
  imageRegressionHandoff:'npm run test:ci and npm run test:i18n remain required separately'};
let server, browser;

async function ready(page) {
  await page.waitForFunction(() => {
    if(!document.querySelector('#cancel').hidden) return false;
    // Export restores its editing raster asynchronously after the download starts.
    // Keep waiting; an actual restoration failure still fails this bounded wait.
    if(document.querySelector('#loaded').hidden || document.querySelector('#canvas').hidden) return false;
    return true;
  });
}
async function upload(page,buffer=source,name='Synthetic report.pdf',mimeType='application/pdf') {
  await page.locator('#file').setInputFiles({name,mimeType,buffer}); await ready(page);
  assert.equal(await page.evaluate(()=>globalThis.__syntheticPdfActionRan),undefined,'source action must never execute');
}
async function pageNumber(page,n) {
  await ready(page); assert.equal(await page.locator('#page-number').innerText(),`Page ${n} of ${expectedPages.length}`);
  const g=expectedPages[n-1];
  assert.deepEqual(await page.locator('#canvas').evaluate(c=>[c.width,c.height]),[g.pixelWidth,g.pixelHeight]);
}
async function add(page,rect) {
  for (const id of ['x','y','width','height']) await page.locator(`#${id}`).fill(String(rect[id]));
  await page.locator('#add').focus(); await page.keyboard.press('Enter');
}
async function keyboardClick(page,id) {
  await page.locator(`#${id}`).focus(); await page.keyboard.press('Enter');
}
async function reviewAll(page,{masks=false}={}) {
  for(let i=0;i<expectedPages.length;i++) {
    await pageNumber(page,i+1);
    if(masks) await add(page,expectedPages[i].maskPixels);
    if(!await page.locator('#review-page').isDisabled()) await keyboardClick(page,'review-page');
    if(i<expectedPages.length-1) await keyboardClick(page,'next-page');
  }
  assert.equal(await page.locator('#export').isEnabled(),true);
}
async function saveDownload(page,label,extension='pdf') {
  const event = page.waitForEvent('download'); await keyboardClick(page,'export');
  const download=await event;
  assert.equal(await download.failure(),null);
  assert.equal(download.suggestedFilename(),`Synthetic-report-redacted.${extension}`);
  const path=`${artifactDir}/${label}.${extension}`; await download.saveAs(path);
  await ready(page);
  const types=await page.evaluate(()=>window.__downloadBlobs);
  const downloaded=types.find(blob=>blob.url===download.url());
  assert.ok(downloaded,'download URL must identify the recorded output blob');
  assert.equal(downloaded.type,extension==='pdf'?'application/pdf':'image/png');
  const bytes=await readFile(path); assert.equal(bytes.length,downloaded.size);
  if(extension==='pdf') assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  return bytes;
}
async function inspect(bytes,expected=expectedPages) {
  return inspectPdfExport(bytes,{expectedPages:expected,sourceBytes:source,sourceMarkers:SOURCE_MARKERS});
}
async function pagePixelHashes(bytes) {
  const doc = await PDFDocument.load(bytes,{updateMetadata:false});
  return doc.getPages().map(page => {
    const objects = page.node.Resources().lookup(PDFName.of('XObject'));
    assert.equal(objects.keys().length,1);
    const pixels = decodePDFRawStream(objects.lookup(objects.keys()[0])).decode();
    return createHash('sha256').update(pixels).digest('hex');
  });
}
async function delayEncoding(page) {
  // Intercept the real asynchronous PNG result, never fabricate the export PDF.
  await page.evaluate(() => {
    const native=HTMLCanvasElement.prototype.toBlob;
    window.__encodingGate={held:false,released:false};
    HTMLCanvasElement.prototype.toBlob=function(callback,...args) {
      HTMLCanvasElement.prototype.toBlob=native;
      native.call(this,blob=>{
        window.__encodingGate.held=true;
        window.__encodingGate.release=fail=>{
          callback(fail?null:blob); window.__encodingGate.released=true;
        };
      },...args);
    };
  });
  await keyboardClick(page,'export');
  await page.waitForFunction(()=>window.__encodingGate?.held);
}
async function releaseEncoding(page,fail=false) {
  await page.evaluate(async fail=>{
    window.__encodingGate.release(fail);
    // Drain tasks after the callback so stale completion/error handlers can run.
    await new Promise(resolve=>setTimeout(resolve,100));
  },fail);
}
async function caseWithPage(label,run) {
  const context=await browser.newContext({viewport:{width:1440,height:1100},
    locale:'en-US',acceptDownloads:true,serviceWorkers:'block'});
  const errors=[], external=[], consoleErrors=[], failedRequests=[], badResponses=[];
  context.on('request',request=>{
    const entry={case:label,url:request.url(),method:request.method()}; report.requests.push(entry);
    if(!entry.url.startsWith(`${base}/`) && !/^(blob:|data:)/.test(entry.url)) external.push(entry);
    if(!['GET','HEAD'].includes(entry.method)) external.push(entry);
  });
  // This covers workers too. An unexpected request is blocked and fails the case.
  await context.route('**/*',route=>{
    const r=route.request(), url=r.url();
    if((url.startsWith(`${base}/`) || /^(blob:|data:)/.test(url)) && ['GET','HEAD'].includes(r.method())) return route.continue();
    external.push({case:label,url,method:r.method()}); return route.abort('blockedbyclient');
  });
  await context.addInitScript(()=>{
    window.__downloadBlobs=[];
    const original=URL.createObjectURL;
    URL.createObjectURL=function(blob){
      const url=original.call(this,blob);
      if(blob instanceof Blob) window.__downloadBlobs.push({url,type:blob.type,size:blob.size});
      return url;
    };
  });
  const page=await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error') consoleErrors.push({case:label,error:message.text()});});
  context.on('requestfailed',request=>failedRequests.push({case:label,url:request.url(),error:request.failure()?.errorText}));
  context.on('response',response=>{if(response.status()>=400) badResponses.push({url:response.url(),status:response.status()});});
  try {
    await page.goto(`${base}/?lang=en`);
  await page.getByRole('dialog').getByRole('button', {name:/No usage counts|Ohne Nutzungszählung/}).click();
 await page.locator('#language').waitFor();
    await run(page,context);
    assert.deepEqual(errors,[],'uncaught browser errors');
    assert.deepEqual(external,[],'external or upload requests');
    assert.deepEqual(consoleErrors,[],'browser console/CSP errors');
    assert.deepEqual(failedRequests,[],'failed resource requests');
    assert.deepEqual(badResponses,[],'HTTP resource failures');
    report.passed.push(label); console.log(`PASS ${label}`);
  } catch(error) {
    report.failed.push({case:label,error:error.stack || String(error)});
    await page.screenshot({path:`${artifactDir}/failure-${report.failed.length}.png`,fullPage:true}).catch(()=>{});
    console.error(`FAIL ${label}: ${error.message}`);
  } finally {
    report.pageErrors.push(...errors.map(error=>({case:label,error})));
    report.consoleErrors.push(...consoleErrors);report.failedRequests.push(...failedRequests);
    report.externalRequests.push(...external); await context.close();
  }
}

try {
  // Same owned child-process lifecycle as ci/browser.mjs; never attach to an
  // unrelated server. A port collision or startup failure fails this command.
  server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  server.stderr.on('data',bytes=>report.serverErrors.push(bytes.toString()));
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server startup timed out')),10000);
    const finish=error=>{clearTimeout(timer); error?reject(error):resolve();};
    server.stdout.once('data',()=>finish()); server.once('error',finish);
    server.once('exit',code=>finish(new Error(`Server exited ${code}`)));
  });
  // Module MIME errors otherwise collapse into a generic PDF import failure.
  // Keep this a hosting assertion; do not rewrite application responses in tests.
  for(const path of ['vendor/pdfjs/build/pdf.mjs','vendor/pdfjs/build/pdf.worker.mjs']) {
    const response=await fetch(`${base}/${path}`,{method:'HEAD',signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200,`missing local module: ${path}`);
    assert.match(response.headers.get('content-type') || '',/^(text|application)\/javascript\b/i,
      `Local server must serve .mjs as JavaScript: ${path}`);
  }
  browser=await chromium.launch({headless:true}); report.browser=browser.version();

  await caseWithPage('mixed crop, rotation, userUnit, per-page masks and real private PDF download',async(page,context)=>{
    await upload(page); assert.equal(await page.locator('#export').isDisabled(),true);
    assert.equal(await page.locator('#previous-page').isDisabled(),true);
    await reviewAll(page,{masks:true});
    assert.equal(await page.locator('#next-page').isDisabled(),true);
    for(let n=4;n>=1;n--) {
      await pageNumber(page,n); assert.equal(await page.locator('.region').count(),1);
      const r=expectedPages[n-1].maskPixels;
      assert.match(await page.locator('.region small').innerText(),new RegExp(`X ${r.x}.*Y ${r.y}.*${r.width} × ${r.height}`));
      assert.equal(await page.locator('#review-page').isDisabled(),true);
      if(n>1) await keyboardClick(page,'previous-page');
    }
    const before=await page.locator('#canvas').evaluate(c=>c.toDataURL());
    await page.selectOption('#zoom','1.5');
    assert.equal(await page.locator('#canvas').evaluate(c=>c.toDataURL()),before);
    await page.selectOption('#zoom','0.5');
    // Pointer coordinates at 50% zoom must still be fixed 150 DPI page pixels.
    await page.locator('#canvas').scrollIntoViewIfNeeded();
    const bounds=await page.locator('#canvas').boundingBox(); assert.ok(bounds);
    await page.mouse.move(bounds.x+bounds.width*.45,bounds.y+bounds.height*.7);
    await page.mouse.down(); await page.mouse.move(bounds.x+bounds.width*.55,bounds.y+bounds.height*.75); await page.mouse.up();
    assert.equal(await page.locator('.region').count(),2);
    const added=(await page.locator('.region small').nth(1).innerText()).match(/X (\d+).*Y (\d+).*?(\d+) × (\d+)/);
    assert.ok(added);
    [270,280,60,20].forEach((value,i)=>assert.ok(Math.abs(Number(added[i+1])-value)<=2,'pointer mask must use page pixels'));
    assert.equal(await page.locator('#export').isDisabled(),true);
    await keyboardClick(page,'undo'); assert.equal(await page.locator('.region').count(),1);
    await page.selectOption('#zoom','fit');
    assert.equal(await page.locator('#review-page').isEnabled(),true);
    await keyboardClick(page,'review-page');
    await keyboardClick(page,'preview'); assert.equal(await page.locator('#add').isDisabled(),true);
    const online = await saveDownload(page,'masked-mixed-pages'); await inspect(online);
    await context.setOffline(true);
    const offline = await saveDownload(page,'masked-repeat'); await inspect(offline);
    assert.deepEqual(await pagePixelHashes(offline),await pagePixelHashes(online),
      'every RGB pixel, including text glyphs, must survive warmed offline re-export unchanged');
    await context.setOffline(false);
    await page.screenshot({path:`${artifactDir}/desktop-pdf.png`,fullPage:true});
  });

  await caseWithPage('missing required local font fails closed and a new selection can recover',async(page,context)=>{
    const pattern = '**/standard_fonts/*';
    // An empty successful response models a broken local asset without hiding
    // unexpected HTTP/CSP errors from the harness-wide assertions.
    await context.route(pattern,route=>route.fulfill({status:200,body:'',contentType:'application/octet-stream'}));
    await page.locator('#file').setInputFiles({name:'Synthetic report.pdf',mimeType:'application/pdf',buffer:source});
    await page.waitForFunction(()=>document.querySelector('#cancel').hidden);
    assert.match(await page.locator('#status').innerText(),/Required local PDF resources/);
    assert.equal(await page.locator('#export').isDisabled(),true);
    assert.equal(await page.locator('#loaded').isVisible(),false);
    await context.unroute(pattern);
    await upload(page);
  });

  await caseWithPage('every page rasterized including unmasked pages',async page=>{
    await upload(page,image,'Synthetic report.png','image/png');await add(page,{x:5,y:5,width:25,height:25});
    await upload(page);assert.equal(await page.locator('.region').count(),0);
    await add(page,expectedPages[0].maskPixels); await reviewAll(page);
    const expected=expectedPages.map((p,i)=>({...p,masks:i===0?p.masks:[]}));
    await inspect(await saveDownload(page,'unmasked-pages-still-raster'),expected);
  });

  await caseWithPage('delayed export locks edits, cancels, restores masks and permits a fresh export',async page=>{
    await upload(page); await reviewAll(page,{masks:true});
    let downloads=0; page.on('download',()=>downloads++);
    await delayEncoding(page);
    for(const id of ['add','undo','preview','previous-page','next-page','review-page','zoom']) {
      assert.equal(await page.locator(`#${id}`).isDisabled(),true,`${id} must lock during PDF export`);
    }
    assert.equal(await page.locator('.region button').isDisabled(),true);
    // Even a script-dispatched submit cannot mutate an in-flight snapshot.
    await page.locator('#region-form').evaluate(f=>f.requestSubmit());
    await keyboardClick(page,'cancel'); await releaseEncoding(page); await ready(page);
    assert.equal(downloads,0); assert.match(await page.locator('#status').innerText(),/cancelled/i);
    assert.equal(await page.locator('.region').count(),1);
    // Actual edit after cancellation invalidates the review; then restore it.
    await add(page,{x:1,y:1,width:10,height:10});
    assert.equal(await page.locator('#export').isDisabled(),true);
    await keyboardClick(page,'undo'); await keyboardClick(page,'review-page');
    await inspect(await saveDownload(page,'after-cancel'));
    assert.equal(downloads,1);
  });

  for(const fail of [false,true]) {
    await caseWithPage(`replacement suppresses delayed ${fail?'error':'success'} and retains image output`,async page=>{
      await upload(page); await reviewAll(page,{masks:true});
      let downloads=0; page.on('download',()=>downloads++);
      await delayEncoding(page);
      await upload(page,image,'Synthetic report.png','image/png');
      const status=await page.locator('#status').innerText();
      await releaseEncoding(page,fail); await ready(page);
      assert.equal(downloads,0); assert.equal(await page.locator('#status').innerText(),status);
      assert.equal(await page.locator('#pdf-controls').isVisible(),false);
      assert.equal(await page.locator('.region').count(),0);
      assert.deepEqual(await page.locator('#canvas').evaluate(c=>[c.width,c.height]),[160,120]);
      await add(page,{x:10,y:10,width:20,height:20});
      const png=await saveDownload(page,`image-after-stale-${fail?'error':'success'}`,'png');
      assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
      const pixels=await page.evaluate(async bytes=>{
        const bitmap=await createImageBitmap(new Blob([Uint8Array.from(bytes)],{type:'image/png'}));
        const c=document.createElement('canvas'); c.width=bitmap.width;c.height=bitmap.height;
        const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
        return {mask:[...ctx.getImageData(15,15,1,1).data],outside:[...ctx.getImageData(100,100,1,1).data]};
      },[...png]);
      assert.deepEqual(pixels,{mask:[0,0,0,255],outside:[224,224,224,255]});
    });
  }

  await caseWithPage('PDF replacement suppresses stale error and starts with fresh page review state',async page=>{
    await upload(page);await reviewAll(page,{masks:true});
    let downloads=0;page.on('download',()=>downloads++);await delayEncoding(page);
    await upload(page);const status=await page.locator('#status').innerText();
    await releaseEncoding(page,true);await ready(page);
    assert.equal(downloads,0);assert.equal(await page.locator('#status').innerText(),status);
    await pageNumber(page,1);assert.equal(await page.locator('.region').count(),0);
    assert.equal(await page.locator('#export').isDisabled(),true);
    assert.equal(await page.locator('#review-count').innerText(),'0 of 4 pages reviewed');
    await reviewAll(page,{masks:true});await inspect(await saveDownload(page,'after-pdf-replacement'));
  });

  await caseWithPage('current encoding error restores the page without download and can retry',async page=>{
    await upload(page); await reviewAll(page,{masks:true});
    let downloads=0;page.on('download',()=>downloads++);
    await delayEncoding(page); await releaseEncoding(page,true); await ready(page);
    assert.equal(downloads,0);assert.match(await page.locator('#status').innerText(),/could not encode/i);
    await inspect(await saveDownload(page,'after-current-error'));
  });

  await caseWithPage('cancel during a real page render leaves subsequent navigation usable',async(page,context)=>{
    await upload(page);
    // Page 2 uses a different standard font. Hold that real worker fetch while
    // its operator list is incomplete, rather than cancelling after rendering.
    let heldRoute,signalHeld;
    const held=new Promise(resolve=>{signalHeld=resolve;});
    const pattern='**/standard_fonts/**';
    let intercepted = false;
    await context.route(pattern,route=>{
      if (intercepted) return route.continue();
      intercepted = true; heldRoute=route;signalHeld();
    });
    let timer;
    try {
      await keyboardClick(page,'next-page');
      await Promise.race([held,new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Page 2 did not request its independent standard font')),20000);
      })]);
      clearTimeout(timer);
      await keyboardClick(page,'cancel');
      // Wait for the cancel handler before letting the pending font complete.
      await page.waitForFunction(()=>/Cancelling|cancelled|currently rendering/i.test(document.querySelector('#status').textContent));
      await heldRoute.continue();heldRoute=null;
      await page.waitForFunction(()=>document.querySelector('#cancel').hidden);
      assert.doesNotMatch(await page.locator('#status').innerText(),/startCleanup|currently rendering|unavailable/i);
      await keyboardClick(page,'previous-page');await pageNumber(page,1);
      await keyboardClick(page,'next-page');await pageNumber(page,2);
    } finally {
      clearTimeout(timer);if(heldRoute) await heldRoute.continue().catch(()=>{});
      await context.unroute(pattern);
    }
  });

  await caseWithPage('pagehide suppresses pending PDF export and clears the session',async page=>{
    await upload(page); await reviewAll(page,{masks:true});
    let downloads=0;page.on('download',()=>downloads++);await delayEncoding(page);
    await page.evaluate(()=>{dispatchEvent(new Event('pagehide'));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
    await releaseEncoding(page,true);
    assert.equal(downloads,0);assert.equal(await page.locator('#loaded').isVisible(),false);
    assert.match(await page.locator('#status').innerText(),/previous file was cleared/);
    await upload(page);assert.equal(await page.locator('.region').count(),0);
    assert.equal(await page.locator('#export').isDisabled(),true);
  });

  for(const [kind,message] of [['forms',/forms|signatures/i],['layers',/optional content/i],['pages',/1 to 30/i],
    ['encrypted-password',/Encrypted PDFs are not supported/],['encrypted-empty-password',/Encrypted PDFs are not supported/],
    ['broken',/damaged|supported/i]]) {
    await caseWithPage(`invalid ${kind} replacement clears old PDF and export`,async page=>{
      await upload(page);await reviewAll(page,{masks:true});
      const buffer=kind==='broken'?Buffer.from('%PDF-1.7\ninvalid'):await createRejectedBrowserFixture(kind);
      await page.locator('#file').setInputFiles({name:'Rejected.pdf',mimeType:'application/pdf',buffer});
      await page.waitForFunction(()=>document.querySelector('#cancel').hidden);
      assert.equal(await page.locator('#loaded').isVisible(),false);
      assert.equal(await page.locator('#export').isDisabled(),true);
      assert.match(await page.locator('#status').innerText(),message);
      await upload(page);assert.equal(await page.locator('.region').count(),0);
    });
  }

  await caseWithPage('keyboard and narrow viewport preserve PDF masks at both widths',async page=>{
    await page.setViewportSize({width:390,height:844});
    const chooser=page.waitForEvent('filechooser');await keyboardClick(page,'choose');
    await (await chooser).setFiles({name:'Synthetic report.pdf',mimeType:'application/pdf',buffer:source});await ready(page);
    await add(page,expectedPages[0].maskPixels);await keyboardClick(page,'review-page');
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await keyboardClick(page,'next-page');await pageNumber(page,2);
      assert.equal(await page.locator('.region').count(),0);
      await keyboardClick(page,'previous-page');await pageNumber(page,1);
      assert.equal(await page.locator('.region').count(),1);
      await page.screenshot({path:`${artifactDir}/keyboard-${width}.png`,fullPage:true});
    }
  });

  await caseWithPage('EN DE switching retains PDF preview, masks, page and review state',async page=>{
    await upload(page);await reviewAll(page,{masks:true});await keyboardClick(page,'preview');
    const before=await page.locator('#canvas').evaluate(c=>c.toDataURL());
    const regions=await page.locator('.region small').allTextContents();
    await page.selectOption('#language','de');
    await page.waitForFunction(()=>document.documentElement.lang==='de');
    assert.equal(await page.locator('#canvas').evaluate(c=>c.toDataURL()),before);
    assert.deepEqual(await page.locator('.region small').allTextContents(),regions);
    assert.equal(await page.locator('#export').isEnabled(),true);
    // These assertions intentionally expose missing PDF translations; no skip.
    assert.match(await page.locator('#export').innerText(),/PDF.*herunterladen/i);
    assert.match(await page.locator('#page-number').innerText(),/Seite.*4.*4/i);
    assert.match(await page.locator('#review-page').innerText(),/geprüft|überprüft|kontrolliert/i);
    await inspect(await saveDownload(page,'german-pdf'));
    await page.selectOption('#language','en');
    assert.equal(await page.locator('#canvas').evaluate(c=>c.toDataURL()),before);
    assert.match(await page.locator('#export').innerText(),/Download PDF/);
  });

  await caseWithPage('PDF keyboard navigation and review preserve focus in English and German',async page=>{
    for(const language of ['en','de']) {
      await upload(page);await page.selectOption('#language',language);
      for(let n=1;n<expectedPages.length;n++) {
        await keyboardClick(page,'review-page');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'next-page');
        await page.keyboard.press('Enter');await ready(page);
        assert.equal(await page.evaluate(()=>document.activeElement.id),n===expectedPages.length-1?'page-number':'next-page');
      }
      await keyboardClick(page,'review-page');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'export');
    }
  });
} catch(error) {
  report.failed.push({case:'harness',error:error.stack || String(error)});
} finally {
  await browser?.close();
  if(server && server.exitCode===null) {
    const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();
    await Promise.race([exited,new Promise(resolve=>{const timer=setTimeout(resolve,3000);timer.unref();})]);
  }
  await writeFile(`${artifactDir}/report.json`,JSON.stringify(report,null,2)+'\n');
}
console.log(`${report.passed.length} PDF browser cases passed; ${report.failed.length} failed. Report: ${artifactDir}/report.json`);
if(report.failed.length) process.exitCode=1;
