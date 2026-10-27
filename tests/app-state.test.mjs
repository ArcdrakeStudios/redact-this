import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {outputName} from '../dist/pdf-geometry.js';
import {mountImageSave} from '../dist/image-save.js';

// Event-level state checks with fake file/renderer/encoder boundaries. These do
// not emulate layout, real canvas compositing, PDF.js rendering or downloads.
async function harness(run) {
  const previous={document:globalThis.document,window:globalThis.window};
  const elements=new Map(),downloads=[],events=[];
  const element=(id='')=>({id,style:{},value:id==='zoom'?'fit':'0',children:[],
    textContent:'',disabled:false,hidden:false,width:1,height:1,
    focus(){globalThis.document.activeElement=this;},
    addEventListener(){},setAttribute(){},removeAttribute(key){delete this[key];},append(...nodes){this.children.push(...nodes);},
    replaceChildren(){this.children=[];},click(){if(id==='a')downloads.push(this.download);},
  });
  const $=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  const pixels=()=>({width:150,height:150,close(){this.closed=true;}});
  const boundary={outputName,measurement:{track:async event=>{events.push(event);}},drawSample:canvas=>canvas,loadImage:async()=>pixels(),loadPdf:async()=>{throw Error('synthetic invalid PDF');},
    paint:(canvas,image)=>{canvas.width=image.width;canvas.height=image.height;},
    encode:async()=>new Blob(['synthetic']),region:(x,y,right,bottom)=>({x,y,width:right-x,height:bottom-y})};
  boundary.mountImageSave=mountImageSave;
  globalThis.document={documentElement:{lang:'en'},getElementById:$,createElement:element};
  globalThis.window={addEventListener(){}};
  globalThis.__redactStateTest=boundary;
  const source=(await readFile('dist/app.js','utf8')).replace(/^import .*;\r?\n/gm,'');
  try {
    await import('data:text/javascript;base64,'+Buffer.from(
      'const b=globalThis.__redactStateTest; const {region,paint,outputName,measurement,drawSample,mountImageSave}=b;\n'
      +'const setTimeout=(...args)=>globalThis.setTimeout(...args).unref();\n'
      +'const loadImage=(...a)=>b.loadImage(...a),loadPdf=(...a)=>b.loadPdf(...a),encode=(...a)=>b.encode(...a);\n'+source
      +`\n// ${Math.random()}`).toString('base64'));
    const choose=(name,type='image/png')=>$('file').onchange({target:{files:[{name,type}],value:''}});
    const add=()=>{for(const [id,value] of Object.entries({x:10,y:10,width:20,height:20}))$(id).value=String(value);
      $('region-form').onsubmit({preventDefault(){}});};
    await run({$,choose,add,boundary,pixels,downloads,events});
  } finally {
    globalThis.document=previous.document;globalThis.window=previous.window;delete globalThis.__redactStateTest;
  }
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('actual file and sample handlers count starts, and only current successful downloads count completion',async()=>harness(async({$,choose,add,boundary,events,downloads})=>{
  // A cancelled file chooser is not a task start.
  await $('file').onchange({target:{files:[],value:''}});
  assert.deepEqual(events,[]);
  await choose('private-name.png');
  assert.deepEqual(events,['tool_start']);
  await $('export').onclick();
  assert.deepEqual(events,['tool_start','tool_complete']);
  const encoding=Promise.withResolvers();boundary.encode=()=>encoding.promise;
  const obsolete=$('export').onclick();add();encoding.resolve(new Blob(['synthetic']));await obsolete;
  assert.equal(events.filter(e=>e==='tool_complete').length,1);
  boundary.encode=async()=>{throw Error('synthetic export failure');};
  await $('export').onclick();
  assert.equal(events.filter(e=>e==='tool_complete').length,1);
  boundary.loadImage=async()=>{throw Error('synthetic load failure');};
  await choose('bad.png');
  assert.deepEqual(events,['tool_start','tool_complete','tool_start']);
  boundary.encode=async()=>new Blob(['synthetic']);boundary.loadImage=async()=>({width:960,height:600});
  await $('sample').onclick();
  assert.equal($('filename').textContent,'synthetic-sample.png');
  assert.equal($('sample').disabled,false);
  await $('export').onclick();
  assert.deepEqual(events,['tool_start','tool_complete','tool_start','tool_start','tool_complete']);
  assert.deepEqual(downloads,['private-name-redacted.png','synthetic-sample-redacted.png']);
}));

test('successful PDF export counts completion; failed and cancelled PDF exports do not',async()=>harness(async({$,choose,boundary,pixels,events})=>{
  const doc={pages:[{pixelWidth:150,pixelHeight:150}],render:async()=>pixels(),dispose:async()=>{},export:async()=>new Blob(['synthetic'])};
  boundary.loadPdf=async()=>doc;
  await choose('example.pdf','application/pdf');
  await $('export').onclick();
  assert.deepEqual(events,['tool_start']); // review gate
  $('review-page').onclick();await $('export').onclick();
  assert.deepEqual(events,['tool_start','tool_complete']);
  for(const error of [Error('failed'),new DOMException('cancelled','AbortError')]) {
    doc.export=async()=>{throw error;};await $('export').onclick();
  }
  assert.deepEqual(events,['tool_start','tool_complete']);
}));

test('late synthetic sample encoding cannot replace a newly selected file',async()=>harness(async({$,choose,boundary,events})=>{
  const encoding=Promise.withResolvers();boundary.encode=()=>encoding.promise;
  const pending=$('sample').onclick();
  await choose('new-selection.png');
  encoding.resolve(new Blob(['synthetic']));await pending;
  assert.equal($('filename').textContent,'new-selection.png');
  assert.deepEqual(events,['tool_start']);
  assert.equal($('sample').disabled,false);
}));

test('rejected replacement clears the prior raster and disables export and coordinate entry',async()=>harness(async({$,choose,boundary})=>{
  await choose('first.png');assert.equal($('export').disabled,false);
  boundary.loadImage=async()=>{throw Error('synthetic invalid replacement');};
  await choose('invalid.png');
  assert.equal($('loaded').hidden,true);assert.equal($('export').disabled,true);
  assert.equal($('x').disabled,true);assert.equal($('canvas').width,1);
  assert.match($('status').textContent,/invalid replacement/);
}));

test('a delayed failed PDF disposal cannot overwrite a newer image status',async()=>harness(async({$,choose,boundary})=>{
  const disposal=Promise.withResolvers();
  boundary.loadPdf=async()=>({pages:[{pixelWidth:150,pixelHeight:150}],
    render:async()=>{throw Error('synthetic page failure');},dispose:()=>disposal.promise});
  const old=choose('broken.pdf','application/pdf');await tick();
  await choose('new.png');disposal.resolve();await old;
  assert.match($('status').textContent,/Image ready/);
  assert.equal($('filename').textContent,'new.png');assert.equal($('export').disabled,false);
}));

test('image edits during encoding and stale encoding rejection cannot produce an obsolete download or status',async()=>harness(async({$,choose,add,boundary,downloads})=>{
  await choose('first.png');
  const encoding=Promise.withResolvers();boundary.encode=()=>encoding.promise;
  const first=$('export').onclick();add();encoding.resolve(new Blob(['synthetic']));await first;
  assert.equal(downloads.length,0);assert.match($('status').textContent,/Masks changed/);
  const failure=Promise.withResolvers();boundary.encode=()=>failure.promise;
  const second=$('export').onclick();await choose('second.png');failure.reject(Error('stale encoding failure'));await second;
  assert.match($('status').textContent,/Image ready/);assert.equal(downloads.length,0);
  assert.equal($('export').disabled,false);
}));

test('PDF review gating is per page and mask edits clear review; replacement cancels pending export',async()=>harness(async({$,choose,add,boundary,pixels,downloads})=>{
  const encoding=Promise.withResolvers();let exportSignal;
  boundary.loadPdf=async()=>({pages:Array.from({length:2},()=>({pixelWidth:150,pixelHeight:150})),
    render:async()=>pixels(),dispose:async()=>{},export:async(_masks,{signal})=>{exportSignal=signal;return encoding.promise;}});
  await choose('first.pdf','application/pdf');assert.equal($('export').disabled,true);
  $('review-page').onclick();await $('next-page').onclick();$('review-page').onclick();
  assert.equal($('export').disabled,false);add();assert.equal($('export').disabled,true);
  $('review-page').onclick();
  const pending=$('export').onclick();await tick();
  await choose('second.png');assert.equal(exportSignal.aborted,true);
  encoding.resolve(new Blob(['synthetic'],{type:'application/pdf'}));await pending;
  assert.equal(downloads.length,0);assert.match($('status').textContent,/Image ready/);
  assert.equal($('pdf-controls').hidden,true);assert.equal($('export').textContent,'Download PNG ↗');
}));

test('post-export restore cannot be cancelled through the hidden cancel control and retains masks',async()=>harness(async({$,choose,add,boundary,pixels})=>{
  const restore=Promise.withResolvers();let renders=0,restoreSignal;
  boundary.loadPdf=async()=>({pages:[{pixelWidth:150,pixelHeight:150}],dispose:async()=>{},
    render:async(_index,{signal})=>{if(++renders===1)return pixels();restoreSignal=signal;return restore.promise;},
    export:async()=>{throw new DOMException('Operation cancelled.','AbortError');}});
  await choose('one.pdf','application/pdf');add();$('review-page').onclick();
  const pending=$('export').onclick();await tick();
  assert.equal($('cancel').hidden,true);$('cancel').onclick();
  assert.equal(restoreSignal.aborted,false);assert.match($('status').textContent,/cancelled/);
  restore.resolve(pixels());await pending;
  assert.equal($('export').disabled,false);assert.equal($('regions').children.length,1);
}));

test('a failed single-page restore can retry the current page without losing masks or review',async()=>harness(async({$,choose,add,boundary,pixels})=>{
  let renders=0;
  boundary.loadPdf=async()=>({pages:[{pixelWidth:150,pixelHeight:150}],dispose:async()=>{},
    render:async()=>{if(++renders===2)throw Error('synthetic restore failure');return pixels();},
    export:async()=>{throw Error('synthetic export failure');}});
  await choose('one.pdf','application/pdf');add();$('review-page').onclick();await $('export').onclick();
  assert.equal($('review-page').textContent,'Show page');assert.equal($('review-page').disabled,false);
  await $('review-page').onclick();
  assert.equal($('regions').children.length,1);assert.equal($('export').disabled,false);
  assert.equal($('review-page').textContent,'Page reviewed');
}));

test('replacement during page restoration discards late pixels and preserves the replacement status',async()=>harness(async({$,choose,boundary,pixels})=>{
  const restore=Promise.withResolvers();let renders=0,restoreSignal;
  boundary.loadPdf=async()=>({pages:[{pixelWidth:150,pixelHeight:150}],dispose:async()=>{},
    render:async(_index,{signal})=>{if(++renders===1)return pixels();restoreSignal=signal;return restore.promise;},
    export:async()=>{throw Error('synthetic export failure');}});
  await choose('one.pdf','application/pdf');$('review-page').onclick();
  const pending=$('export').onclick();await tick();await choose('replacement.png');
  assert.equal(restoreSignal.aborted,true);const late=pixels();restore.resolve(late);await pending;
  assert.equal(late.width,1);assert.equal(late.height,1);
  assert.match($('status').textContent,/Image ready/);assert.equal($('pdf-controls').hidden,true);
}));

test('page navigation restores keyboard focus when its control reaches the final page',async()=>harness(async({$,choose,boundary,pixels})=>{
  boundary.loadPdf=async()=>({pages:Array.from({length:2},()=>({pixelWidth:150,pixelHeight:150})),
    render:async()=>pixels(),dispose:async()=>{}});
  await choose('two.pdf','application/pdf');$('next-page').focus();await $('next-page').onclick();
  assert.equal(document.activeElement,$('page-number'));
  $('review-page').focus();$('review-page').onclick();
  assert.equal(document.activeElement,$('page-number'));
}));
