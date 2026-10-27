// Foreground, in-process checks of the shipped assets; no server or browser.
import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=(await readdir('tests')).filter(file=>file.endsWith('.test.mjs') && file!=='pdf-robustness.test.mjs').sort();
console.log('Local suite uses the shipped PDF writer. Excluded: installed-dependency parity test and pdf-robustness.test.mjs (requires installed legacy PDF.js).');
const result=spawnSync(process.execPath,['--import','./tests/use-vendored-dependencies.mjs','--test',
  '--test-skip-pattern','vendored production builds match',...files.map(file=>`tests/${file}`)],{stdio:'inherit'});
if(result.error) throw result.error;
process.exitCode=result.status ?? 1;
