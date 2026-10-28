import { studioBaseOf, studioLinkOf, type AccessMode, type StudioSettings } from '@on.auto/identity';

import { defaultRuntimePort } from '../local-runtime/local-control.ts';
import { linkerFor, painterFor, type ColorDepth } from '../logging/terminal.ts';
import type { Install } from '../server-options/server-options.ts';
import { firstStartNotice } from '../usage-ping/usage-ping.ts';
import { logoHeight, logoLines, type PaintingDepth } from './logo.ts';

export interface Ready {
  readonly version: string;
  readonly port: number;
  readonly readyInMs: number;
  readonly mode: AccessMode;
  readonly identityService: string | undefined;
  readonly studio: StudioSettings;
  readonly install: Install | undefined;
  readonly license: string | undefined;
}

const tagline = 'Runs the playbooks your agent builds';

const documentation = 'https://on.auto/docs/';

export const discordInvite = 'https://discord.gg/B8BKcKMRm8';

function agentCommandsFor({ version, port, mode }: Ready, mcp: string): readonly (readonly [string, string])[] {
  if (mode !== 'local') {
    return [
      ['Claude Code', `claude mcp add --transport http auto-runtime ${mcp}`],
      ['Codex', `codex mcp add auto-runtime --url ${mcp}`],
    ];
  }
  const entry = `npx -y @on.auto/runtime@${version} mcp`;
  const portSet = port === defaultRuntimePort ? '' : ` --env PORT=${port}`;
  return [
    ['Claude Code', `claude mcp add${portSet} auto-runtime -- ${entry}`],
    ['Codex', `codex mcp add auto-runtime${portSet} -- ${entry}`],
  ];
}

function plainHeader(version: string): string {
  return `\nAuto Runtime v${version}\n${tagline}\n\n`;
}

function paintedHeader(version: string, depth: PaintingDepth): string {
  const paint = painterFor(depth);
  const titleRow = Math.floor(logoHeight / 2) - 1;
  const besideLogo = new Map([
    [titleRow, `${paint('bold', 'Auto Runtime')} ${paint('dim', `v${version}`)}`],
    [titleRow + 1, paint('dim', tagline)],
  ]);
  const lines = logoLines(depth).map((line, row) => {
    const beside = besideLogo.get(row);
    return beside === undefined ? `  ${line}` : `  ${line}  ${beside}`;
  });
  return `\n${lines.join('\n')}\n\n`;
}

export function headerOf(version: string, depth: ColorDepth): string {
  return depth === 1 ? plainHeader(version) : paintedHeader(version, depth);
}

const localModeNotice =
  'Local mode: no sign-in, so anyone using this computer can act as you. To require sign-in, set PUBLIC_URL.';

function noticesOf({ mode, license }: Ready, depth: ColorDepth): readonly string[] {
  const paint = painterFor(depth);
  const notices = [...(license === undefined ? [] : [license]), ...(mode === 'local' ? [localModeNotice] : [])];
  return notices.length === 0 ? [] : ['', ...notices.map((notice) => `  ${paint('dim', notice)}`)];
}

function usagePingNotice(install: Install | undefined, depth: ColorDepth): readonly string[] {
  return install?.isNew === true ? [`  ${painterFor(depth)('dim', firstStartNotice)}`, ''] : [];
}

export function readyNoticeOf(ready: Ready, depth: ColorDepth): string {
  const { port, readyInMs, identityService, install } = ready;
  const paint = painterFor(depth);
  const link = linkerFor(depth);
  const url = `http://localhost:${port}`;
  const mcp = `${url}/mcp`;
  const studioBase = studioBaseOf(ready.studio, url);
  const studio = studioLinkOf(ready.studio, { ownOrigin: url, openedFrom: 'terminal', installId: install?.id });
  const studioShown = port === defaultRuntimePort ? studioBase : `${studioBase}?server=${url}`;
  const entry = (label: string, value: string): string => `     ${paint('dim', label.padEnd(8))} ${link(value, value)}`;
  const agent = (label: string, command: string): string => `    ${label.padEnd(13)} ${paint('dim', command)}`;
  const signIn = identityService === undefined ? [] : [entry('Sign-in', identityService)];
  return [
    `  ${paint('green', '✔')} Ready in ${readyInMs} ms`,
    `  ${paint('cyan', '➜')}  ${paint('bold', 'Studio'.padEnd(8))} ${paint(['cyan', 'bold'], link(studio, studioShown))}`,
    entry('Server', url),
    entry('MCP', mcp),
    ...signIn,
    entry('Docs', documentation),
    ...noticesOf(ready, depth),
    '',
    `  ${paint('dim', 'Connect your agent')}`,
    ...agentCommandsFor(ready, mcp).map(([label, command]) => agent(label, command)),
    '',
    ...usagePingNotice(install, depth),
    `  ${paint('dim', 'Press Ctrl+C to stop.')}`,
    '',
  ].join('\n');
}

export function stoppingNotice(depth: ColorDepth): string {
  return `\n  ${painterFor(depth)('dim', 'Stopping…')}\n`;
}

export function stoppedNotice(depth: ColorDepth): string {
  return `  ${painterFor(depth)('green', '✔')} Stopped\n`;
}

const spinnerFrames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

export function startingLine(frame: number, depth: ColorDepth): string {
  return `\r  ${painterFor(depth)('cyan', spinnerFrames.charAt(frame % spinnerFrames.length))} Starting…`;
}

export const clearedLine = '\r\u001B[2K';
