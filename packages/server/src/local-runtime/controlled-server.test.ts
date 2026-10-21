import { createApiKey, signInScopes } from '@on.auto/identity';
import { Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { defaultServerOptions, startServer, servedBy, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { accessTokenOf, issuerOverHttps } from '../sign-in/issuer-over-https.ts';
import { optionsServing } from '../testing/entries/serving-options.ts';
import { localControlOf, type LocalControl } from './local-control.ts';
import { runsInFlight } from './runs-in-flight.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0' };

const instance = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const fromABrowser = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

function startedInATerminal(): LocalControl {
  return localControlOf(
    {
      version: '0.9.1',
      pid: 4242,
      instance,
      startedAt: new Date('2026-10-14T09:41:07.000Z'),
      directory: '/Users/ada/playbooks',
      home: '/Users/ada',
      startedBy: 'terminal',
      port: undefined,
    },
    runsInFlight(),
    { leave: () => true },
  );
}

function controlledBy(local: LocalControl): ServerOptions<never> {
  return { ...optionsServing(() => servedBy([])), localServingIn: local.servingIn };
}

interface Answers {
  readonly statuses: readonly number[];
  readonly page: string;
}

async function answersOf(port: number, authorization: string): Promise<Answers> {
  const headers = { authorization: `Bearer ${authorization}` };
  const answers = await Promise.all([
    fetch(`http://localhost:${port}/runtime`, { headers }),
    fetch(`http://localhost:${port}/runtime/stop`, { method: 'POST', headers }),
    fetch(`http://localhost:${port}/runtime/restart`, { method: 'POST', headers }),
  ]);
  const page = await fetch(`http://localhost:${port}/`, { headers: { accept: fromABrowser } });
  return { statuses: answers.map(({ status }) => status), page: await page.text() };
}

describe('a server started with the control of the auto-runtime command', () => {
  it('says what runs, and hears that it should stop', async () => {
    const local = startedInATerminal();
    const server = await startServer(loopback, controlledBy(local));
    onTestFinished(() => server.stop());

    const read = await fetch(`http://localhost:${server.port}/runtime`);
    const stopping = await fetch(`http://localhost:${server.port}/runtime/stop`, { method: 'POST' });

    expect(await read.json()).toMatchObject({ version: '0.9.1', pid: 4242, instance, started_by: 'terminal' });
    expect(await stopping.json()).toEqual({ status: 'stopping' });
    await expect(local.asked).resolves.toBe('stop');
  });

  it('counts the runs the ledger records as started and not ended, as the ledger tells it of each append', async () => {
    const local = startedInATerminal();
    const run = 'playbook/local/alpha/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
    const server = await startServer(loopback, {
      ...defaultServerOptions,
      composed: (_settings, { appended }) => ({
        services: Layer.empty,
        serve: () => {
          appended?.appended(run, [{ type: 'run_started', data: {} }], {
            expectedVersion: 0,
            context: { at: '2026-10-14T09:41:07.000Z', by: 'local' },
          });
          return servedBy([]);
        },
      }),
      localServingIn: local.servingIn,
    });
    onTestFinished(() => server.stop());

    expect(await (await fetch(`http://localhost:${server.port}/runtime`)).json()).toMatchObject({ runs_in_flight: 1 });
  });

  it('has no control without one', async () => {
    const server = await startServer(
      loopback,
      optionsServing(() => servedBy([])),
    );
    onTestFinished(() => server.stop());

    expect((await fetch(`http://localhost:${server.port}/runtime`)).status).toBe(404);
  });
});

describe('a server of the auto-runtime command that takes keys', () => {
  it('has no control, as a server the command did not start, though it listens on loopback', async () => {
    const { key, entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });
    const server = await startServer(
      { ...loopback, API_KEYS: JSON.stringify([entry]) },
      controlledBy(startedInATerminal()),
    );
    onTestFinished(() => server.stop());

    const { statuses, page } = await answersOf(server.port, key);

    expect(statuses).toEqual([404, 404, 404]);
    expect(page).not.toContain('Restart');
    expect(page).not.toContain('Stop');
  });
});

describe('a server of the auto-runtime command that signs people in', () => {
  it('has no control, as a server the command did not start, though it listens on loopback', async () => {
    const issuer = await issuerOverHttps();
    const publicUrl = 'http://localhost:5555';
    const token = await accessTokenOf(issuer, publicUrl, signInScopes.join(' '));
    const server = await startServer(
      { ...loopback, IDENTITY_ISSUER: issuer.issuer, PUBLIC_URL: publicUrl },
      controlledBy(startedInATerminal()),
    );
    onTestFinished(() => server.stop());

    const { statuses, page } = await answersOf(server.port, token);

    expect(statuses).toEqual([404, 404, 404]);
    expect(page).not.toContain('Restart');
    expect(page).not.toContain('Stop');
  });
});
