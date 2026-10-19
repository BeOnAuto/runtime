import { createHash } from 'node:crypto';

const inlineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/giu;

export function inlineScriptHashesIn(page: string): readonly string[] {
  const hashes: string[] = [];
  for (const [, script] of page.matchAll(inlineScript)) {
    hashes.push(createHash('sha256').update(String(script)).digest('base64'));
  }
  return hashes;
}

export function servedStudioPolicyOf(scriptHashes: readonly string[]): string {
  return [
    "default-src 'none'",
    ["script-src 'self'", ...scriptHashes.map((hash) => `'sha256-${hash}'`)].join(' '),
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
