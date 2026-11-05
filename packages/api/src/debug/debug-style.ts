import { createHash } from 'node:crypto';

import type { ShippedFiles } from '@on.auto/shipped-files';

import { iconOnDark, iconOnLight } from '../landing/auto-logo.ts';
import { fontFacesOf } from '../landing/fonts.ts';
import { debugScript } from './debug-script.ts';

export interface DebugStyle {
  readonly head: string;
  readonly headers: Readonly<Record<string, string>>;
}

const debugStyles = `
:root {
  color-scheme: light dark;
  --paper: #ffffff;
  --panel: #f5f5f4;
  --ink: #121212;
  --rule: #12121226;
  --muted: #666666;
  --focus: #0088b8;
  --mark: #0088b81f;
  --mono: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #121212;
    --panel: #1b1b1b;
    --ink: #f2f2f2;
    --rule: #ffffff26;
    --muted: #b8b8b8;
    --focus: #42c3f7;
    --mark: #42c3f726;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.6 var(--sans); }
a { color: var(--focus); }
code, pre, kbd { font-family: var(--mono); font-size: 0.9em; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.shell { display: grid; grid-template-columns: 290px minmax(0, 1fr); height: 100dvh; }
.rail {
  overflow-y: auto;
  padding: 20px 16px 40px; border-right: 1px solid var(--rule); background: var(--panel);
}
.bar { display: flex; flex-direction: column; gap: 12px; }
.rail .name { margin: 0; font-size: 1.05rem; font-weight: 600; }
.rail .sub { margin: 4px 0 14px; color: var(--muted); font-size: 0.85rem; line-height: 1.5; }
.label { margin: 18px 0 6px; color: var(--muted); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; }
.rail ul { margin: 0; padding: 0; list-style: none; }
.rail li a {
  display: block; padding: 3px 8px; border-radius: 6px; overflow-wrap: anywhere;
  color: var(--ink); font-size: 0.88rem; text-decoration: none;
}
.rail li a:hover { background: var(--mark); }
.rail li a.on { background: var(--ink); color: var(--paper); }
.rail li a code { font-size: 0.78rem; opacity: 0.75; }
.rail details summary { padding: 3px 8px; cursor: pointer; font-size: 0.88rem; }
.rail details ul { padding-left: 12px; }
.n { margin-left: 4px; color: var(--muted); font-family: var(--mono); font-size: 0.75rem; }
.bar.compact { display: none; }
.contents-toggle, .bar select {
  height: 32px; padding: 0 10px; border: 1px solid var(--rule); border-radius: 8px;
  background: var(--paper); color: var(--ink); font: inherit; font-size: 0.86rem;
}
.bar select { flex: 1; min-width: 0; }
.search-open {
  display: flex; justify-content: space-between; width: 100%; padding: 6px 10px;
  border: 1px solid var(--rule); border-radius: 8px; background: var(--paper); color: var(--muted);
  font: inherit; font-size: 0.86rem; cursor: pointer;
}
.search-open:hover { border-color: var(--ink); }
main { min-width: 0; overflow-y: auto; padding: 28px 40px 80px; }
.doc { max-width: 70ch; }
.connection-name { margin: 40px 0 0; padding-top: 16px; border-top: 2px solid var(--ink); font-size: 1.3rem; }
.eyebrow { margin: 32px 0 4px; color: var(--muted); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
.title { margin: 0 0 6px; font-size: 1.6rem; font-weight: 600; line-height: 1.2; }
.lead { margin: 0 0 20px; color: var(--muted); }
.verbatim {
  margin: 0; padding: 14px 16px; border: 1px solid var(--rule); border-radius: 8px; background: var(--panel);
  white-space: pre-wrap; overflow-wrap: anywhere; font: 0.86rem/1.55 var(--mono);
}
.note { margin: 18px 0; padding: 2px 12px; border-left: 3px solid var(--focus); color: var(--muted); font-size: 0.92rem; }
.group-name { margin: 34px 0 4px; color: var(--muted); font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; }
.tool, .prompt { padding: 20px 0; border-top: 1px solid var(--rule); }
.tool h3, .prompt h3 { margin: 0; font: 600 1.02rem/1.4 var(--mono); overflow-wrap: anywhere; }
.subtitle { margin: 0 0 10px; color: var(--muted); font-size: 0.86rem; }
.hints { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; padding: 0; list-style: none; }
.hints li { padding: 1px 8px; border: 1px solid var(--rule); border-radius: 999px; color: var(--muted); font-size: 0.74rem; }
.table { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th, td { padding: 6px 8px; border-top: 1px solid var(--rule); text-align: left; vertical-align: top; }
th { border-top: 0; color: var(--muted); font-size: 0.75rem; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; }
.args td:first-child { font-family: var(--mono); overflow-wrap: anywhere; }
.required { display: inline-block; margin-left: 4px; color: var(--focus); font-size: 0.74rem; white-space: nowrap; }
.limit { margin: 3px 0 0; color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
.md h1 { margin: 0 0 12px; font-size: 1.6rem; }
.md h2 { margin: 30px 0 8px; font-size: 1.2rem; }
.md h3 { margin: 22px 0 6px; font-size: 1.02rem; }
.md h4 { margin: 18px 0 6px; font-size: 0.95rem; }
.md p, .md li { overflow-wrap: anywhere; }
.md pre { padding: 12px 14px; border: 1px solid var(--rule); border-radius: 8px; background: var(--panel); overflow-x: auto; font-size: 0.84rem; line-height: 1.5; }
.md code { padding: 1px 4px; border-radius: 4px; background: var(--mark); }
.md pre code { padding: 0; background: none; }
.md table { display: block; overflow-x: auto; }
.md th, .md td { border: 1px solid var(--rule); }
.md blockquote { margin: 0; padding-left: 12px; border-left: 3px solid var(--rule); color: var(--muted); }
details.raw { margin: 16px 0 0; }
details.raw summary { color: var(--focus); font-size: 0.88rem; cursor: pointer; }
details.raw .verbatim { margin-top: 10px; }
.palette {
  width: min(640px, calc(100vw - 32px)); max-height: 70dvh; margin: 12dvh auto 0; padding: 0;
  border: 1px solid var(--rule); border-radius: 12px; background: var(--paper); color: var(--ink);
}
.palette::backdrop { background: #00000059; }
.palette input {
  width: 100%; padding: 14px 16px; border: 0; border-bottom: 1px solid var(--rule);
  background: transparent; color: var(--ink); font: inherit; font-size: 1rem; outline: none;
}
.palette ol { max-height: calc(70dvh - 60px); margin: 0; padding: 6px; overflow-y: auto; list-style: none; }
.palette li { padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 0.88rem; overflow-wrap: anywhere; }
.palette li small { display: block; margin-top: 2px; color: var(--muted); font-size: 0.75rem; }
.palette li.chosen { background: var(--mark); }
.palette mark { background: var(--mark); color: inherit; font-weight: 600; }
html:not(.scripted) .scripted-only { display: none; }
.scripted .reading-only,
.scripted .connection:not(.on),
.scripted .tree:not(.on),
.scripted .shelf:not(.on),
.scripted .view:not(.on) { display: none; }
.scripted .view .eyebrow:first-child { margin-top: 0; }
@media (max-width: 820px) {
  .shell { grid-template-columns: minmax(0, 1fr); height: auto; }
  .rail { overflow-y: visible; padding: 12px 16px; border-right: 0; border-bottom: 1px solid var(--rule); }
  .bar { flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; }
  .bar .search-open { width: auto; gap: 8px; }
  .bar .search-open kbd, .scripted .rail .sub, .scripted .rail .switches { display: none; }
  .scripted .bar.compact { display: flex; margin-top: 10px; }
  .scripted .rail:not(.open) .contents { display: none; }
  main { overflow-y: visible; padding: 20px 16px 60px; }
}
`;

function sourceOf(text: string): string {
  return `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
}

function policyOf(styles: string): string {
  return [
    "default-src 'none'",
    `script-src ${sourceOf(debugScript)}`,
    `style-src ${sourceOf(styles)}`,
    'font-src data:',
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const debugPageTitle = 'What an agent receives';

function debugStyleOf(fontFaces: string): DebugStyle {
  const styles = `${fontFaces}${debugStyles}`;
  return {
    head: [
      '<meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      `<title>${debugPageTitle} · Auto Runtime</title>`,
      `<link rel="icon" href="${iconOnLight}" media="(prefers-color-scheme: light)" />`,
      `<link rel="icon" href="${iconOnDark}" media="(prefers-color-scheme: dark)" />`,
      `<style>${styles}</style>`,
      `<script>${debugScript}</script>`,
    ].join(''),
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': policyOf(styles),
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  };
}

export async function readDebugStyle(shippedFiles: ShippedFiles): Promise<DebugStyle> {
  return debugStyleOf(await fontFacesOf(shippedFiles));
}
