import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

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

beforeEach(async () => {
  server = await servingReasoning([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
});

afterEach(async () => {
  await server.stop();
});

async function cursorOf(path: string): Promise<string> {
  return Schema.decodeUnknownSync(AnswerSchema)((await server.call('GET', path)).body).cursor;
}

function summaryCreated() {
  return server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
}

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

    const started = performance.now();
    const held = server.call('GET', `${alpha}/changes?since=${now}&wait=20`);
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    await summaryCreated();

    expect(await held).toMatchObject({
      status: 200,
      body: { changes: [{ kind: 'definition', type: 'reasoning', name: 'summary' }] },
    });
    expect(performance.now() - started).toBeLessThan(10_000);
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
