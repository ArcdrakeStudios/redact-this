import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {translateText} from '../dist/i18n-messages.js';

test('all image and PDF validation errors have German translations', async () => {
  for (const name of ['image','regions','pdf','pdf-geometry','pdf-resources','app']) {
    const source=await readFile(`dist/${name}.js`,'utf8');
    for(const [,message] of source.matchAll(/(?:new Error|throw Error)\('([^']+)'\)/g)) {
      assert.notEqual(translateText(message,'de'),message,`${name}: ${message}`);
      assert.equal(translateText(message,'en'),message);
    }
  }
});

test('static file/PDF UI and dynamic progress/review controls translate without changing source text', async () => {
  const html=await readFile('dist/index.html','utf8');
  const allowed=new Set(['▰','Redact This','▧','Redact This / Arcdrake']);
  for(const [,part] of html.matchAll(/>([^<>]+)</g)) {
    const text=part.trim();
    if(!text || allowed.has(text)) continue;
    assert.notEqual(translateText(text,'de'),text,text);
  }
  for(const message of ['Show page','Page 2 of 30','0 of 30 pages reviewed','Checking PDF page 2 of 30…',
    'Rendering PDF page 2…','Flattening PDF page 2 of 30…','300 × 400 px · 150 DPI',
    'PDF ready. Mask and mark every page reviewed before downloading.',
    'Reading your file locally…','Operation cancelled. No file was exported.',
    'The editing page could not be restored. Choose the file again.']) {
    assert.notEqual(translateText(message,'de'),message,message);
    assert.equal(translateText(message,'en'),message);
  }
});
