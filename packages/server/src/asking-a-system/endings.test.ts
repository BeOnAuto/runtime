import { Ledger } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  endedFor,
  endingOf,
  mayChange,
  problems,
  someDetail,
  type Row,
} from '../testing/interaction-servers/call-endings.ts';
import { askingASystem, calling, problemWith, systemRunId } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { acting, beforeAnything } from './ending-rows.ts';
import { afterSending, unreadable } from './sent-ending-rows.ts';

const anotherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const anIncident: unknown = expect.stringMatching(/^urn:uuid:/u);

function endedActing(row: Row) {
  return endedFor('interaction', acting(row));
}

describe('a run that calls a tool that acts and ends before anything is sent, over HTTP', () => {
  it.each(beforeAnything)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedActing(row)).toEqual(ending);
  });
});

describe('a run that calls a tool that acts and ends after its call was sent, over HTTP', () => {
  it.each(afterSending)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedActing(row)).toEqual(ending);
  });
});

describe('a run that calls a tool that acts and cannot use what the tool answered, over HTTP', () => {
  it.each(unreadable)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedActing(row)).toEqual(ending);
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

describe('a run that calls a tool whose start of the call the ledger refuses, over HTTP', () => {
  it('fails with an incident, sends nothing, and is recorded failed', async () => {
    const server = await askingASystem({ ledgerOver: refusingCallStarts, hints: { thread: mayChange } });
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

describe('a run that calls a tool that acts, run again under its id, over HTTP', () => {
  it('runs again when nothing was sent, and is tools_called once its call was sent', async () => {
    const server = await askingASystem({
      entry: { allowed: ['search', 'gone', 'denied'] },
      hints: { denied: mayChange },
    });
    await server.define('asking');
    await server.define('denying', calling('denied'));

    const unsent = [await server.runCall('asking'), await server.runCall('asking')];
    const sent = [
      await server.runCall('denying', undefined, anotherRunId),
      await server.runCall('denying', undefined, anotherRunId),
    ];

    expect([...unsent, ...sent].map(({ status }) => status)).toEqual([503, 503, 409, 409]);
    expect([unsent[1]?.body, sent[0]?.body, sent[1]?.body]).toEqual([
      problemWith({ kind: 'tool_not_offered' }),
      problemWith({ kind: 'effect_unknown', because: 'tool_error' }),
      problemWith({ type: `${problems}tools_called`, kind: 'tools_called' }),
    ]);
    expect(sent[1]?.body).not.toMatchObject({ because: 'only_read' });
    expect(server.fake.received()).toHaveLength(1);
  });
});
