import { Conflict, type StreamReader, type StreamWriter } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  declaredFactsOf,
  deferredCanceller,
  defineCapability,
  runFactsOf,
  workRecorder,
  type Capability,
} from '../index.ts';
import { asking } from '../testing/asking.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { relay } from '../testing/capabilities/relay.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const relayed = { org: 'acme', playbook: 'alpha', id: relayedId };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: relayedId };

const asked = { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' } as const;

function relayDeciding(cancel: Capability['cancel']): Capability {
  return defineCapability({
    type: 'relay',
    title: 'Relay',
    guide: { name: 'relay' },
    noun: { one: 'relay', other: 'relays' },
    describeOutput: () => 'It handed its input on.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    run: () => Effect.succeed({ finishesLater: true, record: {} }),
    cancel,
  });
}

describe('a cancel of a run of another capability that finishes later', () => {
  it('settles the run as its capability decides from what the run recorded, by whoever asked', async () => {
    const { running, ledger, reading } = await withHandOn();
    await running();
    const deciding = relayDeciding(({ record, kind }) => ({
      status: 'rejected',
      reason: 'cancelled',
      kind,
      detail: `Stopped what was handed on as ${JSON.stringify(record)}`,
    }));

    await Effect.runPromise(deferredCanceller([deciding], ledger.service)(relayed, asked, lineage));

    expect(await reading()).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'cancelled',
          kind: 'requested',
          detail: `Stopped what was handed on as {"handed_on":"${relayedId}"}`,
        },
      },
    });
  });

  it('settles it as cancelled with the kind and reason asked when its capability has no hook of its own, or is not served', async () => {
    const served = await withHandOn();
    await served.running();
    const gone = await withHandOn();
    await gone.running();

    await Effect.runPromise(deferredCanceller([relay().capability], served.ledger.service)(relayed, asked, lineage));
    await Effect.runPromise(
      deferredCanceller([], gone.ledger.service)(relayed, { ...asked, kind: 'parent_ended' }, lineage),
    );

    expect([await served.reading(), await gone.reading()]).toMatchObject([
      { output: { rejection: { reason: 'cancelled', kind: 'requested', detail: asked.reason } } },
      { output: { rejection: { reason: 'cancelled', kind: 'parent_ended', detail: asked.reason } } },
    ]);
  });
});

describe('a cancel of a run of another capability, as asked', () => {
  it('settles it by the playbook itself when the request names no actor', async () => {
    const { running, ledger, run } = await withHandOn();
    await running();

    await Effect.runPromise(
      deferredCanceller([], ledger.service)(relayed, { kind: 'deadline', reason: 'Out of time' }, lineage),
    );
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded(
          { org: 'acme', playbook: 'alpha' },
          { kind: 'everything' },
          { order: 'asc', limit: 20 },
        ),
      ),
    );

    expect(records.at(-1)).toMatchObject({ type: 'run_rejected', context: { by: 'playbook:alpha' } });
  });
});

describe('a cancel its capability settles otherwise', () => {
  it('settles it as its capability decides, by the actor the decision names rather than whoever asked', async () => {
    const { running, ledger, run } = await withHandOn();
    await running();
    const answering = relayDeciding(({ answer, work }) => ({
      status: 'succeeded',
      output: { delivered: JSON.stringify({ answer, work }) },
      record: {},
      by: 'ada',
    }));

    await Effect.runPromise(deferredCanceller([answering], ledger.service)(relayed, asked, lineage));
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded(
          { org: 'acme', playbook: 'alpha' },
          { kind: 'everything' },
          { order: 'asc', limit: 20 },
        ),
      ),
    );

    expect(records.at(-1)).toMatchObject({
      type: 'run_succeeded',
      data: { output: { delivered: JSON.stringify({ answer: null, work: [] }) } },
      context: { by: 'ada' },
    });
  });
});

