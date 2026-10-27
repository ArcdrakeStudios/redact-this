import test from 'node:test';
import assert from 'node:assert/strict';
import { CHOICE_KEY, createMeasurementClient, mountMeasurementFeedback, NOTICES, FEEDBACK_PRIVACY, runMeasuredAction } from '../dist/shared/measurement-feedback-client.mjs';
const receipt = '12345678-1234-4567-89ab-123456789abc';

function setup(overrides = {}) {
  const data = new Map(), calls = [];
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const client = createMeasurementClient({ product: 'company', storage, privacy: {},
    fetchImpl: async (path, options) => { calls.push({ path, options }); return Response.json(path === '/api/events' ? { ok: true } : { ok: true, id: receipt }, { status: 202 }); },
    ...overrides });
  return { client, calls, storage };
}

test('no automatic traffic, explicit opt-in, narrow payload, no credentials/referrer, and immediate opt-out', async () => {
  const { client, calls } = setup();
  assert.equal(client.choice(), 'unset');
  await client.track('page_view');
  assert.equal(calls.length, 0);
  client.setChoice('yes');
  await client.track('play_start');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/events');
  assert.deepEqual(JSON.parse(calls[0].options.body), { product: 'company', event: 'play_start' });
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  client.setChoice('no');
  await client.track('page_view');
  assert.equal(calls.length, 1);
  await assert.rejects(client.track('unknown'), /Unknown event/);
});

