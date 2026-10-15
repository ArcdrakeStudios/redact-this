import {test} from 'node:test';
import assert from 'node:assert/strict';
import {region} from '../dist/regions.js';
import {inspectImage, validateDimensions} from '../dist/image.js';

test('drag direction does not change region and rounds outward', () => {
  assert.deepEqual(region(20.2, 30.8, 10.5, 5.4, 100, 100), {x:10, y:5, width:11, height:26});
});
test('coordinates are clipped to pixels, invalid rectangles rejected', () => {
  assert.deepEqual(region(-10, -10, 30, 50, 20, 20), {x:0, y:0, width:20, height:20});
  for (const args of [[10,10,10,10,20,20], [NaN,0,1,1,20,20], [30,30,50,50,20,20]]) assert.throws(() => region(...args));
});
test('dimension limits and unsupported headers rejected', () => {
  assert.throws(() => validateDimensions(10000,10000), /too large/);
  assert.throws(() => validateDimensions(0,10), /invalid/);
  assert.throws(() => inspectImage(new TextEncoder().encode('<svg/>').buffer), /supported/);
});
