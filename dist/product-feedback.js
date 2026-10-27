import {mountMeasurementFeedback} from './shared/measurement-feedback-client.mjs';

// The shared client alone controls consent, privacy signals, validation and sends.
// URLs remain the exact /api/events and /api/feedback on the publication's origin.
const container = document.getElementById('measurement-feedback');
const ui = mountMeasurementFeedback(container, {product:'redact', language:'en'});
export const measurement = ui.client;
void measurement.track('page_view');

function updateLinks(language) {
  const prefix = language === 'de' ? '/de' : '';
  const links = container.querySelectorAll('a');
  links[0].href = `https://tools.arcdrake.com${prefix}/privacy/`;
  links[1].href = `https://arcdrake.com${prefix}/contact/`;
}
updateLinks(document.documentElement.lang);
window.addEventListener('arcdrake-language-change', event => updateLinks(event.detail?.language));
window.addEventListener('storage', () => ui.refreshChoice());
window.addEventListener('pageshow', () => ui.refreshChoice());
document.getElementById('feedback-local').hidden = !['', 'localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
// Text localization is handled by i18n.js without replacing the form or its draft.
