export function contentType(extension) {
  return ({'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
    '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm',
    '.ttf':'font/ttf', '.otf':'font/otf', '.woff':'font/woff', '.woff2':'font/woff2',
    '.pfb':'application/x-font-type1', '.bcmap':'application/octet-stream',
    '.icc':'application/vnd.iccprofile'}[extension] || 'application/octet-stream');
}
