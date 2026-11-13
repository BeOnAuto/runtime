import { messageIdOf, type Lineage, type RecordedSelection } from '@on.auto/operations';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { definitionStreamsBehaviour } from '../definitions/definition-streams-behaviour.ts';
import type { LedgerStore, StoredPage, StoredPageRequest } from '../event-store.ts';
import { stamped } from '../testing/happenings.ts';
import { aStore, type LedgerEntry } from '../testing/ledger-entry.ts';
import type { RecordedKeys } from './recorded-keys.ts';

const alpha = 'playbook/acme/alpha/';

const triage = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/';

const summary = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/';

const elsewhere = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c/';

const ofAnotherOrg = 'definition/beta/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d/';

const ofTheThree: RecordedKeys = { org: 'acme', keys: [alpha, triage, summary] };

const ofTriage: RecordedKeys = { org: 'acme', keys: [triage] };

const unrelated: Lineage = { causationId: null, correlationId: null };

interface Appended {
  readonly stream: string;
  readonly type: string;
  readonly lineage?: Lineage;
}

async function appendedInTurn(store: LedgerStore, appended: readonly Appended[]): Promise<void> {
  const versions = new Map<string, number>();
  await appended.reduce(async (before: Promise<void>, { stream, type, lineage = unrelated }) => {
    await before;
    const expectedVersion = versions.get(stream) ?? 0;
    versions.set(stream, expectedVersion + 1);
    await store.append(stream, [{ type, data: { stream } }], { expectedVersion, context: stamped, lineage });
  }, Promise.resolve());
}

function streamsAndTypes({ records }: StoredPage): readonly string[] {
  return records.map(({ stream, type }) => `${stream} ${type}`);
}

function read(
  store: LedgerStore,
  keys: RecordedKeys,
  selection: RecordedSelection,
  page: StoredPageRequest,
): Promise<readonly string[]> {
  return store.readRecordedOfKeys(keys, selection, page).then(streamsAndTypes);
}

const interleaved: readonly Appended[] = [
  { stream: `${alpha}events/e1`, type: 'event_published' },
  { stream: `${triage}definitions/reasoning`, type: 'definition_created' },
  { stream: `${elsewhere}definitions/reasoning`, type: 'definition_created' },
  { stream: `${summary}definitions/workflow`, type: 'definition_created' },
  { stream: `${ofAnotherOrg}definitions/workflow`, type: 'definition_created' },
  { stream: `${triage}definitions/reasoning`, type: 'definition_updated' },
  { stream: `${alpha}events/e2`, type: 'event_published' },
];

function aKeyThatNamesADefinition(entry: LedgerEntry): void {
  describe('a key that names a definition', () => {
    it("reads that definition's streams alone, as a key that names a playbook reads the playbook's", async () => {
      const store = await aStore(entry);
      await appendedInTurn(store, interleaved);

      expect(
        streamsAndTypes(await store.readRecorded(triage, { kind: 'everything' }, { order: 'asc', limit: 10 })),
      ).toEqual(await read(store, ofTriage, { kind: 'everything' }, { order: 'asc', limit: 10 }));
      expect(await read(store, ofTriage, { kind: 'everything' }, { order: 'asc', limit: 10 })).toEqual([
        `${triage}definitions/reasoning definition_created`,
        `${triage}definitions/reasoning definition_updated`,
      ]);
      expect(
        await read(store, { org: 'acme', keys: [alpha] }, { kind: 'everything' }, { order: 'asc', limit: 10 }),
      ).toEqual([`${alpha}events/e1 event_published`, `${alpha}events/e2 event_published`]);
    });
  });
}

const everything: RecordedSelection = { kind: 'everything' };

async function twoPagesOf(store: LedgerStore): Promise<readonly (readonly string[])[]> {
  const first = await store.readRecordedOfKeys(ofTheThree, everything, { order: 'asc', limit: 2 });
  const after = Option.getOrThrow(Option.fromNullishOr(first.resumeAfter));
  const second = await store.readRecordedOfKeys(ofTheThree, everything, { order: 'asc', limit: 2, after });
  return [streamsAndTypes(first), streamsAndTypes(second)];
}

function sinceOf(store: LedgerStore, since: string): Promise<readonly string[]> {
  return read(store, { org: 'acme', keys: [summary, triage] }, everything, { order: 'asc', limit: 10, since });
}

function recordsOverSeveralKeys(entry: LedgerEntry): void {
  describe('a read over several keys', () => {
    it('merges the records of every key asked in the order they were appended, either way, and reads no other key', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store, interleaved);
      const inOrder = [
        `${alpha}events/e1 event_published`,
        `${triage}definitions/reasoning definition_created`,
        `${summary}definitions/workflow definition_created`,
        `${triage}definitions/reasoning definition_updated`,
        `${alpha}events/e2 event_published`,
      ];

      expect(await read(store, ofTheThree, everything, { order: 'asc', limit: 10 })).toEqual(inOrder);
      expect(await read(store, ofTheThree, everything, { order: 'desc', limit: 10 })).toEqual(inOrder.toReversed());
    });

    it('goes on from where a page ended, and keeps the types asked', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store, interleaved);

      const pages = await twoPagesOf(store);
      const created = await read(store, ofTheThree, everything, {
        order: 'desc',
        limit: 10,
        types: ['definition_created'],
      });

      expect(pages).toEqual([
        [`${alpha}events/e1 event_published`, `${triage}definitions/reasoning definition_created`],
        [`${summary}definitions/workflow definition_created`, `${triage}definitions/reasoning definition_updated`],
      ]);
      expect(created).toEqual([
        `${summary}definitions/workflow definition_created`,
        `${triage}definitions/reasoning definition_created`,
      ]);
    });
  });
}

