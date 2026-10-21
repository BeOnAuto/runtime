import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { RuntimeAction, RuntimeControl, RuntimeStatus } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';

const fromABrowser = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const startedInATerminal: RuntimeStatus = {
  version: '0.9.1',
  pid: 4242,
  instance: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  startedAt: new Date('2026-10-14T09:41:07.000Z'),
  directory: '/Users/ada/playbooks',
  startedBy: 'terminal',
  logFile: undefined,
  runsInFlight: 0,
};

const startedByAnAgent: RuntimeStatus = {
  ...startedInATerminal,
  directory: '/Users/ada/.auto-runtime',
  startedBy: 'agent',
  logFile: '/Users/ada/.auto-runtime/runtime.log',
};

interface Controlled {
  readonly control: RuntimeControl;
  readonly asked: RuntimeAction[];
}

function controlled(status: RuntimeStatus = startedInATerminal): Controlled {
  const asked: RuntimeAction[] = [];
  return {
    asked,
    control: {
      status: () => status,
      stop: () => {
        asked.push('stop');
      },
      restart: () => {
        asked.push('restart');
      },
    },
  };
}

function handlerFor(control: RuntimeControl): ReturnType<typeof createTestHandler>['handler'] {
  return createTestHandler({ runtimeControl: control }).handler;
}

const onThisComputer = { host: 'localhost:5555' };

function openPage(control: RuntimeControl): Promise<Response> {
  return handlerFor(control).fetch(
    new Request('http://localhost:5555/', { headers: { ...onThisComputer, accept: fromABrowser } }),
  );
}

function postFromThePage(control: RuntimeControl, address: string, host: string): Promise<Response> {
  return handlerFor(control).fetch(
    new Request(address, { method: 'POST', headers: { host, origin: `http://${host}`, accept: fromABrowser } }),
  );
}

function factsOn(page: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...page.matchAll(/<dt>([^<]+)<\/dt>\s*<dd>([^<]*)<\/dd>/gu)].map(([, term = '', fact = '']: readonly string[]) => [
      term,
      fact,
    ]),
  );
}

function styleOf(page: string): string {
  return page.slice(page.indexOf('<style>') + '<style>'.length, page.indexOf('</style>'));
}

describe('the page of a runtime the auto-runtime command started', () => {
  it('says which release runs, in which process, since when and from where', async () => {
    const page = await (await openPage(controlled().control)).text();

    expect(factsOn(page)).toEqual({
      Version: '0.9.1',
      Process: '4242',
      Started: '2026-10-14 09:41 UTC, in a terminal',
      Directory: '/Users/ada/playbooks',
    });
  });

  it('says when an agent started it, and where it writes its log', async () => {
    const page = await (await openPage(controlled(startedByAnAgent).control)).text();

    expect(factsOn(page)).toMatchObject({
      Started: '2026-10-14 09:41 UTC, by your agent',
      Log: '/Users/ada/.auto-runtime/runtime.log',
    });
  });

  it('shows the directory as text, whatever it holds', async () => {
    const page = await (
      await openPage(controlled({ ...startedInATerminal, directory: '/tmp/<b>bold</b>' }).control)
    ).text();

    expect(factsOn(page)).toMatchObject({ Directory: '/tmp/&lt;b&gt;bold&lt;/b&gt;' });
  });

  it('offers to restart and to stop it', async () => {
    const page = await (await openPage(controlled().control)).text();

    expect(page).toContain(
      '<form method="post" action="/runtime/restart"><button type="submit">Restart</button></form>',
    );
    expect(page).toContain('<form method="post" action="/runtime/stop"><button type="submit">Stop</button></form>');
  });
});

