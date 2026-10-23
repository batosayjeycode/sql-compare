import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../../vite.pwa';

describe('Content-Security-Policy', () => {
  it('sends the same policy as a header (plus frame-ancestors) and as a meta tag', () => {
    const headers = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
    const header = /Content-Security-Policy: (.+)/.exec(headers)?.[1];
    expect(header).toBe(`${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`);
  });

  it('allows no inline or evaluated scripts', () => {
    const script = CONTENT_SECURITY_POLICY.split('; ').find((d) => d.startsWith('script-src'));
    expect(script).toBe("script-src 'self' 'wasm-unsafe-eval'");
  });
});
