import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, posix} from 'node:path';
import {createHash} from 'node:crypto';
import {packageRelease} from '../scripts/package.mjs';
import {contentType} from '../scripts/mime.mjs';
import {securityHeaders} from '../scripts/security.mjs';

test('clean and repeat packages contain the complete local PDF module graph, resources, notices and valid hashes', async () => {
  const output=await mkdtemp(join(tmpdir(),'redact-package-'));
  const count=await packageRelease(output);
  const first=await readFile(join(output,'manifest.json'),'utf8');
  assert.equal(await packageRelease(output),count);
  assert.equal(await readFile(join(output,'manifest.json'),'utf8'),first);
  const manifest=JSON.parse(first);
  for(const required of ['pdf.js','pdf-geometry.js','pdf-resources.js','i18n-messages.js',
    'sample.js','product-feedback.js','shared/measurement-feedback-client.mjs','shared/measurement-contract.mjs',
    'vendor/pdfjs/build/pdf.mjs','vendor/pdfjs/build/pdf.worker.mjs',
    'vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js','vendor/pdfjs/wasm/jbig2_nowasm_fallback.js',
    'vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf','vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap',
    'vendor/pdf-lib/pdf-lib.esm.min.js','vendor/pdf-lib/LICENSE.md',
    'vendor/pdf-lib/DEPENDENCY_LICENSES.txt','vendor/pdfjs/LICENSE']) {
    assert(required in manifest.files,required);
  }
  assert(!('vendor/pdfjs/wasm/quickjs-eval.js' in manifest.files));
  for(const [file,hash] of Object.entries(manifest.files)) {
    const bytes=await readFile(join(output,file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,file);
    if(/\.m?js$/.test(file) && !file.startsWith('vendor/')) {
      for(const [,imported] of bytes.toString().matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        assert(posix.join(posix.dirname(file),imported) in manifest.files,`${file} imports missing ${imported}`);
      }
    }
  }
  await writeFile(join(output,'unexpected.txt'),'synthetic stale file');
  await assert.rejects(packageRelease(output),/Unexpected release file/);
  assert.equal(await readFile(join(output,'manifest.json'),'utf8'),first,'refusal preserves prior package');
});

test('vendored production builds match the pinned installed dependencies',async()=>{
  for(const [vendored,installed] of [
    ['dist/vendor/pdf-lib/pdf-lib.esm.min.js','node_modules/pdf-lib/dist/pdf-lib.esm.min.js'],
    ['dist/vendor/pdfjs/build/pdf.mjs','node_modules/pdfjs-dist/build/pdf.mjs'],
    ['dist/vendor/pdfjs/build/pdf.worker.mjs','node_modules/pdfjs-dist/build/pdf.worker.mjs']
  ]) assert.deepEqual(await readFile(vendored),await readFile(installed),vendored);
});

test('worker modules, wasm, CMaps and fonts receive strict usable MIME types',()=>{
  assert.equal(contentType('.mjs'),'text/javascript');
  assert.equal(contentType('.wasm'),'application/wasm');
  assert.equal(contentType('.ttf'),'font/ttf');
  assert.equal(contentType('.pfb'),'application/x-font-type1');
  assert.equal(contentType('.bcmap'),'application/octet-stream');
});

test('document and worker response policy includes the document restrictions and framing protection',async()=>{
  const html=await readFile('dist/index.html','utf8');
  const meta=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(securityHeaders['Content-Security-Policy'],meta+"; frame-ancestors 'none'");
  assert.equal(securityHeaders['Referrer-Policy'],'no-referrer');
  const server=await readFile('scripts/serve.mjs','utf8');
  assert.match(server,/res\.writeHead\(200,[\s\S]*?\.\.\.securityHeaders/);
});
