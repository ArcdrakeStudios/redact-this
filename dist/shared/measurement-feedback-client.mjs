import { PRODUCTS, EVENTS, CATEGORIES, WRITE_ERRORS, RECEIPT_UUID, validatePayload } from './measurement-contract.mjs';

export const CHOICE_KEY = 'arcdrake.analytics.v1';
// Share a failed opt-out across clients in this page using the same storage.
// This cannot override a stale permission in a different page if both browser
// storage writes and removal fail; the visible page-only notice discloses that.
const pageDeniedStorage = new WeakSet();
export const NOTICES = Object.freeze({
  en: {
    analytics: 'Optional usage counts are off until you allow them. With your permission we send only a product code and action type, stored as daily totals for the current UTC day and 89 previous days. These are action counts, not unique visitors. No visitor ID, visited URL, file content or IP address is saved in these totals. We try to save your choice in this browser on this site; a page-only choice is shown if browser storage is unavailable. You can turn counts off at any time; earlier totals cannot be linked to you or removed individually. Browser privacy signals are respected. Our hosting and abuse-protection provider still receives connection data, including your IP address, separately.',
    feedback: 'Feedback is voluntary and sent to Arcdrake only when you press Send feedback. The product, category, message and optional reply email are accessible to authorized triage operators and agents until 30 days after sending. Expired feedback is hidden immediately; hourly cleanup deletes it from active storage, subject to platform failures. Do not include passwords, sensitive information, files or URLs containing private data. A reply is not guaranteed. Keep your receipt ID to request deletion through the contact link. Hosting and abuse protection process connection data separately; we do not store your IP with feedback. Provider recovery backups have separate retention. Authorized exports must be deleted by the feedback expiry time or earlier, including on a deletion request.',
    allow: 'Allow usage counts', deny: 'Turn usage counts off', open: 'Give feedback',
    send: 'Send feedback', message: 'Message (1–2000 characters)', email: 'Reply email (optional)',
    category: 'Category', bug: 'Problem', idea: 'Idea', usability: 'Ease of use', other: 'Other',
    on: 'Usage counts are on.', off: 'Usage counts are off.', blocked: 'Usage counts are off because of your browser privacy signal.',
    pageOnly: 'This choice applies only on this page because browser storage is unavailable. If an earlier permission could not be cleared, it may still apply after reload or in another tab. Check the choice there too.',
    privacy: 'Privacy', contact: 'Contact Arcdrake',
    sending: 'Sending…', sent: 'Feedback saved. Receipt ID: ', error: 'We could not confirm that feedback was saved. Check the fields; do not send repeatedly.',
    unavailable: 'Feedback service is unavailable or receipt could not be confirmed. Your text stays in this form. Do not resend automatically; contact Arcdrake if needed.',
    rate: 'Too many requests. Your text stays in this form. Please wait before sending again.',
    capacity: 'Feedback storage is currently full. Your text stays in this form. Contact Arcdrake if needed.',
  },
  de: {
    analytics: 'Optionale Nutzungszählungen sind aus, bis du sie erlaubst. Mit deiner Zustimmung senden wir nur Produktcode und Aktionsart; gespeichert werden Tagessummen für den aktuellen UTC-Tag und 89 vorherige Tage. Das sind Aktionszahlen, keine Anzahl einzelner Besucher. Keine Besucherkennung, besuchte URL, Dateiinhalte oder IP-Adresse wird in diesen Summen gespeichert. Wir versuchen, deine Auswahl in diesem Browser auf dieser Website zu speichern; bei nicht verfügbarem Browserspeicher wird die nur für diese Seite geltende Auswahl angezeigt. Du kannst die Zählung jederzeit ausschalten; frühere Summen lassen sich dir nicht zuordnen oder einzeln löschen. Datenschutzsignale des Browsers werden beachtet. Unser Anbieter für Hosting und Missbrauchsschutz erhält weiterhin gesondert Verbindungsdaten einschließlich deiner IP-Adresse.',
    feedback: 'Feedback ist freiwillig und wird erst mit „Feedback senden“ an Arcdrake übertragen. Produkt, Kategorie, Nachricht und optionale Antwortadresse sind für berechtigte Bearbeitende und Agenten bis 30 Tage nach dem Senden zugänglich. Abgelaufenes Feedback ist sofort unsichtbar; eine stündliche Bereinigung löscht es aus dem aktiven Speicher, vorbehaltlich Plattformfehlern. Bitte keine Passwörter, sensiblen Angaben, Dateien oder URLs mit privaten Daten senden. Eine Antwort ist nicht garantiert. Bewahre die Beleg-ID für eine Löschanfrage über den Kontaktlink auf. Hosting und Missbrauchsschutz verarbeiten Verbindungsdaten gesondert; wir speichern deine IP nicht mit dem Feedback. Wiederherstellungskopien des Anbieters haben gesonderte Aufbewahrungsfristen. Berechtigte Exporte müssen spätestens zum Ablauf des Feedbacks oder früher gelöscht werden, auch auf Löschanfrage.',
    allow: 'Nutzungszählung erlauben', deny: 'Nutzungszählung ausschalten', open: 'Feedback geben',
    send: 'Feedback senden', message: 'Nachricht (1–2000 Zeichen)', email: 'Antwortadresse (optional)',
    category: 'Kategorie', bug: 'Problem', idea: 'Idee', usability: 'Bedienbarkeit', other: 'Sonstiges',
    on: 'Nutzungszählung ist an.', off: 'Nutzungszählung ist aus.', blocked: 'Nutzungszählung ist wegen des Datenschutzsignals deines Browsers aus.',
    pageOnly: 'Diese Auswahl gilt nur auf dieser Seite, weil der Browserspeicher nicht verfügbar ist. Falls eine frühere Erlaubnis nicht gelöscht werden konnte, kann sie nach dem Neuladen oder in einem anderen Tab weiter gelten. Prüfe die Auswahl auch dort.',
    privacy: 'Datenschutz', contact: 'Arcdrake kontaktieren',
    sending: 'Wird gesendet…', sent: 'Feedback gespeichert. Beleg-ID: ', error: 'Die Speicherung konnte nicht bestätigt werden. Prüfe die Felder; bitte nicht wiederholt senden.',
    unavailable: 'Der Feedbackdienst ist nicht verfügbar oder der Empfang konnte nicht bestätigt werden. Dein Text bleibt im Formular. Bitte nicht automatisch erneut senden; kontaktiere bei Bedarf Arcdrake.',
    rate: 'Zu viele Anfragen. Dein Text bleibt im Formular. Bitte warte vor dem nächsten Sendeversuch.',
    capacity: 'Der Feedbackspeicher ist derzeit voll. Dein Text bleibt im Formular. Kontaktiere bei Bedarf Arcdrake.',
  },
});

