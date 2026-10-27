import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { mountMeasurementFeedback, NOTICES } from '../dist/shared/measurement-feedback-client.mjs';

class Element {
  constructor(tag, doc) { Object.assign(this, { tag, ownerDocument: doc, children: [], listeners: {}, attributes: {}, value: '' }); }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.listeners[key] = callback; }
  querySelectorAll(tag) { return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => tag === '*' || child.tag === tag); }
  focus() {}
}
const source = await readFile(new URL('../dist/product-feedback.js', import.meta.url), 'utf8');

test('native privacy choices follows initial EN/DE and later switches without resetting draft or permission', () => {
  for (const initial of ['de', 'en']) {
    let language = initial; const listeners = {}, saved = new Map(), nodes = new Map(); let sends = 0;
    const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
    const view = { addEventListener(name, fn) { (listeners[name] ??= []).push(fn); },
      dispatchEvent(event) { for (const fn of listeners[event.type] ?? []) fn(event); } };
    const doc = { defaultView: view, documentElement: { lang: initial },
      getElementById: id => nodes.get(id), createElement(tag) {
        const node = new Element(tag, doc);
        if (tag === 'dialog') { node.showModal = () => { node.open = true; }; node.close = () => { node.open = false; }; }
        return node;
      } };
    doc.body = new Element('body', doc); doc.head = new Element('head', doc);
    for (const id of ['measurement-feedback', 'feedback-local']) nodes.set(id, new Element('div', doc));
    class LocalEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    const context = { document: doc, window: view, CustomEvent: LocalEvent, getLanguage: () => language,
      mountMeasurementFeedback: (container, options) => mountMeasurementFeedback(container, { ...options, storage, privacy: {}, fetchImpl: async () => { sends++; return Response.json({ ok: true }, { status: 202 }); } }) };
    runInNewContext(source.replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nglobalThis.ui = ui;', context);
    const container = nodes.get('measurement-feedback'), dialog = doc.body.children.find(node => node.tag === 'dialog');
    const form = container.querySelectorAll('form')[0], message = container.querySelectorAll('textarea')[0], email = container.querySelectorAll('input')[0];
    message.value = 'Unsaved report'; email.value = 'optional@example.test';
    const check = locale => {
      const all = dialog.querySelectorAll('*');
      assert.equal(dialog.lang, locale);
      assert.equal(all.find(node => node.tag === 'h2').textContent, locale === 'de' ? 'Datenschutzeinstellungen' : 'Privacy choices');
      assert.match(all.find(node => node.tag === 'p').textContent, locale === 'de' ? /möchte mit deiner Einwilligung/ : /would like your consent/);
      assert.equal(all.find(node => node.tag === 'summary').textContent, locale === 'de' ? 'Was wird verarbeitet und gespeichert?' : 'What is processed and stored?');
      assert.equal(all.filter(node => node.tag === 'p')[1].textContent, NOTICES[locale].analytics);
      assert.equal(all.find(node => node.tag === 'button').textContent, locale === 'de' ? 'Ohne Nutzungszählung' : 'No usage counts');
      assert.equal(all.find(node => node.tag === 'a').href, `https://tools.arcdrake.com/${locale === 'de' ? 'de/' : ''}privacy/`);
      assert.ok(container.querySelectorAll('button').some(node => node.textContent === (locale === 'de' ? 'Datenschutzeinstellungen' : 'Privacy choices')));
      assert.equal(container.querySelectorAll('form')[0], form);
      assert.equal(message.value, 'Unsaved report'); assert.equal(email.value, 'optional@example.test');
    };
    const change = next => { language = next; doc.documentElement.lang = next; view.dispatchEvent(new LocalEvent('arcdrake-language-change', { detail: { language: next } })); };
    check(initial); assert.equal(dialog.open, true);
    dialog.querySelectorAll('button')[0].listeners.click(); assert.equal(context.ui.client.choice(), 'no');
    change(initial === 'de' ? 'en' : 'de'); check(language); assert.equal(context.ui.client.choice(), 'no');
    const reopen = () => container.querySelectorAll('button').find(node => node.textContent === (language === 'de' ? 'Datenschutzeinstellungen' : 'Privacy choices')).listeners.click();
    reopen(); assert.equal(dialog.open, true);
    dialog.querySelectorAll('button')[1].listeners.click(); assert.equal(context.ui.client.choice(), 'yes');
    change(initial); check(initial); assert.equal(context.ui.client.choice(), 'yes');
    reopen(); assert.equal(dialog.open, true); assert.equal(sends, 0);
  }
});
