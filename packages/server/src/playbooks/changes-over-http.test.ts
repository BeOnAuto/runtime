import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../lifecycle/lifecycle.ts';
import type { RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { testComposition } from '../testing/servers/test-compositions.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes a text',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const AnswerSchema = Schema.Struct({ cursor: Schema.String });

const EventsSchema = Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String })) });

let server: ReasoningServer;

async function cursorOf(path: string): Promise<string> {
  return Schema.decodeUnknownSync(AnswerSchema)((await server.call('GET', path)).body).cursor;
}

function summaryCreated() {
  return server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summary, diagram: 'none' },
  });
}

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const alphaReader = createApiKey({
  id: 'alpha-reader',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: ['alpha'],
});

let ledger: TemporaryLedger;

let serverChangesWithKeys: RunningServer;

function asAdmin(method: string, path: string, body?: unknown) {
  return request(serverChangesWithKeys.port, method, path, {
    key: acmeAdmin.key,
    ...(body === undefined ? {} : { body }),
  });
}

function asReader(path: string) {
  return request(serverChangesWithKeys.port, 'GET', path, { key: alphaReader.key });
}

describe('changes over http', () => {
  beforeEach(async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('the changes of an org over HTTP', () => {
    it('name the playbooks created after the cursor of now', async () => {
      const now = await cursorOf('/v1/orgs/acme/changes');
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });
      await server.call('POST', '/v1/orgs/globex/playbooks', { body: { playbook: 'gamma', name: 'Gamma' } });

      expect(await server.call('GET', `/v1/orgs/acme/changes?since=${now}&wait=0`)).toMatchObject({
        status: 200,
        body: { changes: [{ kind: 'playbook', playbook: 'beta' }], more: false },
      });
    });
  });

  describe('the changes of an org and its playbooks over HTTP, while nothing changed', () => {
    it('hold one request until a definition is saved in any playbook, and answer it with its playbook', async () => {
      const across = '/v1/orgs/acme/changes?scope=org_and_playbooks';
      const now = await cursorOf(across);
      const arrivedBefore = server.arrived().length;

      const held = server.call('GET', `${across}&since=${now}&wait=20`);
      await whenHeld(
        () => server.arrived().slice(arrivedBefore),
        (arrived: ReturnType<ReasoningServer['arrived']>) => arrived.some(({ path }) => path.endsWith('/changes')),
      );
      await summaryCreated();

      expect(await held).toMatchObject({
        status: 200,
        body: {
          changes: [{ kind: 'definition', type: 'reasoning', name: 'summary', playbook: 'alpha' }],
          playbooks: '*',
        },
      });
    });
  });

  describe('the changes of a playbook over HTTP', () => {
    it('name the definitions saved after the cursor, and an event published to it by the id its feed lists it by', async () => {
      const now = await cursorOf(`${alpha}/changes`);
      await summaryCreated();
      await server.call('POST', `${alpha}/events`, { body: { event: { source: '/ledger', type: 'com.acme.closed' } } });
      const { events } = Schema.decodeUnknownSync(EventsSchema)(
        (await server.call('GET', `${alpha}/events?type=event_published`)).body,
      );

      expect(await server.call('GET', `${alpha}/changes?since=${now}&wait=0`)).toMatchObject({
        status: 200,
        body: {
          changes: [
            { kind: 'definition', type: 'reasoning', name: 'summary' },
            { kind: 'event', event_id: events[0]?.id },
          ],
          more: false,
        },
      });
    });
  });

  describe('the changes of a playbook over HTTP, while nothing changed', () => {
    it('hold the request until a definition is saved, and answer then', async () => {
      const now = await cursorOf(`${alpha}/changes`);
      const arrivedBefore = server.arrived().length;

      const held = server.call('GET', `${alpha}/changes?since=${now}&wait=20`);
      await whenHeld(
        () => server.arrived().slice(arrivedBefore),
        (arrived: ReturnType<ReasoningServer['arrived']>) => arrived.some(({ path }) => path.endsWith('/changes')),
      );
      await summaryCreated();

      expect(await held).toMatchObject({
        status: 200,
        body: { changes: [{ kind: 'definition', type: 'reasoning', name: 'summary' }] },
      });
    });

    it('refuse a cursor the ledger does not hold with its own problem type, and a wait past 25 seconds', async () => {
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });
      await summaryCreated();
      const ofAlpha = await cursorOf(`${alpha}/changes`);

      const [unheld, ofAnother, tooLong] = await Promise.all([
        server.call('GET', `${alpha}/changes?since=W1siMSIsImlkIl1d`),
        server.call('GET', `/v1/orgs/acme/playbooks/beta/changes?since=${ofAlpha}&wait=0`),
        server.call('GET', `${alpha}/changes?wait=26`),
      ]);

      expect([unheld, ofAnother]).toMatchObject([
        {
          status: 422,
          body: { type: 'https://on.auto/problems/cursor_not_held', reason: 'invalid_input', kind: 'cursor_not_held' },
        },
        { status: 422, body: { type: 'https://on.auto/problems/cursor_not_held' } },
      ]);
      expect(tooLong).toMatchObject({ status: 422, body: { reason: 'invalid_input', errors: [{ pointer: '/wait' }] } });
    });
  });
});

