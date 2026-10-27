import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {translateText} from '../dist/i18n-messages.js';

test('language controller reuses one selector and wrapper events/storage preserve drafts and editing fields',async()=>{
  for(const existing of [false,true]) {
    const keys=['document','window','localStorage','location','navigator','history','NodeFilter','MutationObserver','__languageTest'];
    const prior=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    class El {
      constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.value='';}
      append(child){this.children.push(child);}
      get options(){return this.children;}
      querySelector(){return this.children.find(el=>el.id==='language');}
      setAttribute(name,value){this.attributes[name]=value;}
      addEventListener(name,fn){this[name]=fn;}
    }
    const header=new El('header'),data=new Map(),events=[],listeners={};
    const draft={value:'Synthetic unchanged draft',validity:{customError:false}},coordinate={value:'42',validity:{customError:false}};
    if(existing){const label=new El('label');label.id='language-control';const select=new El('select');select.id='language';label.append(select);header.append(label);}
    const doc={documentElement:{lang:'en'},createElement:tag=>new El(tag),
      getElementById:id=>[...header.children,...header.children.flatMap(el=>el.children)].find(el=>el.id===id),
      createTreeWalker:()=>({nextNode:()=>false}),querySelector:()=>header,
      querySelectorAll:selector=>selector==='input'?[draft,coordinate]:[],addEventListener(){}};
    try {
      const globals={document:doc,window:{addEventListener:(type,fn)=>listeners[type]=fn,
        dispatchEvent:event=>{events.push(event);listeners[event.type]?.(event);}},
        location:{search:'?lang=en',href:'https://tools.arcdrake.com/redact/?lang=en'},
        navigator:{language:'en'},localStorage:{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)},
        history:{state:{synthetic:true},replaceState(state,_title,url){assert.deepEqual(state,{synthetic:true});globals.location.href=String(url);}},
        NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){}},__languageTest:translateText};
      for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
      const source=(await readFile('dist/i18n.js','utf8')).replace(/^import .*;\r?\n/gm,'');
      await import('data:text/javascript;base64,'+Buffer.from('const translateText=globalThis.__languageTest;\n'+source+`\n// ${existing}`).toString('base64'));
      assert.equal(header.children.length,1);
      const select=doc.getElementById('language');
      assert.deepEqual(select.options.map(option=>option.value),['de','en']);
      select.value='de';select.change();
      assert.equal(doc.documentElement.lang,'de');assert.equal(data.get('arcdrake-tools-language'),'de');
      listeners['arcdrake-language-change']({detail:{language:'en'}});
      assert.equal(doc.documentElement.lang,'en');
      listeners.storage({key:'arcdrake-tools-language',newValue:'de'});
      assert.equal(doc.documentElement.lang,'de');assert.equal(events.at(-1).detail.language,'de');
      assert.equal(draft.value,'Synthetic unchanged draft');assert.equal(coordinate.value,'42');
      assert.equal(header.children.length,1);
    } finally {
      for(const key of keys){if(prior[key])Object.defineProperty(globalThis,key,prior[key]);else delete globalThis[key];}
    }
  }
});