function aPageFromATimeOverSeveralKeys(entry: LedgerEntry): void {
  describe('a page from a time over several keys', () => {
    it('starts at the first record of any key asked, and answers nothing after the last', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store, interleaved);

      const fromTheStart = await sinceOf(store, '2000-01-01T00:00:00.000Z');
      const fromTheFuture = await sinceOf(store, '2999-01-01T00:00:00.000Z');

      expect([fromTheStart, fromTheFuture]).toEqual([
        [
          `${triage}definitions/reasoning definition_created`,
          `${summary}definitions/workflow definition_created`,
          `${triage}definitions/reasoning definition_updated`,
        ],
        [],
      ]);
    });
  });
}

function runsOverSeveralKeys(entry: LedgerEntry): void {
  describe('the runs of several keys', () => {
    it('are listed by their first messages, each with its latest, newest first, from every key asked', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store, [
        { stream: `${triage}runs/r1`, type: 'run_started' },
        { stream: `${elsewhere}runs/r2`, type: 'run_started' },
        { stream: `${summary}runs/r3`, type: 'run_started' },
        { stream: `${triage}runs/r1`, type: 'run_succeeded' },
        { stream: `${alpha}runs/r4`, type: 'run_started' },
      ]);

      expect(await read(store, ofTheThree, { kind: 'runs' }, { order: 'desc', limit: 10 })).toEqual([
        `${alpha}runs/r4 run_started`,
        `${summary}runs/r3 run_started`,
        `${triage}runs/r1 run_started`,
        `${triage}runs/r1 run_succeeded`,
      ]);
      expect(await read(store, ofTheThree, { kind: 'runs' }, { order: 'asc', limit: 1 })).toEqual([
        `${triage}runs/r1 run_started`,
        `${triage}runs/r1 run_succeeded`,
      ]);
    });

    it('read the two streams of a run under whichever key holds it', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store, [
        { stream: `${summary}runs/r1`, type: 'run_started' },
        { stream: `${summary}run-logs/r1`, type: 'input_applied' },
        { stream: `${elsewhere}runs/r1`, type: 'run_started' },
        { stream: `${summary}runs/r1`, type: 'run_succeeded' },
      ]);

      expect(await read(store, ofTheThree, { kind: 'run', run: 'r1' }, { order: 'asc', limit: 10 })).toEqual([
        `${summary}runs/r1 run_started`,
        `${summary}run-logs/r1 input_applied`,
        `${summary}runs/r1 run_succeeded`,
      ]);
    });
  });
}

const root = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70';

function theTreeOfARunAcrossKeys(entry: LedgerEntry): void {
  describe('the tree of a run across keys', () => {
    it("reads what a run and the runs it caused recorded under the keys asked, through the org's index, and nothing of another key or org", async () => {
      const store = await aStore(entry);
      const ofRoot: Lineage = { causationId: null, correlationId: root };
      await appendedInTurn(store, [
        { stream: `${alpha}runs/${root}`, type: 'run_started', lineage: ofRoot },
        { stream: `${triage}runs/child`, type: 'run_started', lineage: ofRoot },
        { stream: `${elsewhere}runs/other`, type: 'run_started', lineage: ofRoot },
        { stream: `${ofAnotherOrg}runs/${root}`, type: 'run_started', lineage: ofRoot },
        { stream: `${triage}runs/unrelated`, type: 'run_started' },
        { stream: `${alpha}runs/${root}`, type: 'run_succeeded', lineage: ofRoot },
      ]);

      expect(
        await read(store, ofTheThree, { kind: 'correlated', correlation: root }, { order: 'asc', limit: 10 }),
      ).toEqual([
        `${alpha}runs/${root} run_started`,
        `${triage}runs/child run_started`,
        `${alpha}runs/${root} run_succeeded`,
      ]);
      expect(
        await read(
          store,
          { org: 'beta', keys: [alpha, triage] },
          { kind: 'correlated', correlation: root },
          { order: 'desc', limit: 10 },
        ),
      ).toEqual([]);
    });
  });
}

function oneEventAcrossKeys(entry: LedgerEntry): void {
  describe('one event by its id across keys', () => {
    it("is found under any key asked of its org, and under no other key or org, through the org's index", async () => {
      const store = await aStore(entry);
      await appendedInTurn(store, interleaved);
      const id = messageIdOf(`${triage}definitions/reasoning`, 2);

      const found = await store.readRecordedEventOfKeys(ofTheThree, id);

      expect(found).toMatchObject({ id, stream: `${triage}definitions/reasoning`, type: 'definition_updated' });
      expect(await store.readRecordedEventOfKeys({ org: 'acme', keys: [alpha, summary] }, id)).toBeUndefined();
      expect(await store.readRecordedEventOfKeys({ org: 'beta', keys: [triage] }, id)).toBeUndefined();
    });
  });
}

function theDefinitionStreamsUnderAKeyThatNamesADefinition(entry: LedgerEntry): void {
  describe('the definition streams of a type under keys that name definitions', () => {
    it('are found as those under a key that names a playbook are', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store, interleaved);

      expect(await store.definitionStreams('reasoning')).toEqual([
        { stream: `${triage}definitions/reasoning`, version: 2 },
        { stream: `${elsewhere}definitions/reasoning`, version: 1 },
      ]);
    });
  });
}

export function recordedKeysBehaviour(entry: LedgerEntry): void {
  definitionStreamsBehaviour(entry);
  theDefinitionStreamsUnderAKeyThatNamesADefinition(entry);
  aKeyThatNamesADefinition(entry);
  recordsOverSeveralKeys(entry);
  aPageFromATimeOverSeveralKeys(entry);
  runsOverSeveralKeys(entry);
  theTreeOfARunAcrossKeys(entry);
  oneEventAcrossKeys(entry);
}
