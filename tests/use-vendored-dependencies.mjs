// Run unit checks against the PDF writer actually shipped in dist, without an
// installed npm tree. This does not replace the installed-dependency parity check.
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier === 'pdf-lib') return {url:new URL('../dist/vendor/pdf-lib/pdf-lib.esm.min.js', import.meta.url).href, shortCircuit:true};
  return nextResolve(specifier, context);
}});