describe('changes with keys', () => {
  beforeEach(async () => {
    ledger = temporaryLedger();
    serverChangesWithKeys = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LEDGER_FILE: ledger.fileName,
        API_KEYS: JSON.stringify([acmeAdmin.entry, alphaReader.entry]),
      },
      testComposition({ goals: false }),
    );
  });

  afterEach(async () => {
    await serverChangesWithKeys.stop();
    ledger.remove();
  });

  describe('the changes of an org to a key limited to some of its playbooks', () => {
    it('name none of the playbooks it may not access, give back the cursor it gave, and name those it may', async () => {
      const now = Schema.decodeUnknownSync(AnswerSchema)((await asReader('/v1/orgs/acme/changes')).body).cursor;
      await asAdmin('POST', '/v1/orgs/acme/playbooks', { playbook: 'beta', name: 'Beta' });
      await asAdmin('PUT', '/v1/orgs/acme/playbooks/beta', { name: 'Bet', description: '' });
      await asAdmin('POST', '/v1/orgs/acme/playbooks/beta/retire');

      const unseen = await asReader(`/v1/orgs/acme/changes?since=${now}&wait=0`);
      await asAdmin('POST', '/v1/orgs/acme/playbooks', { playbook: 'alpha', name: 'Alpha' });
      const seen = await asReader(`/v1/orgs/acme/changes?since=${now}&wait=0`);

      expect(unseen).toMatchObject({ status: 200, body: { cursor: now, changes: [], more: false } });
      expect(seen).toMatchObject({ status: 200, body: { changes: [{ kind: 'playbook', playbook: 'alpha' }] } });
    });
  });
});

describe('a held request for the changes of a playbook, when the server stops', () => {
  it('is answered at once with the cursor it was given and no changes, and the stop does not wait for it', async () => {
    const waiting = Promise.withResolvers<void>();
    const serverHeldChanges = await servingReasoning([], {}, undefined, {
      ledgerOver: (kept) => ({
        ...kept,
        waitForAppend: (scope, after, deadline) => {
          waiting.resolve();
          return kept.waitForAppend(scope, after, deadline);
        },
      }),
    });
    await serverHeldChanges.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const now = Schema.decodeUnknownSync(AnswerSchema)(
      (await serverHeldChanges.call('GET', `${alpha}/changes`)).body,
    ).cursor;

    const held = serverHeldChanges.call('GET', `${alpha}/changes?since=${now}&wait=25`);
    await waiting.promise;
    await serverHeldChanges.stop();

    expect(await held).toMatchObject({ status: 200, body: { cursor: now, changes: [], more: false } });
  });
});
