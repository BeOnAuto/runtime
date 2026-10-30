import { Ledger } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { askingASystem, calling, problemWith, systemRunId } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { beforeAnything, endedFor, endingOf, problems } from './ending-rows.ts';
import { afterSending, unreadable } from './sent-ending-rows.ts';

const anotherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const someDetail: unknown = expect.any(String);

const anIncident: unknown = expect.stringMatching(/^urn:uuid:/u);

describe('a run that asks a system and ends before anything is sent, over HTTP', () => {
  it.each(beforeAnything)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedFor(row)).toEqual(ending);
  });
});

describe('a run that asks a system and ends after its call was sent, over HTTP', () => {
  it.each(afterSending)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedFor(row)).toEqual(ending);
  });
});

describe('a run that asks a system and cannot use what the tool answered, over HTTP', () => {
  it.each(unreadable)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedFor(row)).toEqual(ending);
  });
});

const isTheStartOfACall = Schema.is(
  Schema.Struct({
    type: Schema.Literal('call'),
    fact: Schema.Struct({ type: Schema.Literal('tool_call_started') }),
  }),
);

function refusingCallStarts(ledger: Ledger['Service']): Ledger['Service'] {
  return Ledger.of({
    ...ledger,
    execute: (stream, decider, command, lineage) =>
      isTheStartOfACall(command)
        ? Effect.die(new Error('The ledger refused the write'))
        : ledger.execute(stream, decider, command, lineage),
  });
}

describe('a run that asks a system whose start of the call the ledger refuses, over HTTP', () => {
  it('fails with an incident, sends nothing, and is recorded failed', async () => {
    const server = await askingASystem({ ledgerOver: refusingCallStarts });
    await server.define('asking');

    const ended = await server.runCall('asking');
    const read = await server.call('GET', `${alpha}/runs/${systemRunId}`);

    expect(endingOf(ended)).toEqual({
      status: 500,
      type: `${problems}internal`,
      detail: someDetail,
      retryAfter: null,
    });
    expect(ended.body).toMatchObject({ instance: anIncident });
    expect([read.body, server.fake.received(), server.modelCalls()]).toEqual([
      problemWith({ status: 'failed' }),
      [],
      0,
    ]);
  });
});

describe('a run that asks a system, run again under its id, over HTTP', () => {
  it('runs again when nothing was sent, and is tools_called once its call was sent', async () => {
    const server = await askingASystem({ entry: { allowed: ['search', 'gone', 'denied'] } });
    await server.define('asking');
    await server.define('denying', calling('denied'));

    const unsent = [await server.runCall('asking'), await server.runCall('asking')];
    const sent = [
      await server.runCall('denying', undefined, anotherRunId),
      await server.runCall('denying', undefined, anotherRunId),
    ];

    expect([...unsent, ...sent].map(({ status }) => status)).toEqual([503, 503, 503, 409]);
    expect([unsent[1]?.body, sent[1]?.body]).toEqual([
      problemWith({ kind: 'tool_not_offered' }),
      problemWith({ type: `${problems}tools_called`, kind: 'tools_called', because: 'only_read' }),
    ]);
    expect(server.fake.received()).toHaveLength(1);
  });

  it('keeps the wait a 429 asked for past the longest a run waits in its record, and waits out a shorter one', async () => {
    const server = await askingASystem();
    await server.define('asking', calling('search', ['    query: acme']));
    server.fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '20' });

    const limited = await server.runCall('asking');
    server.fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '2' });
    const waited = await server.runCall('asking', undefined, anotherRunId);
    const read = await server.call('GET', `${alpha}/runs/${systemRunId}`);

    expect([limited.status, limited.headers.get('retry-after'), waited.status]).toEqual([503, null, 200]);
    expect(read.body).toMatchObject({
      rejection: { kind: 'tools_unfinished', because: 'server_failed' },
      record: { retry_after_ms: 20_000 },
    });
  });
});
