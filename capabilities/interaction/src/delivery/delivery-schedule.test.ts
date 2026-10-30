import { Ledger } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Layer, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from '../requests/open-requests.ts';
import { askedRunId, askedThroughChat, type HarnessLedger, type InteractionHarness } from '../testing/index.ts';

const minute = 60_000;

const unrenderable: unknown = expect.objectContaining({
  because: 'unworkable',
  detail: 'The argument text of the call that delivers the request reads a value it does not have',
});

const someText: unknown = expect.any(String);

const failing = { outcome: 'server_failure', detail: 'The tool server answered HTTP 503', retryAfterMs: null } as const;

const Deferring = Schema.Struct({
  type: Schema.Literal('finish'),
  result: Schema.Struct({ type: Schema.Literal('run_deferred'), data: Schema.Struct({ record: Schema.JsonObject }) }),
});

const isDeferring = Schema.is(Deferring);

const grownArguments = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`a${index}`, '{{ message }}']));

function recordedWith(ledger: HarnessLedger, arguments_: Readonly<Record<string, string>>): HarnessLedger {
  const service: Ledger['Service'] = {
    ...ledger.service,
    execute: (stream, decider, command, given) => {
      if (!isDeferring(command)) {
        return ledger.service.execute(stream, decider, command, given);
      }
      const deliver = { server: 'chat', tool: 'post_message', with: arguments_ };
      const record = { ...command.result.data.record, deliver };
      return ledger.service.execute(
        stream,
        decider,
        { ...command, result: { ...command.result, data: { record } } },
        given,
      );
    },
  };
  return { service, layer: Layer.succeed(Ledger, service) };
}

const largeWords: unknown = expect.stringMatching(
  /^The arguments of the call that delivers the request take \d+ bytes, more than the 16384 a call may send$/u,
);

async function endedOf(playbook: InteractionHarness): Promise<readonly unknown[]> {
  const { records } = await Effect.runPromise(
    playbook.ledger.service.readRecorded(
      { org: 'acme', playbook: 'alpha' },
      { kind: 'run', run: askedRunId },
      {
        order: 'asc',
        limit: 20,
        types: ['delivery_succeeded', 'delivery_failed', 'delivery_refused'],
        dataOf: ['delivery_succeeded', 'delivery_failed', 'delivery_refused'],
      },
    ),
  );
  return records.map(({ type, data }) => ({ type, data }));
}

describe('a delivery that fails for a while', () => {
  it('is tried again on the schedule, a minute after a failure', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    tools.answerNext(failing);

    await playbook.performDue(askedAt);
    const tooSoon = await playbook.performDue(Date.now() + minute - 5000);
    await playbook.performDue(Date.now() + minute + 5000);

    expect([tooSoon, tools.calls().length]).toEqual([0, 2]);
    expect(await playbook.firstOpen()).toMatchObject({ attempts: 2, standing: 'delivered' });
  });

  it('honours the wait a 429 asks for within the schedule', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    tools.answerNext({ ...failing, detail: 'The tool server answered HTTP 429', retryAfterMs: 120_000 });

    await playbook.performDue(askedAt);
    const afterTheSchedule = await playbook.performDue(Date.now() + minute + 5000);
    const afterTheWait = await playbook.performDue(Date.now() + 2 * minute + 5000);

    expect([afterTheSchedule, afterTheWait, tools.calls().length]).toEqual([0, 1, 2]);
  });

  it('stays open after five failed attempts, delivered no more, until it expires', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    tools.answerNext(failing, failing, failing, failing, failing);

    await playbook.performEach([0, 1, 2, 3, 4, 5].map((step) => askedAt + step * 20 * minute));

    expect(tools.calls()).toHaveLength(5);
    expect(await playbook.firstOpen()).toMatchObject({ attempts: 5, standing: 'undelivered' });
    expect(await playbook.runOf(askedRunId)).toMatchObject({ output: { status: 'started' } });
  });
});

describe('a delivery whose arguments grew past what a call may send', () => {
  it('is refused once without a call, even by two hosts, not tried again, and a notification ends undelivered', async () => {
    const ledger = recordedWith(memoryLedger(undefined, [openRequests]), grownArguments);
    const { playbook, tools, askedAt } = await askedThroughChat({ notification: true, ledger });
    const items = await playbook.dueItems(askedAt);

    await playbook.performAll([...items, ...items], askedAt);
    await playbook.performDue(askedAt + 30 * minute);

    expect(tools.calls()).toEqual([]);
    expect(await playbook.firstOpen()).toBeUndefined();
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'undelivered' } },
    });
    expect(await endedOf(playbook)).toMatchObject([
      { type: 'delivery_refused', data: { because: 'too_large', detail: largeWords } },
    ]);
  });

  it('is refused as unworkable, with what went wrong, when its recorded arguments cannot be rendered', async () => {
    const ledger = recordedWith(memoryLedger(undefined, [openRequests]), { text: '{{ nothing }}' });
    const { playbook, tools, askedAt } = await askedThroughChat({ notification: true, ledger });

    await playbook.performDue(askedAt);

    expect(tools.calls()).toEqual([]);
    expect(await endedOf(playbook)).toEqual([{ type: 'delivery_refused', data: unrenderable }]);
  });
});

describe('a request nobody answered in time', () => {
  it('ends its run unanswered as expired, a final result for its id', async () => {
    const { playbook, askedAt } = await askedThroughChat({ expires: 'PT1H' });

    await playbook.performDue(askedAt + 61 * minute);

    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } },
    });
    expect(await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId)).toMatchObject({
      status: 'rejected',
      reason: 'unanswered',
      kind: 'expired',
    });
    expect(await playbook.firstOpen()).toBeUndefined();
  });
});

describe('a notification delivered through a tool', () => {
  it('succeeds once a delivery lands, with an empty output', async () => {
    const { playbook, askedAt } = await askedThroughChat({ notification: true });

    await playbook.performDue(askedAt);

    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: someText } },
    });
  });

  it('waits for its next attempt after one that failed', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat({ notification: true });
    tools.answerNext(failing);

    await playbook.performDue(askedAt);

    expect(await playbook.runOf(askedRunId)).toMatchObject({ output: { status: 'started' } });
    expect(tools.calls()).toHaveLength(1);
  });
});