test('browser GPC/DNT override opt-in, storage failures use session-only choice, cross-instance opt-out respected', async () => {
  for (const privacy of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
    const { client, calls } = setup({ privacy });
    assert.equal(client.setChoice('yes'), 'blocked');
    await client.track('page_view');
    assert.equal(calls.length, 0);
  }
  const broken = setup({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  broken.client.setChoice('yes');
  await broken.client.track('page_view');
  assert.equal(broken.calls.length, 1);
  const f = setup();
  f.client.setChoice('yes');
  const second = createMeasurementClient({ product: 'studios', storage: f.storage, privacy: {} });
  second.setChoice('no');
  await f.client.track('page_view');
  assert.equal(f.calls.length, 0);
  f.client.setChoice('yes');
  f.storage.removeItem(CHOICE_KEY);
  await f.client.track('page_view');
  assert.equal(f.calls.length, 0);
});

test('feedback needs explicit send, works with analytics off, validates and never retries on failure', async () => {
  const { client, calls } = setup();
  assert.equal(calls.length, 0);
  const valid = { category: 'idea', message: 'A thought' };
  assert.equal((await client.sendFeedback(valid)).ok, true);
  assert.equal(calls[0].path, '/api/feedback');
  assert.deepEqual(JSON.parse(calls[0].options.body), { product: 'company', ...valid, noticeVersion: '2026-10-27-mail-v1' });
  assert.equal((await client.sendFeedback({ ...valid, metadata: 'extra' })).ok, false);
  assert.equal(calls.length, 1);
  let attempts = 0;
  const failed = setup({ fetchImpl: async () => { attempts++; throw Error('offline'); } });
  assert.deepEqual(await failed.client.sendFeedback(valid), { ok: false, error: 'unavailable' });
  assert.equal(attempts, 1);
});

// Minimal DOM harness checks control flow and safe text assignment; not browser QA.
class Element {
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; }
  append(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  focus() {}
  reset() {}
  remove() {}
  set innerHTML(_value) { assert.fail('Unsafe HTML rendering'); }
}
function all(root) { return [root, ...root.children.flatMap(all)]; }

test('EN/DE widget sends only on submit and rejects an untrusted malformed receipt', async () => {
  for (const language of ['en', 'de']) {
    const doc = { createElement: tag => new Element(tag, doc) };
    const container = new Element('div', doc);
    let sends = 0;
    mountMeasurementFeedback(container, { product: 'tools', language, storage: null, privacy: {},
      fetchImpl: async () => { sends++; return Response.json({ ok: true, id: '<script>unsafe</script>' }, { status: 202 }); } });
    const nodes = all(container), copy = NOTICES[language];
    assert.ok(nodes.some(node => node.textContent === copy.analytics));
    assert.ok(nodes.some(node => node.textContent === copy.feedback));
    await nodes.find(node => node.textContent === copy.open).listeners.click();
    assert.equal(sends, 0);
    const form = nodes.find(node => node.tag === 'form');
    nodes.find(node => node.tag === 'textarea').value = 'A report';
    nodes.find(node => node.tag === 'select').value = 'bug';
    await form.listeners.submit({ preventDefault() {} });
    assert.equal(sends, 1);
    assert.ok(nodes.some(node => node.textContent === copy.unavailable));
    assert.equal(nodes.find(node => node.tag === 'textarea').value, 'A report');
  }
});

test('client preserves bounded API errors, rejects malformed receipts, never follows redirects or retries', async () => {
  for (const [status, body, error] of [[400, { ok: false, error: 'invalid' }, 'invalid'],
    [429, { ok: false, error: 'rate' }, 'rate'], [503, { ok: false, error: 'capacity' }, 'capacity'],
    [503, { error: '<secret provider exception>' }, 'unavailable'], [202, null, 'unavailable'],
    [200, { ok: true }, 'unavailable'], [202, { ok: 'yes' }, 'unavailable'],
    [202, { ok: true, id: 'not-a-uuid' }, 'unavailable'],
    [202, { ok: true, id: receipt, extra: 'unexpected' }, 'unavailable'],
    [400, { ok: false, error: 'rate' }, 'unavailable'],
    [503, { ok: false, error: 'unavailable', detail: 'private' }, 'unavailable']]) {
    let attempts = 0;
    const { client } = setup({ fetchImpl: async (_path, options) => {
      attempts++;
      assert.equal(options.redirect, 'error');
      return Response.json(body, { status });
    } });
    assert.deepEqual(await client.sendFeedback({ category: 'other', message: 'Synthetic' }), { ok: false, error });
    assert.equal(attempts, 1);
  }
});

test('EN/DE confirmed receipt resets the form, while rate and capacity errors preserve its draft', async () => {
  for (const language of ['en', 'de']) {
    const doc = { createElement: tag => new Element(tag, doc) };
    const container = new Element('div', doc);
    let reply, resets = 0;
    mountMeasurementFeedback(container, { product: 'redact', language, storage: null, privacy: {},
      fetchImpl: async () => reply });
    const nodes = all(container), form = nodes.find(node => node.tag === 'form');
    const message = nodes.find(node => node.tag === 'textarea');
    const submit = nodes.find(node => node.textContent === NOTICES[language].send);
    const status = form.children.at(-1);
    form.reset = () => { resets++; message.value = ''; };
    nodes.find(node => node.tag === 'select').value = 'idea';
    for (const [code, http] of [['rate', 429], ['capacity', 503]]) {
      message.value = 'Synthetic draft';
      reply = Response.json({ ok: false, error: code }, { status: http });
      await form.listeners.submit({ preventDefault() {} });
      assert.equal(message.value, 'Synthetic draft');
      assert.equal(status.textContent, NOTICES[language][code]);
      assert.equal(submit.disabled, false);
      assert.equal(resets, 0);
    }
    reply = Response.json({ ok: true, id: receipt }, { status: 202 });
    await form.listeners.submit({ preventDefault() {} });
    assert.equal(status.textContent, NOTICES[language].sent + receipt);
    assert.equal(message.value, '');
    assert.equal(resets, 1);
    assert.equal(submit.disabled, false);
  }
});

test('one bounded deadline covers stalled fetch or response JSON with no retry', async () => {
  for (const stallJson of [false, true]) {
    let calls = 0, signal;
    const { client } = setup({ timeoutMs: 15, fetchImpl: async (_path, options) => {
      calls++; signal = options.signal;
      if (stallJson) return { status: 202, json: () => new Promise(() => {}) };
      return new Promise(() => {});
    } });
    assert.deepEqual(await client.sendFeedback({ category: 'other', message: 'Synthetic timeout' }),
      { ok: false, error: 'unavailable' });
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
  }
});

test('real action wrapper emits start and successful completion only, with consent and privacy gates', async () => {
  for (const kind of ['play', 'tool']) {
    const f = setup();
    let actions = 0;
    const action = async () => { actions++; return 'task result'; };
    assert.equal(await runMeasuredAction(f.client, kind, action), 'task result');
    assert.equal(actions, 1);
    assert.equal(f.calls.length, 0);
    f.client.setChoice('yes');
    assert.equal(await runMeasuredAction(f.client, kind, action), 'task result');
    assert.deepEqual(f.calls.map(call => JSON.parse(call.options.body).event), [`${kind}_start`, `${kind}_complete`]);
    await assert.rejects(runMeasuredAction(f.client, kind, async () => { throw Error('task failed'); }), /task failed/);
    assert.deepEqual(f.calls.map(call => JSON.parse(call.options.body).event), [`${kind}_start`, `${kind}_complete`, `${kind}_start`]);
    f.client.setChoice('no');
    await runMeasuredAction(f.client, kind, action);
    assert.equal(f.calls.length, 3);
    for (const privacy of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
      const blocked = setup({ privacy });
      blocked.client.setChoice('yes');
      await runMeasuredAction(blocked.client, kind, action);
      assert.equal(blocked.calls.length, 0);
    }
    const offline = setup({ fetchImpl: async () => { throw Error('offline'); } });
    offline.client.setChoice('yes');
    assert.equal(await runMeasuredAction(offline.client, kind, action), 'task result');
  }
});

test('localized widget links existing host privacy/contact routes and preserves text on unconfirmed sends', async () => {
  for (const language of ['en', 'de']) for (const product of ['company', 'studios', 'tools']) {
    const doc = { createElement: tag => new Element(tag, doc) };
    const container = new Element('div', doc);
    mountMeasurementFeedback(container, { product, language, storage: null, privacy: {},
      fetchImpl: async () => { throw Error('offline'); } });
    const nodes = all(container), prefix = language === 'de' ? '/de' : '';
    const host = product === 'company' ? 'arcdrake.com' : product === 'tools' ? 'tools.arcdrake.com' : 'arcdrakestudios.com';
    assert.ok(nodes.some(node => node.href === `https://${host}${prefix}/privacy/`));
    assert.ok(nodes.some(node => node.href === `https://${product === 'tools' ? 'arcdrake.com' : host}${prefix}/contact/`));
    const message = nodes.find(node => node.tag === 'textarea');
    message.value = '<script>untrusted text</script>';
    nodes.find(node => node.tag === 'select').value = 'other';
    await nodes.find(node => node.tag === 'form').listeners.submit({ preventDefault() {} });
    assert.equal(message.value, '<script>untrusted text</script>');
    assert.ok(nodes.some(node => node.textContent === NOTICES[language].unavailable));
    assert.match(NOTICES[language].feedback, /Arcdrake/);
    assert.ok(NOTICES[language].feedback.length < 240);
    assert.match(FEEDBACK_PRIVACY[language], /platform failures|Plattformfehler/);
    assert.match(FEEDBACK_PRIVACY[language], /Microsoft 365/);
  }
});
