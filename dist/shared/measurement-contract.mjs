// Shared by the Worker and the copyable browser client. No deployment secrets.
export const PRODUCTS = Object.freeze([
  'tideglass', 'lumen', 'fgm', 'influence', 'tiny', 'rehearsal', 'redact',
  'shrink', 'unpack', 'maildns', 'sitecheck', 'company', 'studios', 'tools',
]);
export const EVENTS = Object.freeze([
  'page_view', 'play_start', 'play_complete', 'feedback_open', 'tool_start', 'tool_complete',
]);
export const CATEGORIES = Object.freeze(['bug', 'idea', 'usability', 'other']);
export const POLICY = Object.freeze({ feedbackDays: 30, eventDays: 90, maxFeedback: 1000, maxPage: 100 });
export const WRITE_ERRORS = Object.freeze({
  invalid: 400, origin: 403, product: 403, method: 405, size: 413,
  type: 415, rate: 429, unavailable: 503, capacity: 503,
});
export const RECEIPT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function validatePayload(kind, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(400, 'invalid');
  const allowed = kind === 'events' ? ['product', 'event'] : ['product', 'category', 'message', 'replyTo'];
  if (Object.keys(data).some(key => !allowed.includes(key)) || !PRODUCTS.includes(data.product))
    throw new ApiError(400, 'invalid');
  if (kind === 'events') {
    if (!EVENTS.includes(data.event)) throw new ApiError(400, 'invalid');
    return { product: data.product, event: data.event };
  }
  if (!CATEGORIES.includes(data.category) || typeof data.message !== 'string') throw new ApiError(400, 'invalid');
  const message = data.message.trim();
  // oxlint-disable-next-line no-control-regex -- Plain text permits tabs/newlines, rejects other controls.
  if (!message || message.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(message))
    throw new ApiError(400, 'invalid');
  const result = { product: data.product, category: data.category, message };
  if (data.replyTo !== undefined) {
    if (typeof data.replyTo !== 'string') throw new ApiError(400, 'invalid');
    const email = data.replyTo.trim();
    // oxlint-disable-next-line no-control-regex -- Prevent header/control injection.
    if (email.length > 254 || /[\x00-\x1f\x7f]/u.test(email) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(email))
      throw new ApiError(400, 'invalid');
    result.replyTo = email;
  }
  return result;
}