describe('a cancel of a run of another capability, as asked, when its hook breaks', () => {
  it('fails the run when its capability’s hook throws', async () => {
    const { running, ledger, reading } = await withHandOn();
    await running();
    const throwing = relayDeciding(() => {
      throw new Error('The hook broke');
    });

    await Effect.runPromise(deferredCanceller([throwing], ledger.service)(relayed, asked, lineage));

    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});

describe('a cancel of a run of another capability that is over', () => {
  it('does nothing for a run that has ended, and for one the playbook does not have', async () => {
    const { running, ledger, reading, settling } = await withHandOn();
    await running();
    await settling({ status: 'succeeded', output: 'handed on', record: {} });
    const cancel = deferredCanceller([relay().capability], ledger.service);

    await Effect.runPromise(cancel(relayed, asked, lineage));
    await Effect.runPromise(cancel({ ...relayed, id: '0199a3c4-7d2e-7c1a-9b3f-00000000ffff' }, asked, lineage));

    expect(await reading()).toMatchObject({ output: { status: 'succeeded' } });
  });

  it('takes a run that ended between the read and the settlement as done, and fails on any other conflict', async () => {
    const { running, ledger } = await withHandOn();
    await running();
    const changed = new Conflict({
      detail: 'The state changed while the command was decided',
      kind: 'concurrent_change',
    });
    const endedMeanwhile = {
      ...ledger.service,
      execute: () => Effect.fail(new Conflict({ detail: 'The run already ended with another result' })),
    };
    const changedMeanwhile = { ...ledger.service, execute: () => Effect.fail(changed) };

    await Effect.runPromise(deferredCanceller([], endedMeanwhile)(relayed, asked, lineage));

    expect(await Effect.runPromise(Effect.flip(deferredCanceller([], changedMeanwhile)(relayed, asked, lineage)))).toBe(
      changed,
    );
  });
});

const decidingFromWork = relayDeciding(({ work }) =>
  work.length === 0
    ? { status: 'rejected', reason: 'cancelled', kind: 'requested', detail: 'Nothing was nudged' }
    : { status: 'succeeded', output: { delivered: work.map(({ type }) => type).join(', ') } },
);

describe('a cancel whose run changes between its read and its settlement', () => {
  it('reads the run again and lets its capability decide from what the run holds now', async () => {
    const { running, ledger, reading } = await withHandOn();
    await running();
    const record = workRecorder(ledger.service, runFactsOf(declaredFactsOf([asking])));
    const nudged = Effect.all([
      record(relayed, { type: 'work', fact: { type: 'nudge_sent', data: { number: 1 } } }, lineage),
      record(relayed, { type: 'work', fact: { type: 'nudge_sent', data: { number: 2 } } }, lineage),
    ]);
    const turns = { next: (): Effect.Effect<unknown, unknown> => nudged };
    const changedOnce: StreamReader & StreamWriter = {
      ...ledger.service,
      execute: (stream, decider, command, given) => {
        const turn = Effect.orDie(turns.next());
        turns.next = () => Effect.void;
        return Effect.andThen(turn, ledger.service.execute(stream, decider, command, given));
      },
    };
    await Effect.runPromise(deferredCanceller([decidingFromWork], changedOnce)(relayed, asked, lineage));

    expect(await reading()).toMatchObject({
      output: { status: 'succeeded', output: { delivered: 'nudge_sent, nudge_sent' } },
    });
  });
});

describe('a cancel of a run whose start says it finishes later, before it recorded its deferral', () => {
  it('lets its capability decide from an empty record', async () => {
    const starting = Promise.withResolvers<void>();
    const pending = defineCapability({
      type: 'pending',
      title: 'Pending',
      guide: { name: 'pending' },
      noun: { one: 'pending run', other: 'pending runs' },
      describeOutput: () => 'It is pending.',
      mediaType: 'text/plain',
      parse: (source: string) => Effect.succeed(source),
      summarize: () => ({}),
      finishesLater: true,
      run: () => Effect.andThen(Effect.sync(starting.resolve), Effect.never),
      cancel: ({ record, kind }) => ({ status: 'rejected', reason: 'cancelled', kind, detail: JSON.stringify(record) }),
    });
    const operations = definitionOperationsFor([pending]);
    const definitions = harness();
    const toAlpha = toPlaybook('acme', 'alpha');
    await definitions.call(
      operations.createDefinition,
      toAlpha(acmeAdmin, { type: 'pending', name: 'slow', source: 'x' }),
    );
    void definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'pending', name: 'slow', run_id: relayedId }),
    );
    await starting.promise;

    await Effect.runPromise(deferredCanceller([pending], definitions.ledger.service)(relayed, asked, lineage));

    expect(await definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: relayedId }))).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled', detail: '{}' } },
    });
  });
});