export function createMeasurementClient({ product, fetchImpl = globalThis.fetch,
  storage, privacy = globalThis.navigator, timeoutMs = 10000 } = {}) {
  if (!PRODUCTS.includes(product)) throw new TypeError('Unknown product');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new TypeError('Deadline must be 1–10000 ms');
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  let sessionChoice = 'unset';
  let sessionOnly = !storage;
  const privacyBlocked = () => privacy?.globalPrivacyControl === true || privacy?.doNotTrack === '1';
  const choice = () => {
    if (privacyBlocked()) return 'blocked';
    if (storage && pageDeniedStorage.has(storage)) return 'no';
    if (sessionOnly) {
      // A page-only opt-in must still honor a later opt-out from another tab.
      try { if (storage?.getItem(CHOICE_KEY) === 'no') return 'no'; } catch { /* Page fallback. */ }
      return sessionChoice;
    }
    try {
      const stored = storage?.getItem(CHOICE_KEY);
      return ['yes', 'no'].includes(stored) ? stored : 'unset';
    } catch { sessionOnly = true; }
    return sessionChoice;
  };
  const send = async (kind, data) => {
    const controller = new AbortController();
    let timer;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, timeoutMs);
      });
      const operation = async () => {
        const response = await fetchImpl(`/api/${kind}`, {
        method: 'POST', mode: 'same-origin', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
        });
        const result = await response.json();
        if (!result || typeof result !== 'object' || Array.isArray(result)) return { ok: false, error: 'unavailable' };
        const keys = Object.keys(result);
        if (response.status === 202 && result.ok === true &&
          (kind === 'events' ? keys.length === 1 : keys.length === 2 &&
            typeof result.id === 'string' && RECEIPT_UUID.test(result.id))) return result;
        return result.ok === false && keys.length === 2 && typeof result.error === 'string' &&
          Object.hasOwn(WRITE_ERRORS, result.error) && WRITE_ERRORS[result.error] === response.status ? result :
          { ok: false, error: 'unavailable' };
      };
      // One deadline covers fetch AND reading/parsing JSON, even for a stalled
      // adapter that ignores AbortSignal. Never retry an unconfirmed write.
      return await Promise.race([operation(), deadline]);
    } catch { return { ok: false, error: 'unavailable' }; }
    finally { clearTimeout(timer); }
  };
  return {
    choice,
    choicePersistence: () => sessionOnly || (storage && pageDeniedStorage.has(storage)) ? 'page' : 'browser',
    setChoice(value) {
      if (!['yes', 'no'].includes(value)) throw new TypeError('Choice must be yes or no');
      sessionChoice = value;
      try {
        storage?.setItem(CHOICE_KEY, value);
        if (storage) { sessionOnly = false; pageDeniedStorage.delete(storage); }
      } catch {
        sessionOnly = true;
        if (value === 'no' && storage) {
          pageDeniedStorage.add(storage);
          try { storage.removeItem(CHOICE_KEY); } catch { /* Still deny on this page. */ }
        }
      }
      return choice();
    },
    async track(event) {
      if (!EVENTS.includes(event)) throw new TypeError('Unknown event');
      if (choice() !== 'yes') return { ok: true, skipped: true };
      return send('events', { product, event });
    },
    async sendFeedback(fields) {
      let data;
      try { data = validatePayload('feedback', { ...fields, product }); }
      catch { return { ok: false, error: 'invalid' }; }
      return send('feedback', data);
    },
  };
}

