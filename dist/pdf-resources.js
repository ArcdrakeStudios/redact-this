// Retain only public rendering resources, never source PDF bytes or page pixels.
// PDF.js clears its font cache during cleanup and may silently substitute fonts
// after a fetch failure. Keep resource bytes for this document and fail closed.
export function createPdfResourceCache({fetchResource = globalThis.fetch,
  maxBytes = 16_000_000, maxResourceBytes = 4_000_000, maxResources = 256} = {}) {
  const cache = new Map(), controller = new AbortController();
  let total = 0, failure = false, disposed = false;
  const unavailable = () => new Error('Required local PDF resources are unavailable. Reconnect and choose the file again.');
  const cancelled = () => new DOMException('Operation cancelled.', 'AbortError');
  async function read(response) {
    if (!response.ok) throw unavailable();
    const header = response.headers.get('content-length');
    const length = header === null ? null : Number(header);
    if (length !== null && (!Number.isSafeInteger(length) || length < 0 || length > maxResourceBytes)) throw unavailable();
    // Fetch decompresses HTTP bodies. Content-Length then describes wire bytes,
    // while the stream and cache budgets apply to the decoded resource bytes.
    const compressed = ![null, 'identity'].includes(response.headers.get('content-encoding'));
    const reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const chunks = [];
    let size = 0, complete = false;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (disposed) throw cancelled();
        if (done) break;
        if (!(value instanceof Uint8Array) || size + value.byteLength > maxResourceBytes ||
            total + value.byteLength > maxBytes) throw unavailable();
        size += value.byteLength; total += value.byteLength;
        chunks.push(value);
      }
      if (!size || (!compressed && length !== null && length !== size)) throw unavailable();
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      complete = true;
      return result;
    } finally {
      if (!complete) {
        // Release a failed stream promptly, including an oversized response.
        await reader.cancel().catch(() => {});
        if (!disposed) total -= size;
      }
      reader.releaseLock();
    }
  }
  class BinaryDataFactory {
    constructor(urls) { this.urls = urls; }
    async fetch({kind, filename}) {
      if (disposed) throw cancelled();
      try {
        if (!['cMapUrl', 'standardFontDataUrl', 'wasmUrl'].includes(kind) ||
            typeof filename !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(filename) ||
            filename === '.' || filename === '..') throw unavailable();
        const base = this.urls[kind];
        if (typeof base !== 'string' || !base.endsWith('/')) throw unavailable();
        const url = new URL(filename, base).href;
        if (url !== base + filename) throw unavailable();
        if (!cache.has(url)) {
          if (cache.size >= maxResources) throw unavailable();
          cache.set(url, (async () => read(await fetchResource(url, {
            signal:controller.signal, credentials:'omit', redirect:'error'
          })))());
        }
        // Worker transfers may detach buffers; never transfer the cached copy.
        return (await cache.get(url)).slice();
      } catch {
        if (disposed) throw cancelled();
        failure = true;
        throw unavailable();
      }
    }
  }
  return {
    BinaryDataFactory,
    assertReady() { if (disposed) throw cancelled(); if (failure) throw unavailable(); },
    dispose() { disposed = true; controller.abort(); cache.clear(); total = 0; },
    get bytes() { return total; }
  };
}
