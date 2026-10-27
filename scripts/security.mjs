// Exact immutable shared consent CSS only; package tests verify its source hash.
export const CONSENT_STYLE_HASH = 'sha256-VHXTEYUc0+/a/3/pxtfczPbGydBF1J/t2RF/LB9heIo=';
// Apply to both the document and dedicated PDF parser worker responses.
export const securityHeaders = Object.freeze({
  'Content-Security-Policy': `default-src 'self'; img-src 'self' blob: data:; style-src 'self' '${CONSENT_STYLE_HASH}'; script-src 'self'; worker-src 'self'; font-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
});
