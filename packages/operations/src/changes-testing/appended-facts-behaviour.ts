import { Clock, Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import type { LedgerPorts } from '../ledger/ledger.ts';
import { topicFacts, type TopicFact } from '../projections/topic-rows.ts';
import { cursorOfParts, partsOfCursor } from '../reading/cursor-parts.ts';
import type { AppendedFacts, AppendedFactsRequest, AppendedScope } from '../reading/recorded-read.ts';

export interface AppendedFactsEntry {
  readonly aLedger: () => Promise<LedgerPorts>;
}

const alpha: AppendedScope = { kind: 'playbook', playbook: { org: 'acme', playbook: 'alpha' } };

const beta: AppendedScope = { kind: 'playbook', playbook: { org: 'acme', playbook: 'beta' } };

const registries: AppendedScope = { kind: 'streams', streams: ['org/acme/playbooks', 'org/acme/connections'] };

const heads: AppendedFactsRequest = { most: 100, dataOf: [] };

const unheldId = '00000000-0000-5000-8000-000000000000';

function opened(topic: string): TopicFact {
  return { type: 'topic_opened', data: { topic, at: 0 } };
}

function noted(topic: string, note: string): TopicFact {
  return { type: 'topic_noted', data: { topic, note } };
}

function appended(ledger: LedgerPorts, stream: string, ...facts: readonly TopicFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, topicFacts, facts));
}

function read(ledger: LedgerPorts, scope: AppendedScope, request: AppendedFactsRequest): Promise<AppendedFacts> {
  return Effect.runPromise(ledger.readAppendedFacts(scope, request));
}

function refused(ledger: LedgerPorts, scope: AppendedScope, after: string): Promise<boolean> {
  return Effect.runPromise(Effect.isFailure(ledger.readAppendedFacts(scope, { ...heads, after })));
}

function shapeOf({ facts }: AppendedFacts) {
  return facts.map(({ stream, type, data }) => ({ stream, type, data }));
}

function typesOf({ facts }: AppendedFacts): readonly string[] {
  return facts.map(({ type }) => type);
}

function withAnotherId(cursor: string): string {
  return cursorOfParts([...Option.getOrThrow(partsOfCursor(cursor)).slice(0, -1), unheldId]);
}

interface Waited {
  readonly ms: number;
  readonly waited: string;
}

async function waitedFor(ledger: LedgerPorts, scope: AppendedScope, after: string, ms: number): Promise<Waited> {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + ms;
  const started = performance.now();
  const waited = await Effect.runPromise(ledger.waitForAppend(scope, after, deadline));
  return { ms: performance.now() - started, waited };
}

function readAfterACursor(entry: AppendedFactsEntry): void {
  it('answers no facts without a cursor, and from its cursor the facts of the scope appended after it, in order, of the scope alone', async () => {
    const ledger = await entry.aLedger();
    await appended(ledger, 'playbook/acme/alpha/topics/first', opened('first'));

    const now = await read(ledger, alpha, heads);
    await appended(ledger, 'playbook/acme/beta/topics/other', opened('other'));
    await appended(ledger, 'playbook/acme/alpha/topics/second', opened('second'), noted('second', 'one'));
    await appended(ledger, 'playbook/acme/alpha/topics/first', noted('first', 'two'));
    const after = await read(ledger, alpha, { ...heads, after: now.cursor });
    const again = await read(ledger, alpha, { ...heads, after: after.cursor });

    expect([now.facts, now.more]).toEqual([[], false]);
    expect(shapeOf(after)).toEqual([
      { stream: 'playbook/acme/alpha/topics/second', type: 'topic_opened', data: undefined },
      { stream: 'playbook/acme/alpha/topics/second', type: 'topic_noted', data: undefined },
      { stream: 'playbook/acme/alpha/topics/first', type: 'topic_noted', data: undefined },
    ]);
    expect(after.facts.map(({ context }) => context.by)).toEqual(['topics', 'topics', 'topics']);
    expect(new Set(after.facts.map(({ id }) => id)).size).toBe(3);
    expect(after.cursor).toBe(after.facts.at(-1)?.cursor);
    expect([again.facts, again.cursor, again.more]).toEqual([[], after.cursor, false]);
  });
}

function readFromTheStart(entry: AppendedFactsEntry): void {
  it('reads from the start of a scope that held nothing, with the data of the types asked for alone', async () => {
    const ledger = await entry.aLedger();

    const empty = await read(ledger, alpha, heads);
    await appended(ledger, 'playbook/acme/alpha/topics/first', opened('first'), noted('first', 'kept'));
    const after = await read(ledger, alpha, { after: empty.cursor, most: 100, dataOf: ['topic_noted'] });

    expect(empty.cursor).toBe(cursorOfParts([]));
    expect(shapeOf(after)).toEqual([
      { stream: 'playbook/acme/alpha/topics/first', type: 'topic_opened', data: undefined },
      { stream: 'playbook/acme/alpha/topics/first', type: 'topic_noted', data: { topic: 'first', note: 'kept' } },
    ]);
  });
}

