export class SourceSessionError extends Error {
  constructor(message, retryAfterMs = 60 * 60_000) {
    super(message); this.name = 'SourceSessionError'; this.retryAfterMs = retryAfterMs;
  }
}

export async function navigateSource(page, url) {
  let status;
  const observe = response => {
    if (response.request().isNavigationRequest()) status = response.status();
  };
  page.on('response', observe);
  try {
    let failure;
    try { await page.goto(url, {waitUntil:'domcontentloaded', timeout:20_000}); }
    catch (error) { failure = error; }
    const destination = page.url();
    if (/\/challenge\/|\/checkpoint\//.test(destination))
      throw new SourceSessionError('Instagram source session requires account verification; open npm run source:login.');
    if (status === 429) throw new SourceSessionError('Instagram source requests are rate limited (HTTP 429).');
    if (/\/accounts\/login/.test(destination))
      throw new SourceSessionError('Instagram source session is signed out; open npm run source:login.');
    if (failure) throw failure;
    if (status >= 400) throw new Error(`Source page returned HTTP ${status}`);
  } finally { page.off('response', observe); }
}
