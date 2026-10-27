import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NOTICES} from '../dist/shared/measurement-feedback-client.mjs';
import {validatePayload, EVENTS, CATEGORIES} from '../dist/shared/measurement-contract.mjs';
import {translateText} from '../dist/i18n-messages.js';

class Element {
  constructor(tag, doc) { this.tag=tag;this.ownerDocument=doc;this.children=[];this.listeners={};this.attributes={};this.value=''; }
  append(child) {this.children.push(child);}
  setAttribute(key,value) {this.attributes[key]=value;}
  addEventListener(key,fn) {this.listeners[key]=fn;}
  querySelectorAll(tag) {return all(this).filter(el=>el.tag===tag);}
  focus() {}
  reset() {for(const el of all(this)) el.value='';}
  set innerHTML(_) {assert.fail('HTML interpretation is forbidden');}
}
const all=root=>[root,...root.children.flatMap(all)];

test('actual product adapter mounts without submission; language preserves a failed draft, localized links and privacy choices',async()=>{
  const names=['document','window','location','localStorage','fetch'];
  const prior=Object.fromEntries(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const nodes=new Map(),listeners={},calls=[],data=new Map();
  const doc={documentElement:{lang:'de'},createElement:tag=>new Element(tag,doc)};
  doc.getElementById=id=>{if(!nodes.has(id))nodes.set(id,new Element('div',doc));return nodes.get(id);};
  try {
    Object.assign(globalThis,{document:doc,window:{addEventListener:(key,fn)=>listeners[key]=fn},location:{hostname:'127.0.0.1'},
      localStorage:{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)},
      fetch:async(path,options)=>{calls.push({path,options});return new Response('Static host has no API',{status:404});}});
    const {measurement}=await import(`../dist/product-feedback.js?test=${Date.now()}`);
    const container=nodes.get('measurement-feedback'), children=all(container);
    assert.equal(calls.length,0);
    assert.equal(nodes.get('feedback-local').hidden,false);
    assert.deepEqual(container.querySelectorAll('a').map(a=>a.href),['https://tools.arcdrake.com/de/privacy/','https://arcdrake.com/de/contact/']);
    children.find(el=>el.textContent===NOTICES.en.open).listeners.click();
    assert.equal(calls.length,0);
    const message=children.find(el=>el.tag==='textarea'),category=children.find(el=>el.tag==='select');
    message.value='Synthetic draft';category.value='usability';
    listeners['arcdrake-language-change']({detail:{language:'en'}});
    assert.equal(message.value,'Synthetic draft');
    const form=children.find(el=>el.tag==='form');
    await form.listeners.submit({preventDefault(){}});
    assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/feedback');
    assert.deepEqual(JSON.parse(calls[0].options.body),{product:'redact',category:'usability',message:'Synthetic draft'});
    assert.equal(message.value,'Synthetic draft');
    assert(children.some(el=>el.textContent===NOTICES.en.unavailable));
    assert.equal(data.size,0,'feedback is never stored in localStorage');
    measurement.setChoice('yes');
    assert.equal(calls.length,1,'opting in never resends earlier actions');
    await measurement.track('tool_start');
    assert.deepEqual(JSON.parse(calls[1].options.body),{product:'redact',event:'tool_start'});
    measurement.setChoice('no');listeners.storage();
    await measurement.track('tool_complete');assert.equal(calls.length,2);
  } finally {
    for(const key of names) {if(prior[key])Object.defineProperty(globalThis,key,prior[key]);else delete globalThis[key];}
  }
});

test('shared notices, statuses and receipt are translated without modifying the receipt',()=>{
  for(const key of Object.keys(NOTICES.en)) assert.equal(translateText(NOTICES.en[key],'de').trim(),NOTICES.de[key].trim(),key);
  assert.equal(translateText(NOTICES.en.sent+'synthetic-receipt','de'),NOTICES.de.sent+'synthetic-receipt');
  for(const key of ['on','off','blocked']) {
    const combined = `${NOTICES.en[key]} ${NOTICES.en.pageOnly}`;
    assert.equal(translateText(combined,'de'),`${NOTICES.de[key]} ${NOTICES.de.pageOnly}`);
    assert.equal(translateText(combined,'en'),combined);
  }
});

test('exact contract rejects event metadata, unknown events and invalid feedback while preserving trimmed fields',()=>{
  assert.deepEqual(EVENTS,['page_view','play_start','play_complete','feedback_open','tool_start','tool_complete']);
  assert.deepEqual(CATEGORIES,['bug','idea','usability','other']);
  for(const extra of [{userId:'x'},{url:'https://example.test/?private=x'},{contents:'private'}])
    assert.throws(()=>validatePayload('events',{product:'redact',event:'tool_start',...extra}));
  assert.throws(()=>validatePayload('events',{product:'redact',event:'download_file'}));
  const valid={product:'redact',category:'bug',message:'  Synthetic\nreport\t  ',replyTo:'  test@example.test  '};
  assert.deepEqual(validatePayload('feedback',valid),{product:'redact',category:'bug',message:'Synthetic\nreport',replyTo:'test@example.test'});
  for(const invalid of [{category:'support'},{message:''},{message:'x'.repeat(2001)},{message:'x\u0000'},{replyTo:'a\nb@example.test'},{replyTo:''},{save:'private'}])
    assert.throws(()=>validatePayload('feedback',{...valid,...invalid}));
  assert.equal(validatePayload('feedback',{...valid,message:'x'.repeat(2000)}).message.length,2000);
});

test('chooser precedes disclosure; sample and feedback are packaged local assets with same-origin CSP',async()=>{
  const html=await readFile('dist/index.html','utf8');
  assert(html.indexOf('id="choose"')<html.indexOf('class="notice"'));
  assert.match(html,/id="sample"/);assert.match(html,/id="measurement-feedback"/);
  assert.match(html,/connect-src 'self'/);
  assert.doesNotMatch(html,/No upload, account, or server/);
});
