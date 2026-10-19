import { studioBaseOf, type StudioSettings } from '@on.auto/identity';
import type { Context, MiddlewareHandler } from 'hono';
import { html, raw } from 'hono/html';

import type { ApiEnv } from '../api-env.ts';
import { mark } from './auto-logo.ts';
import { controlPageHeaders, headOf, readOnlyPageHeaders } from './page-style.ts';
import {
  act,
  refusalOf,
  runtimeActionPaths,
  runtimePath,
  startedInWords,
  statusDocumentOf,
  type RuntimeAction,
  type RuntimeControl,
  type RuntimeStatus,
} from './runtime-control.ts';

const arrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`;

const statusHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const head = headOf('');

type Page = ReturnType<typeof html>;

function studioOn(studio: StudioSettings, server: Readonly<URL>): string {
  return `${studioBaseOf(studio, server.origin)}?server=${encodeURIComponent(server.origin)}`;
}

function factsOf(status: RuntimeStatus): Page {
  const log =
    status.logFile === undefined
      ? ''
      : html`<dt>Log</dt>
          <dd>${status.logFile}</dd>`;
  return html`<dl class="facts">
      <dt>Version</dt>
      <dd>${status.version}</dd>
      <dt>Process</dt>
      <dd>${status.pid}</dd>
      <dt>Started</dt>
      <dd>${startedInWords(status.startedAt, status.startedBy)}</dd>
      <dt>Directory</dt>
      <dd>${status.directory}</dd>
      ${log}
    </dl>
    <div class="controls">
      <form method="post" action="${runtimeActionPaths.restart}"><button type="submit">Restart</button></form>
      <form method="post" action="${runtimeActionPaths.stop}"><button type="submit">Stop</button></form>
    </div>`;
}

function pageOf(studio: StudioSettings, server: Readonly<URL>, status: RuntimeStatus | undefined): Page {
  return html`<!doctype html>
    <html lang="en">
      <head>
        ${raw(head)}
      </head>
      <body>
        <main>
          ${raw(mark)}
          <h1>Auto Runtime is running</h1>
          <p>Create and manage your playbooks in the studio.</p>
          <span class="address">${server.host}</span>
          <a class="open" href="${studioOn(studio, server)}">Open studio ${raw(arrow)}</a>
          ${status === undefined ? '' : factsOf(status)}
        </main>
      </body>
    </html>`;
}

const restartingPage = html`<!doctype html>
  <html lang="en">
    <head>
      ${raw(headOf('<meta http-equiv="refresh" content="4; url=/" />'))}
    </head>
    <body>
      <main>
        ${raw(mark)}
        <h1>Auto Runtime is restarting</h1>
        <p>This page opens again once it is back.</p>
      </main>
    </body>
  </html>`;

const stoppedPage = html`<!doctype html>
  <html lang="en">
    <head>
      ${raw(head)}
    </head>
    <body>
      <main>
        ${raw(mark)}
        <h1>Auto Runtime has stopped</h1>
        <p>Your agent starts it again when it next needs it. To start it yourself, run npx @on.auto/runtime.</p>
      </main>
    </body>
  </html>`;

const actionPages: Readonly<Record<RuntimeAction, Page>> = { stop: stoppedPage, restart: restartingPage };

const actionStates: Readonly<Record<RuntimeAction, string>> = { stop: 'stopping', restart: 'restarting' };

type Answer = (c: Context<ApiEnv>) => Response | Promise<Response>;

function asksForAPage(c: Context<ApiEnv>): boolean {
  return (c.req.header('accept') ?? '').includes('text/html');
}

function guarded(answer: Answer): Answer {
  return (c) =>
    refusalOf({
      host: c.req.header('host') ?? '',
      origin: c.req.header('origin'),
      fetchSite: c.req.header('sec-fetch-site'),
    }) ?? answer(c);
}

function landingAnswerOf(control: RuntimeControl | undefined, studio: StudioSettings): Answer {
  return (c) =>
    c.html(
      pageOf(studio, new URL(c.req.url), control?.status()),
      200,
      control === undefined ? readOnlyPageHeaders : controlPageHeaders,
    );
}

function actionAnswerOf(control: RuntimeControl, action: RuntimeAction): Answer {
  return guarded((c) => {
    act(control, action);
    return asksForAPage(c)
      ? c.html(actionPages[action], 200, readOnlyPageHeaders)
      : c.json({ status: actionStates[action] }, 202, statusHeaders);
  });
}

function controlAnswersOf(control: RuntimeControl): ReadonlyMap<string, Answer> {
  return new Map([
    [`GET ${runtimePath}`, guarded((c) => c.json(statusDocumentOf(control.status()), 200, statusHeaders))],
    [`POST ${runtimeActionPaths.stop}`, actionAnswerOf(control, 'stop')],
    [`POST ${runtimeActionPaths.restart}`, actionAnswerOf(control, 'restart')],
  ]);
}

interface Landing {
  readonly control: RuntimeControl | undefined;
  readonly studio: StudioSettings;
  readonly controls: ReadonlyMap<string, Answer>;
}

function answerFor(c: Context<ApiEnv>, { control, studio, controls }: Landing): Answer | undefined {
  if (c.req.method === 'GET' && c.req.path === '/' && asksForAPage(c)) {
    return landingAnswerOf(control, studio);
  }
  return controls.get(`${c.req.method} ${c.req.path}`);
}

export function landingPageFor(control: RuntimeControl | undefined, studio: StudioSettings): MiddlewareHandler<ApiEnv> {
  const controls = control === undefined ? new Map<string, Answer>() : controlAnswersOf(control);
  const landing = { control, studio, controls };
  return (c, next) => {
    const answer = answerFor(c, landing);
    return answer === undefined ? next() : Promise.resolve(answer(c));
  };
}