function readAtMost(entry: AppendedFactsEntry): void {
  it('reads at most as many facts as it is asked, says more follow, and goes on from the last it read', async () => {
    const ledger = await entry.aLedger();
    const start = await read(ledger, alpha, heads);
    await appended(
      ledger,
      'playbook/acme/alpha/topics/first',
      opened('first'),
      noted('first', 'a'),
      noted('first', 'b'),
    );

    const first = await read(ledger, alpha, { ...heads, after: start.cursor, most: 2 });
    const next = await read(ledger, alpha, { ...heads, after: first.cursor, most: 2 });

    expect([typesOf(first), first.more]).toEqual([['topic_opened', 'topic_noted'], true]);
    expect(first.cursor).toBe(first.facts.at(-1)?.cursor);
    expect([typesOf(next), next.more]).toEqual([['topic_noted'], false]);
  });
}

function readNamedStreams(entry: AppendedFactsEntry): void {
  it('reads the streams it names alone, in the order they were appended to across them', async () => {
    const ledger = await entry.aLedger();
    const start = await read(ledger, registries, heads);
    await appended(ledger, 'org/acme/playbooks', opened('made'));
    await appended(ledger, 'org/acme/keys', opened('issued'));
    await appended(ledger, 'org/acme/connections', opened('added'));
    await appended(ledger, 'org/beta/playbooks', opened('elsewhere'));
    await appended(ledger, 'org/acme/playbooks', noted('made', 'renamed'));

    const after = await read(ledger, registries, { after: start.cursor, most: 100, dataOf: ['topic_opened'] });

    expect(shapeOf(after)).toEqual([
      { stream: 'org/acme/playbooks', type: 'topic_opened', data: { topic: 'made', at: 0 } },
      { stream: 'org/acme/connections', type: 'topic_opened', data: { topic: 'added', at: 0 } },
      { stream: 'org/acme/playbooks', type: 'topic_noted', data: undefined },
    ]);
  });
}

function refusedCursors(entry: AppendedFactsEntry): void {
  it('refuses a cursor it does not hold: malformed, of another scope, or naming a fact it does not hold', async () => {
    const ledger = await entry.aLedger();
    await appended(ledger, 'playbook/acme/beta/topics/other', opened('other'));
    await appended(ledger, 'playbook/acme/alpha/topics/first', opened('first'));
    const ofBeta = await read(ledger, beta, heads);
    const ofAlpha = await read(ledger, alpha, heads);

    expect(
      await Promise.all([
        refused(ledger, alpha, 'not a cursor'),
        refused(ledger, alpha, cursorOfParts(['1', '2', '3', '4'])),
        refused(ledger, alpha, ofBeta.cursor),
        refused(ledger, alpha, withAnotherId(ofAlpha.cursor)),
        refused(ledger, alpha, ofAlpha.cursor),
      ]),
    ).toEqual([true, true, true, true, false]);
  });
}

function waitsForTheNext(entry: AppendedFactsEntry): void {
  it('waits for the next append to its scope, and answers at once for one made after the point it was given', async () => {
    const ledger = await entry.aLedger();
    const now = await read(ledger, alpha, heads);
    await appended(ledger, 'playbook/acme/alpha/topics/early', opened('early'));

    const atOnce = await waitedFor(ledger, alpha, now.through, 10_000);
    const caughtUp = await read(ledger, alpha, { ...heads, after: now.cursor });
    const held = waitedFor(ledger, alpha, caughtUp.through, 10_000);
    await Effect.runPromise(Effect.sleep(50));
    await appended(ledger, 'playbook/acme/alpha/topics/late', opened('late'));
    const late = await held;

    expect([atOnce.waited, late.waited]).toEqual(['appended', 'appended']);
    expect(Math.max(atOnce.ms, late.ms)).toBeLessThan(5000);
  });
}

function waitsUntilTheDeadline(entry: AppendedFactsEntry): void {
  it('is not woken by an append to another scope, and ends at its deadline', async () => {
    const ledger = await entry.aLedger();
    const now = await read(ledger, alpha, heads);

    const held = waitedFor(ledger, alpha, now.through, 400);
    await appended(ledger, 'playbook/acme/beta/topics/other', opened('other'));
    const after = await read(ledger, alpha, { ...heads, after: now.cursor });
    const ended = await held;

    expect([ended.waited, ended.ms >= 390]).toEqual(['ended', true]);
    expect(after.facts).toEqual([]);
  });

  it('ends at once at a deadline that has passed, and holds many waits at once', async () => {
    const ledger = await entry.aLedger();
    const now = await read(ledger, registries, heads);

    const passed = await waitedFor(ledger, registries, now.through, -1);
    const many = Promise.all(Array.from({ length: 50 }, () => waitedFor(ledger, registries, now.through, 10_000)));
    await Effect.runPromise(Effect.sleep(50));
    await appended(ledger, 'org/acme/connections', opened('added'));
    const woken = await many;

    expect([passed.waited, passed.ms < 1000]).toEqual(['ended', true]);
    expect(new Set(woken.map(({ waited }) => waited))).toEqual(new Set(['appended']));
    expect(Math.max(...woken.map(({ ms }) => ms))).toBeLessThan(5000);
  });
}

export function appendedFactsBehaviour(entry: AppendedFactsEntry): void {
  describe('a read of the facts appended to a scope', () => {
    readAfterACursor(entry);
    readFromTheStart(entry);
    readAtMost(entry);
    readNamedStreams(entry);
    refusedCursors(entry);
  });

  describe('a wait for an append to a scope', () => {
    waitsForTheNext(entry);
    waitsUntilTheDeadline(entry);
  });
}