describe('what the page of a runtime the auto-runtime command started allows', () => {
  it('names its origin to itself, so a browser sends it with its forms, and to no one else', async () => {
    expect((await openPage(controlled().control)).headers.get('referrer-policy')).toBe('same-origin');
  });

  it('may send its forms to itself, and still run no script', async () => {
    const response = await openPage(controlled().control);
    const ownStyles = createHash('sha256')
      .update(styleOf(await response.text()))
      .digest('base64');

    expect(response.headers.get('content-security-policy')).toBe(
      `default-src 'none'; style-src 'sha256-${ownStyles}'; font-src data:; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    );
  });
});

describe('the page of a runtime started any other way', () => {
  it('shows neither the facts of the process nor the controls', async () => {
    const response = await createTestHandler().handler.fetch(
      new Request('http://localhost:5555/', { headers: { ...onThisComputer, accept: fromABrowser } }),
    );
    const page = await response.text();

    expect(page).not.toContain('<dl class="facts">');
    expect(page).not.toContain('<form');
  });

  it('has no runtime to read or control', async () => {
    const handler = createTestHandler().handler;

    expect(await call(handler, '/runtime', { headers: onThisComputer })).toMatchObject({ status: 404 });
    expect(await call(handler, '/runtime/stop', { method: 'POST', headers: onThisComputer })).toMatchObject({
      status: 404,
    });
  });
});

describe('the status of the runtime', () => {
  it('is what the page shows, as JSON, with the number of its runs that have not ended', async () => {
    const answer = await call(handlerFor(controlled({ ...startedByAnAgent, runsInFlight: 2 }).control), '/runtime', {
      headers: onThisComputer,
    });

    expect(answer).toMatchObject({
      status: 200,
      body: {
        version: '0.9.1',
        pid: 4242,
        instance: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
        started_at: '2026-10-14T09:41:07.000Z',
        started_by: 'agent',
        directory: '/Users/ada/.auto-runtime',
        log_file: '/Users/ada/.auto-runtime/runtime.log',
        runs_in_flight: 2,
      },
    });
    expect(answer.headers.get('cache-control')).toBe('no-store');
  });

  it('names no log when the runtime writes to its terminal', async () => {
    const { body } = await call(handlerFor(controlled().control), '/runtime', { headers: onThisComputer });

    expect(body).not.toHaveProperty('log_file');
  });
});

describe('stopping and restarting the runtime', () => {
  it.each<readonly [RuntimeAction, string]>([
    ['stop', 'stopping'],
    ['restart', 'restarting'],
  ])('asks it to %s when a program on this computer posts to it', async (action, state) => {
    const controls = controlled();

    const answer = await call(handlerFor(controls.control), `/runtime/${action}`, {
      method: 'POST',
      headers: onThisComputer,
    });

    expect(answer).toMatchObject({ status: 202, body: { status: state } });
    expect(controls.asked).toEqual([action]);
  });

  it('answers the page that stopped it with a page that says so', async () => {
    const controls = controlled();

    const answer = await postFromThePage(controls.control, 'http://localhost:5555/runtime/stop', 'localhost:5555');

    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain('<h1>Auto Runtime has stopped</h1>');
    expect(controls.asked).toEqual(['stop']);
  });

  it('answers the page that restarted it with a page that opens the runtime again once it is back', async () => {
    const controls = controlled();

    const answer = await (
      await postFromThePage(controls.control, 'http://127.0.0.1:5555/runtime/restart', '127.0.0.1:5555')
    ).text();

    expect(answer).toContain('<h1>Auto Runtime is restarting</h1>');
    expect(answer).toContain('<meta http-equiv="refresh" content="4; url=/" />');
    expect(controls.asked).toEqual(['restart']);
  });
  it('does nothing when the action is only read', async () => {
    const controls = controlled();

    const answer = await call(handlerFor(controls.control), '/runtime/stop', { headers: onThisComputer });

    expect(answer.status).toBe(404);
    expect(controls.asked).toEqual([]);
  });
});

describe('what the runtime refuses to be controlled by', () => {
  it.each(['evil.example', 'localhost.evil.example:5555', ''])(
    'refuses a request whose Host is %j, as a rebound name would send',
    async (host) => {
      const controls = controlled();

      const answer = await call(handlerFor(controls.control), '/runtime/stop', { method: 'POST', headers: { host } });

      expect(answer).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
      expect(controls.asked).toEqual([]);
    },
  );

  it('refuses a request that names no Host', async () => {
    const controls = controlled();

    const answer = await call(handlerFor(controls.control), '/runtime/stop', { method: 'POST' });

    expect(answer).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(controls.asked).toEqual([]);
  });
});

describe('what the runtime takes from a browser', () => {
  it('takes the form of its own page from a browser that hides the origin of the page', async () => {
    const controls = controlled();

    const answer = await call(handlerFor(controls.control), '/runtime/restart', {
      method: 'POST',
      headers: { ...onThisComputer, origin: 'null', 'sec-fetch-site': 'same-origin' },
    });

    expect(answer.status).toBe(202);
    expect(controls.asked).toEqual(['restart']);
  });

  it.each(['https://evil.example', 'http://localhost:3000', 'null'])(
    'refuses a page at %s, which a browser names in Origin',
    async (origin) => {
      const controls = controlled();

      const answer = await call(handlerFor(controls.control), '/runtime/restart', {
        method: 'POST',
        headers: { ...onThisComputer, origin },
      });

      expect(answer).toMatchObject({ status: 403, body: { reason: 'origin_not_allowed' } });
      expect(controls.asked).toEqual([]);
    },
  );

  it('refuses to show its status to a page at another origin', async () => {
    const answer = await call(handlerFor(controlled().control), '/runtime', {
      headers: { ...onThisComputer, origin: 'https://evil.example' },
    });

    expect(answer).toMatchObject({ status: 403, body: { reason: 'origin_not_allowed' } });
  });
});