// Optional framework-free UI. All content, including server results, uses textContent.
// The host supplies a visible container and can style it through its own stylesheet.
export function mountMeasurementFeedback(container, { product, language = 'en', links, consentWindow = true, ...options } = {}) {
  const client = createMeasurementClient({ product, ...options });
  const copy = NOTICES[language] ?? NOTICES.en;
  const doc = container.ownerDocument;
  const root = doc.createElement('section');
  const add = (parent, tag, text) => {
    const el = doc.createElement(tag);
    if (text !== undefined) el.textContent = text;
    parent.append(el);
    return el;
  };
  add(root, 'p', copy.analytics);
  const toolProducts = ['tools', 'rehearsal', 'redact', 'shrink', 'unpack', 'maildns', 'sitecheck'];
  const host = product === 'company' ? 'https://arcdrake.com' : toolProducts.includes(product) ?
    'https://tools.arcdrake.com' : 'https://arcdrakestudios.com';
  const prefix = language === 'de' ? '/de' : '';
  const defaults = { privacy: `${host}${prefix}/privacy/`, contact:
    `${toolProducts.includes(product) ? 'https://arcdrake.com' : host}${prefix}/contact/` };
  const navigation = add(root, 'p');
  for (const name of ['privacy', 'contact']) {
    const href = links?.[name] ?? defaults[name];
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError('HTTPS notice/contact link required');
    add(navigation, 'a', copy[name]).href = url.href;
    add(navigation, 'span', ' ');
  }
  const allow = add(root, 'button', copy.allow), deny = add(root, 'button', copy.deny);
  allow.type = deny.type = 'button';
  const choiceStatus = add(root, 'p');
  choiceStatus.setAttribute('role', 'status');
  let consent;
  const update = () => {
    const current = client.choice();
    choiceStatus.textContent = (current === 'blocked' ? copy.blocked : current === 'yes' ? copy.on : copy.off) +
      (client.choicePersistence() === 'page' ? ` ${copy.pageOnly}` : '');
    consent?.refresh();
  };
  const view = doc.defaultView;
  const storageChanged = event => { if (event.key === CHOICE_KEY || event.key === null) update(); };
  view?.addEventListener('storage', storageChanged);
  allow.addEventListener('click', () => { client.setChoice('yes'); update(); });
  deny.addEventListener('click', () => { client.setChoice('no'); update(); });
  const open = add(root, 'button', copy.open);
  open.type = 'button';
  open.setAttribute('aria-expanded', 'false');
  const form = add(root, 'form');
  form.hidden = true;
  add(form, 'p', copy.feedback);
  const category = add(add(form, 'label', copy.category), 'select');
  category.name = 'category';
  for (const value of CATEGORIES) add(category, 'option', copy[value]).value = value;
  const message = add(add(form, 'label', copy.message), 'textarea');
  message.name = 'message'; message.required = true; message.maxLength = 2000;
  const email = add(add(form, 'label', copy.email), 'input');
  email.name = 'replyTo'; email.type = 'email'; email.maxLength = 254;
  const submit = add(form, 'button', copy.send);
  submit.type = 'submit';
  const status = add(form, 'p');
  status.setAttribute('role', 'status');
  open.addEventListener('click', () => {
    form.hidden = !form.hidden;
    open.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) { void client.track('feedback_open'); message.focus(); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true; status.textContent = copy.sending;
    try {
      const result = await client.sendFeedback({ category: category.value, message: message.value,
      ...(email.value.trim() ? { replyTo: email.value } : {}) });
      status.textContent = result.ok ? copy.sent + result.id : ['rate', 'capacity'].includes(result.error) ?
        copy[result.error] : ['invalid', 'size'].includes(result.error) ? copy.error : copy.unavailable;
      if (result.ok) form.reset();
    } finally { submit.disabled = false; }
  });
  container.append(root);
  if (consentWindow) consent = mountConsentWindow(root, client, {
    language, privacyURL: links?.privacy ?? defaults.privacy, onChange: update,
  });
  update();
  return { client, refreshChoice: update, destroy: () => { consent?.destroy(); view?.removeEventListener('storage', storageChanged); root.remove(); } };
}

