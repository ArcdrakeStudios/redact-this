// Assemble only reviewed static assets and notices; no network or deployment.
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const files = ["index.html", "style.css", "app.js", "i18n.js", "image.js", "regions.js"];
const output = resolve('artifacts/release');
await mkdir(output, {recursive:true});
const allowed = [...files, 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'manifest.json'];
const existing = await readdir(output);
if (existing.some(name => !allowed.includes(name))) throw Error('Unexpected release file; inspect artifacts/release before packaging.');
const hashes = {};
for (const file of [...files, 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  const bytes = await readFile(files.includes(file) ? `dist/${file}` : file);
  await writeFile(resolve(output, file), bytes);
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({algorithm:'sha256', files:hashes}, null, 2)+'\n');
console.log(`Prepared ${allowed.length} files in artifacts/release; no deployment performed.`);
