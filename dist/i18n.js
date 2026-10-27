import {translateText} from './i18n-messages.js';
const key = 'arcdrake-tools-language';
let preference;
try { preference = localStorage.getItem(key); } catch {}
const query = new URLSearchParams(location.search).get('lang');
let language = ['de','en'].includes(query) ? query : ['de','en'].includes(preference) ? preference : navigator.language?.startsWith('de') ? 'de' : 'en';
const records = new WeakMap();
const attributeRecords = new WeakMap();
export function translate(source) { return translateText(source, language); }
function localizeText(node) {
  const current = node.data;
  const saved = records.get(node);
  const source = saved && saved.output === current ? saved.source : current;
  const output = translate(source);
  records.set(node, {source, output});
  if (current !== output) node.data = output;
}
function localize() {
  document.documentElement.lang = language;
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement.closest('script,style,noscript,#language-control,#filename,textarea')) localizeText(node);
  }
  for (const element of document.querySelectorAll('[aria-label],[alt],meta[name="description"]')) {
    const saved = attributeRecords.get(element) || {};
    for (const name of ['aria-label','alt','content']) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name), prior = saved[name];
      const source = prior && prior.output === current ? prior.source : current;
      const output = translate(source);
      saved[name] = {source, output};
      if (current !== output) element.setAttribute(name, output);
    }
    attributeRecords.set(element, saved);
  }
  document.getElementById('language').value = language;
}
export function setLanguage(next, notify = true) {
  if (!['de','en'].includes(next)) return;
  language = next;
  try { localStorage.setItem(key, language); } catch {}
  const url = new URL(location.href); url.searchParams.set('lang', language);
  try { history.replaceState(history.state, '', url); } catch {}
  localize();
  for (const input of document.querySelectorAll('input')) if (input.validity.customError) input.setCustomValidity(language === 'de' ? 'Bitte gib einen gültigen Wert innerhalb der angegebenen Grenzen ein.' : 'Enter a valid value within the indicated limits.');
  if (notify) window.dispatchEvent(new CustomEvent('arcdrake-language-change', {detail:{language}}));
}
// Reuse an existing selector when embedded in a host. The shared wrapper
// recognizes this ID and hides its fallback language links once this is usable.
let control = document.getElementById('language-control');
let select = control?.querySelector('select#language');
if (!select) {
  control ??= document.createElement('label');
  control.id = 'language-control';
  control.textContent = 'Sprache / Language ';
  select = document.createElement('select'); select.id = 'language';
  select.setAttribute('aria-label', 'Sprache / Language');
  control.append(select); document.querySelector('header').append(control);
}
for (const [value, name] of [['de','Deutsch'],['en','English']]) {
  let option = Array.from(select.options).find(option => option.value === value);
  if (!option) { option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option); }
  option.disabled = false;
}
control.title = 'Die Sprachwahl wird lokal gespeichert. / Your language choice is saved locally.';
select.addEventListener('change', () => setLanguage(select.value));
window.addEventListener('arcdrake-language-change', event => { if (event.detail?.language !== language) setLanguage(event.detail?.language, false); });
window.addEventListener('storage', event => { if (event.key === key) setLanguage(event.newValue); });
// Native validation UI follows browser language; provide localized field errors instead.
document.addEventListener('invalid', event => { event.target.setCustomValidity(language === 'de' ? 'Bitte gib einen gültigen Wert innerhalb der angegebenen Grenzen ein.' : 'Enter a valid value within the indicated limits.'); }, true);
document.addEventListener('input', event => event.target.setCustomValidity?.(''));
localize();
if (['de','en'].includes(query)) { try { localStorage.setItem(key, language); } catch {} }
new MutationObserver(localize).observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['aria-label','alt','content']});