let consentSerial = 0;
// A native modal supplies focus containment and escape handling. Older browsers
// retain the explicit inline controls; dismissal never grants permission.
export function mountConsentWindow(container, client, { language = 'en', privacyURL,
  onChange = () => {}, autoOpen = true } = {}) {
  const doc = container.ownerDocument;
  if (!doc?.createElement) return { refresh() {}, destroy() {} };
  const dialog = doc.createElement('dialog');
  if (!doc.body?.append || typeof dialog.showModal !== 'function') return { refresh() {}, destroy() {} };
  const privacy = new URL(privacyURL);
  if (privacy.protocol !== 'https:' || privacy.username || privacy.password) throw TypeError('HTTPS privacy link required');
  let lang = language === 'de' ? 'de' : 'en';
  const add = (parent, tag) => { const node = doc.createElement(tag); parent.append(node); return node; };
  const reopen = add(container, 'button'); reopen.type = 'button';
  const heading = add(dialog, 'h2'); heading.id = `arcdrake-consent-${++consentSerial}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  Object.assign(dialog.style, { boxSizing: 'border-box', width: 'min(36rem, calc(100vw - 2rem))',
    maxHeight: 'calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
    overflowY: 'auto', padding: '1.25rem', borderRadius: '1rem', color: '#18202a', background: '#fff', border: '2px solid #52606d' });
  const purpose = add(dialog, 'p'), details = add(dialog, 'details'), summary = add(details, 'summary');
  heading.style.margin = '0 0 .75rem';
  Object.assign(purpose.style, { margin: '.75rem 0', lineHeight: '1.5' });
  details.style.margin = '.75rem 0';
  const description = add(details, 'p'), privacyLink = add(dialog, 'a'); privacyLink.href = privacy.href;
  const controls = add(dialog, 'div'); Object.assign(controls.style, { display: 'flex', flexWrap: 'wrap', gap: '.75rem', marginTop: '1rem' });
  const deny = add(controls, 'button'), allow = add(controls, 'button');
  for (const button of [deny, allow, reopen]) { button.type = 'button'; Object.assign(button.style, {
    minHeight: '44px', padding: '.65rem 1rem', border: '1px solid #52606d', borderRadius: '.4rem',
    background: '#fff', color: '#18202a', font: 'inherit', cursor: 'pointer' }); }
  const status = add(dialog, 'p'); status.setAttribute('role', 'status');
  const refresh = () => {
    const de = lang === 'de', copy = NOTICES[lang];
    dialog.lang = lang;
    heading.textContent = reopen.textContent = de ? 'Datenschutzeinstellungen' : 'Privacy choices';
    purpose.textContent = de
      ? 'Darf Arcdrake optionale Nutzungsaktionen zählen, um zu verstehen, welche Werkzeuge und Spiele genutzt werden? Ohne Zustimmung bleibt die Zählung aus. Die Website funktioniert in beiden Fällen. Du kannst deine Auswahl jederzeit über „Datenschutzeinstellungen“ ändern.'
      : 'May Arcdrake count optional usage actions to understand which tools and games are used? Counts stay off without permission. The site works either way. You can change your choice at any time through “Privacy choices”.';
    summary.textContent = de ? 'Was wird verarbeitet und gespeichert?' : 'What is processed and stored?';
    description.textContent = copy.analytics;
    privacyLink.textContent = copy.privacy;
    if (['/privacy/', '/de/privacy/'].includes(privacy.pathname)) {
      const localized = new URL(privacy); localized.pathname = de ? '/de/privacy/' : '/privacy/'; privacyLink.href = localized.href;
    }
    deny.textContent = de ? 'Ohne Nutzungszählung fortfahren' : 'Continue without usage counts';
    allow.textContent = copy.allow;
    allow.disabled = client.choice() === 'blocked';
    status.textContent = (client.choice() === 'blocked' ? copy.blocked : client.choice() === 'yes' ? copy.on : copy.off) +
      (client.choicePersistence() === 'page' ? ` ${copy.pageOnly}` : '');
  };
  const choose = value => { client.setChoice(value); refresh(); onChange(); dialog.close(); };
  deny.addEventListener('click', () => choose('no'));
  allow.addEventListener('click', () => choose('yes'));
  dialog.addEventListener('cancel', event => { event.preventDefault(); choose('no'); });
  reopen.addEventListener('click', () => { refresh(); if (!dialog.open) dialog.showModal(); });
  const languageChanged = event => { if (['en', 'de'].includes(event.detail?.language)) { lang = event.detail.language; refresh(); } };
  doc.defaultView?.addEventListener('arcdrake-language-change', languageChanged);
  const stored = () => refresh(); doc.defaultView?.addEventListener('storage', stored);
  doc.body.append(dialog); refresh();
  if (autoOpen && client.choice() === 'unset') dialog.showModal();
  return { refresh, destroy() { if (dialog.open) dialog.close(); dialog.remove(); reopen.remove();
    doc.defaultView?.removeEventListener('arcdrake-language-change', languageChanged); doc.defaultView?.removeEventListener('storage', stored); } };
}

// Wrap the real user-requested action. A rejected action never records completion;
// measurement failures do not change the task result. No task data is transmitted.
export async function runMeasuredAction(client, kind, action) {
  if (!['play', 'tool'].includes(kind) || typeof action !== 'function') throw new TypeError('Action kind/callback required');
  void client.track(`${kind}_start`);
  const result = await action();
  void client.track(`${kind}_complete`);
  return result;
}
