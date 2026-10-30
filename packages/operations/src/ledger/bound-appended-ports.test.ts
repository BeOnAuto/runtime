import { Clock, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { topicFacts } from '../projections/topic-rows.ts';
import { cursorOfParts } from '../reading/cursor-parts.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { orgBoundAppendedFactsReader, playbookBoundAppendedFactsReader } from './bound-ports.ts';

const heads = { most: 10, dataOf: [] };

function opened(topic: string) {
  return [{ type: 'topic_opened' as const, data: { topic, at: 0 } }];
}

const fromTheStart = cursorOfParts([]);

function dies(effect: Effect.Effect<unknown, unknown>): Promise<boolean> {
  return Effect.runPromise(Effect.exit(effect).pipe(Effect.map(Exit.hasDies)));
}

async function ledgerHolding(...streams: readonly string[]) {
  const { service } = memoryLedger();
  await Effect.runPromise(
    Effect.forEach(streams, (stream) => service.execute(stream, topicFacts, opened(stream)), { discard: true }),
  );
  return service;
}

describe('the facts appended to a playbook, as its operations read them', () => {
  it('name their streams within the playbook, and hold what the playbook alone recorded', async () => {
    const ledger = await ledgerHolding('playbook/acme/alpha/topics/a', 'playbook/acme/beta/topics/b');
    const reader = playbookBoundAppendedFactsReader(ledger, { org: 'acme', playbook: 'alpha' });

    const read = await Effect.runPromise(reader.readAppendedFacts({ ...heads, after: fromTheStart }));
    const now = await Effect.runPromise(Clock.currentTimeMillis);
    await Effect.runPromise(reader.waitForAppend(read.through, now));

    expect(read.facts.map(({ stream }) => stream)).toEqual(['topics/a']);
  });

  it('are read 1 to 1,000 at a time', async () => {
    const reader = playbookBoundAppendedFactsReader(await ledgerHolding(), { org: 'acme', playbook: 'alpha' });

    const died = await Promise.all([0, 1001, 1.5].map((most) => dies(reader.readAppendedFacts({ most, dataOf: [] }))));

    expect(died).toEqual([true, true, true]);
  });
});

describe('the facts appended to the streams of an org, as its operations read them', () => {
  it('name the streams of the org alone, within the org', async () => {
    const ledger = await ledgerHolding('org/acme/playbooks', 'org/beta/playbooks', 'org/acme/keys');
    const reader = orgBoundAppendedFactsReader(ledger, { org: 'acme' });

    const read = await Effect.runPromise(reader.readAppendedFacts(['playbooks'], { ...heads, after: fromTheStart }));
    const now = await Effect.runPromise(Clock.currentTimeMillis);
    await Effect.runPromise(reader.waitForAppend(['playbooks'], read.through, now));

    expect(read.facts.map(({ stream }) => stream)).toEqual(['playbooks']);
  });

  it('take only streams of well-formed names', async () => {
    const reader = orgBoundAppendedFactsReader(await ledgerHolding(), { org: 'acme' });

    const died = await Promise.all([
      dies(reader.readAppendedFacts(['../beta/playbooks'], heads)),
      dies(reader.waitForAppend(['a//b'], fromTheStart, 0)),
    ]);

    expect(died).toEqual([true, true]);
  });
});
