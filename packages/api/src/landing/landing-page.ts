import { studioLinkOf, type ProtectedResource, type StudioSettings } from '@on.auto/identity';
import type { Context, MiddlewareHandler } from 'hono';
import { html, raw } from 'hono/html';

import type { ApiEnv } from '../api-env.ts';
import { publicOriginOf } from '../discovery/public-addresses.ts';
import { brand } from './auto-logo.ts';
import type { PageStyle } from './page-style.ts';
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

type Page = ReturnType<typeof html>;

interface Dressing {
  readonly style: PageStyle;
  readonly head: string;
  readonly actionPage: (action: RuntimeAction) => Page;
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

interface Showing {
  readonly studioLink: string;
  readonly server: Readonly<URL>;
  readonly status: RuntimeStatus | undefined;
  readonly notice: string | undefined;
}

function pageOf(head: string, { studioLink, server, status, notice }: Showing): Page {
  return html`<!doctype html>
    <html lang="en">
      <head>
        ${raw(head)}
      </head>
      <body>
        <main>
          ${raw(brand)}
          <h1>Auto Runtime is running</h1>
          <p>Create and manage your playbooks in Studio.</p>
          ${notice === undefined ? '' : html`<p class="license">${notice}</p>`}
          <span class="address">${server.host}</span>
          <a class="open" href="${studioLink}">Open studio ${raw(arrow)}</a>
          ${status === undefined ? '' : factsOf(status)}
        </main>
      </body>
    </html>`;
}

function restartingPageOf(style: PageStyle): Page {
  return html`<!doctype html>
    <html lang="en">
      <head>
        ${raw(style.head('<meta http-equiv="refresh" content="4; url=/" />'))}
      </head>
      <body>
        <main>
          ${raw(brand)}
          <h1>Auto Runtime is restarting</h1>
          <p>This page opens again once it is back.</p>
        </main>
      </body>
    </html>`;
}

function stoppedPageOf(head: string): Page {
  return html`<!doctype html>
    <html lang="en">
      <head>
        ${raw(head)}
      </head>
      <body>
        <main>
          ${raw(brand)}
          <h1>Auto Runtime has stopped</h1>
          <p>Your agent starts it again when it next needs it. To start it yourself, run npx @on.auto/runtime.</p>
        </main>
      </body>
    </html>`;
}

function dressingOf(style: PageStyle): Dressing {
  const head = style.head('');
  const actionPages: Readonly<Record<RuntimeAction, Page>> = {
    stop: stoppedPageOf(head),
    restart: restartingPageOf(style),
  };
  return { style, head, actionPage: (action) => actionPages[action] };
}

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

function landingAnswerOf(
  { control, studio, resource, installId, licenseNotice }: Landing,
  { head, style }: Dressing,
): Answer {
  return async (c) => {
    const server = new URL(publicOriginOf(c, resource));
    const studioLink = studioLinkOf(studio, {
      ownOrigin: server.origin,
      openedFrom: 'runtime-page',
      installId: installId?.(),
    });
    const notice = await licenseNotice?.();
    return c.html(
      pageOf(head, { studioLink, server, status: control?.status(), notice }),
      200,
      control === undefined ? style.readOnlyHeaders : style.controlHeaders,
    );
  };
}

function actionAnswerOf(control: RuntimeControl, action: RuntimeAction, { actionPage, style }: Dressing): Answer {
  return guarded((c) => {
    act(control, action);
    return asksForAPage(c)
      ? c.html(actionPage(action), 200, style.readOnlyHeaders)
      : c.json({ status: actionStates[action] }, 202, statusHeaders);
  });
}

function controlAnswersOf(control: RuntimeControl, dressing: Dressing): ReadonlyMap<string, Answer> {
  return new Map([
    [`GET ${runtimePath}`, guarded((c) => c.json(statusDocumentOf(control.status()), 200, statusHeaders))],
    [`POST ${runtimeActionPaths.stop}`, actionAnswerOf(control, 'stop', dressing)],
    [`POST ${runtimeActionPaths.restart}`, actionAnswerOf(control, 'restart', dressing)],
  ]);
}

interface Landing {
  readonly control: RuntimeControl | undefined;
  readonly studio: StudioSettings;
  readonly resource: ProtectedResource | undefined;
  readonly installId: (() => string | undefined) | undefined;
  readonly licenseNotice: (() => Promise<string | undefined>) | undefined;
  readonly style: PageStyle;
}

function answerFor(c: Context<ApiEnv>, page: Answer, controls: ReadonlyMap<string, Answer>): Answer | undefined {
  if (c.req.method === 'GET' && c.req.path === '/' && asksForAPage(c)) {
    return page;
  }
  return controls.get(`${c.req.method} ${c.req.path}`);
}

export function landingPageFor(landing: Landing): MiddlewareHandler<ApiEnv> {
  const dressing = dressingOf(landing.style);
  const page = landingAnswerOf(landing, dressing);
  const controls =
    landing.control === undefined ? new Map<string, Answer>() : controlAnswersOf(landing.control, dressing);
  return (c, next) => {
    const answer = answerFor(c, page, controls);
    return answer === undefined ? next() : Promise.resolve(answer(c));
  };
}
