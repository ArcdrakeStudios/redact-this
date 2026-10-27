// Assemble only reviewed static assets and notices; no network or deployment.
import {readFile, writeFile, mkdir, readdir, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const appFiles = ['index.html', 'style.css', 'app.js', 'i18n.js', 'i18n-messages.js',
  'image.js', 'image-save.js', 'regions.js', 'pdf.js', 'pdf-geometry.js', 'pdf-resources.js',
  'sample.js', 'product-feedback.js', 'shared/measurement-feedback-client.mjs', 'shared/measurement-contract.mjs'];
const vendorFiles = ['vendor/pdf-lib/pdf-lib.esm.min.js', 'vendor/pdf-lib/LICENSE.md',
  'vendor/pdf-lib/DEPENDENCY_LICENSES.txt',
  'vendor/pdfjs/LICENSE', 'vendor/pdfjs/build/pdf.mjs', 'vendor/pdfjs/build/pdf.worker.mjs'];
// Recursively include rendering resources and upstream notices. No viewer,
// sandbox, source maps, test assets or QuickJS scripting runtime are shipped.
const vendorTrees = ['vendor/pdfjs/cmaps', 'vendor/pdfjs/standard_fonts',
  'vendor/pdfjs/iccs', 'vendor/pdfjs/wasm'];
const excluded = new Set(['vendor/pdfjs/wasm/quickjs-eval.js', 'vendor/pdfjs/wasm/quickjs-eval.wasm']);

async function tree(root, relative = '', includeDirectories = false) {
  const files = [];
  for (const entry of await readdir(resolve(root, relative), {withFileTypes:true})) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw Error(`Symbolic links are not release assets: ${file}`);
    if (entry.isDirectory()) {
      if (includeDirectories) files.push(`${file}/`);
      files.push(...await tree(root, file, includeDirectories));
    }
    else if (entry.isFile()) files.push(file);
    else throw Error(`Unsupported release asset: ${file}`);
  }
  return files.sort();
}

export async function packageRelease(output = resolve('artifacts/release')) {
  output = resolve(output);
  const assets = [...appFiles, ...vendorFiles];
  for (const root of vendorTrees) assets.push(...(await tree('dist', root)).filter(file => !excluded.has(file)));
  const files = [...assets, 'LICENSE', 'THIRD_PARTY_NOTICES.md'].sort();
  // Read all inputs before altering a package. Missing dependencies fail closed.
  const inputs = await Promise.all(files.map(async file => {
    const source = assets.includes(file) ? `dist/${file}` : file;
    if (!(await lstat(source)).isFile()) throw Error(`Expected a regular release file: ${file}`);
    return [file, await readFile(source)];
  }));
  await mkdir(output, {recursive:true});
  if ((await lstat(output)).isSymbolicLink()) throw Error('Release output must not be a symbolic link.');
  const allowed = new Set([...files, 'manifest.json']);
  for (const file of files) {
    const parts=file.split('/');
    for(let i=1;i<parts.length;i++) allowed.add(parts.slice(0,i).join('/')+'/');
  }
  for (const file of await tree(output,'',true)) {
    if (!allowed.has(file)) throw Error(`Unexpected release file: ${file}; inspect the output before packaging.`);
  }
  const hashes = {};
  for (const [file, bytes] of inputs) {
    await mkdir(dirname(resolve(output, file)), {recursive:true});
    await writeFile(resolve(output, file), bytes);
    hashes[file] = createHash('sha256').update(bytes).digest('hex');
  }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({algorithm:'sha256', files:hashes}, null, 2)+'\n');
  return files.length + 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const count = await packageRelease();
  console.log(`Prepared ${count} files in artifacts/release; no deployment performed.`);
}
