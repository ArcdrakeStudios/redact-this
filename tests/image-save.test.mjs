import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageFile, mountImageSave} from '../dist/image-save.js';

test('native image saving requires supported files; PDFs and unsupported browsers fall back', () => {
  const png = new Blob(['pixels'], {type:'image/png'});
  assert.equal(imageFile(png, 'x.png', {}), null);
  assert.equal(imageFile(png, 'x.png', {share(){},canShare(){throw Error('unsupported');}}), null);
  assert.equal(imageFile(new Blob(['pdf'],{type:'application/pdf'}),'x.pdf',{share(){},canShare(){return true;}}), null);
  const file=imageFile(png,'safe.png',{share(){},canShare({files}){return files[0].type==='image/png';}});
  assert.equal(file.name,'safe.png');
});

test('sharing waits for a click, handles cancellation, and clears stale output and completion', async () => {
  const previous=globalThis.document;
  const element=()=>({children:[],append(...items){this.children.push(...items);}});
  globalThis.document={documentElement:{lang:'en'},createElement:element};
  try {
    const parent=element(),messages=[],calls=[]; let pending=Promise.withResolvers();
    const save=mountImageSave(parent,message=>messages.push(message),{canShare:()=>true,share:data=>{calls.push(data);return pending.promise;}});
    const [box]=parent.children, [button]=box.children;
    save.set(new Blob(['flattened'],{type:'image/png'}),'redacted.png');
    assert.equal(calls.length,0);
    const first=button.onclick(); assert.equal(calls.length,1); assert.equal(button.disabled,true);
    await button.onclick(); assert.equal(calls.length,1);
    save.clear(); pending.resolve(); await first;
    assert.equal(messages.length,0); assert.equal(box.hidden,true);
    await button.onclick(); assert.equal(calls.length,1);
    pending=Promise.withResolvers();save.set(new Blob(['new'],{type:'image/png'}),'new.png');
    const cancelled=button.onclick();pending.reject(new DOMException('cancel','AbortError'));await cancelled;
    assert.match(messages.at(-1),/cancelled/);assert.equal(button.disabled,false);
    globalThis.document.documentElement.lang='de';
    save.set(new Blob(['new'],{type:'image/png'}),'neu.png');assert.equal(button.textContent,'Bild speichern oder teilen');
  } finally {globalThis.document=previous;}
});
