import { createHash } from 'node:crypto';

import { iconOnDark, iconOnLight } from './auto-logo.ts';
import { fontFaces } from './fonts.ts';

const styles = `${fontFaces}
:root {
  color-scheme: light dark;
  --paper: #ffffff;
  --ink: #121212;
  --rule: #12121233;
  --muted: #666666;
  --focus: #0088b8;
  --running: #5ec72d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #121212;
    --ink: #ffffff;
    --rule: #ffffff33;
    --muted: #b8b8b8;
    --focus: #42c3f7;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  padding: 16px;
  display: flex;
  background: var(--paper);
  color: var(--ink);
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
}
main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border: 1px solid var(--rule);
  border-radius: 20px;
  text-align: center;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1;
}
.logo { width: 1.5em; height: 1.5em; }
.logo .tile { fill: var(--ink); }
.logo .glyph { fill: var(--paper); }
h1 {
  margin: 14px 0 0;
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.8px;
}
p {
  margin: 8px 0 18px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--muted);
}
.address {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--running) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--running) 10%, transparent);
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 500;
}
.address::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--running);
}
.open {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin-top: 24px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--paper);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
}
.open:hover { background: color-mix(in srgb, var(--ink) 90%, transparent); }
.open:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.open svg { width: 16px; height: 16px; }
.facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 16px;
  max-width: 100%;
  margin: 28px 0 0;
  font-size: 13px;
  text-align: left;
}
.facts dt { color: var(--muted); }
.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.controls { display: flex; gap: 8px; margin-top: 18px; }
.controls form { margin: 0; }
.controls button {
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.controls button:hover { border-color: var(--ink); }
.controls button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
`;

function policyOf(formAction: string): string {
  return [
    "default-src 'none'",
    `style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'`,
    'font-src data:',
    'img-src data:',
    "base-uri 'none'",
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

function pageHeadersOf(formAction: string, referrerPolicy: string): Readonly<Record<string, string>> {
  return {
    'cache-control': 'no-store',
    'content-security-policy': policyOf(formAction),
    'referrer-policy': referrerPolicy,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
}

export const readOnlyPageHeaders = pageHeadersOf("'none'", 'no-referrer');

export const controlPageHeaders = pageHeadersOf("'self'", 'same-origin');

export function headOf(extra: string): string {
  return [
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    extra,
    '<title>Auto Runtime</title>',
    `<link rel="icon" href="${iconOnLight}" media="(prefers-color-scheme: light)" />`,
    `<link rel="icon" href="${iconOnDark}" media="(prefers-color-scheme: dark)" />`,
    `<style>${styles}</style>`,
  ].join('');
}
