import test from 'node:test';
import assert from 'node:assert/strict';
import {drawSample} from '../dist/sample.js';
import {paint, encode, region} from '../dist/regions.js';
import {inspectImage} from '../dist/image.js';
import {encodeRgbPng} from './pdf-fixtures.mjs';

// Software rectangle raster/PNG encoder boundary, not browser canvas or font QA.
function raster() {
  const canvas={width:0,height:0,text:[]};let pixels;
  const ensure=()=>{if(pixels?.length!==canvas.width*canvas.height*3)pixels=Buffer.alloc(canvas.width*canvas.height*3);return pixels;};
  const context={fillStyle:'#000000',
    fillRect(x,y,w,h) {
      const color=this.fillStyle.slice(1).match(/../g).map(hex=>parseInt(hex,16)),data=ensure();
      for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)data.set(color,(yy*canvas.width+xx)*3);
    },
    fillText(text,x,y) {canvas.text.push({text,x,y});},
    drawImage(source) {ensure().set(source.pixels());},
  };
  canvas.getContext=()=>context;canvas.pixels=()=>ensure();
  canvas.toBlob=(callback,type)=>callback(new Blob([encodeRgbPng(canvas.width,canvas.height,ensure())],{type}));
  return canvas;
}

test('built-in synthetic card reaches PNG export with source dimensions and only selected pixels changed',async()=>{
  const sample=drawSample(raster());
  assert.equal(sample.width,960);assert.equal(sample.height,600);
  assert(sample.text.some(({text})=>text.includes('SYNTHETIC SAMPLE')));
  assert(sample.text.some(({text})=>text.includes('Keine echten persönlichen Daten')));
  const mask=region(40,130,900,250,sample.width,sample.height),output=raster();
  paint(output,sample,[mask]);
  for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++) {
    const offset=(y*sample.width+x)*3,covered=x>=mask.x && x<mask.x+mask.width && y>=mask.y && y<mask.y+mask.height;
    for(let c=0;c<3;c++)assert.equal(output.pixels()[offset+c],covered?0:sample.pixels()[offset+c]);
  }
  const blob=await encode(output);
  const header=inspectImage(await blob.arrayBuffer());
  assert.deepEqual(header,{width:960,height:600,type:'image/png'});
});
