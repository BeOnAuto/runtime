import type { Lineage } from '@on.auto/operations';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import type { LedgerStore, StoredPage } from '../event-store.ts';
import { stamped } from '../testing/happenings.ts';
import { aStore, type LedgerEntry } from '../testing/ledger-entry.ts';

const alpha = 'playbook/acme/alpha/';

const beta = 'playbook/acme/beta/';

const triage = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/';

const summary = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/';

const unrelated: Lineage = { causationId: null, correlationId: null };

const writtenInTurn: readonly string[] = [
  `${alpha}events/e1`,
  `${triage}runs/r1`,
  'definition/globex/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c/runs/r2',
  `${beta}events/e2`,
  'playbook/globex/alpha/events/e3',
  `${summary}definitions/reasoning`,
  'org/acme/conversations/c1',
  `${triage}run-logs/r1`,
];

const ofTheOrg = writtenInTurn.filter((stream) => stream.split('/')[1] === 'acme');

async function appendedInTurn(store: LedgerStore): Promise<void> {
  await writtenInTurn.reduce(async (before: Promise<void>, stream) => {
    await before;
    await store.append(stream, [{ type: 'noted', data: { stream } }], {
      expectedVersion: 0,
      context: stamped,
      lineage: unrelated,
    });
  }, Promise.resolve());
}

function streamsOf({ records }: StoredPage): readonly string[] {
  return records.map(({ stream }) => stream);
}

async function pagesOfTwo(
  store: LedgerStore,
  after?: StoredPage['resumeAfter'],
): Promise<readonly (readonly string[])[]> {
  const page = await store.readRecordedOfOrg('acme', {
    order: 'asc',
    limit: 2,
    ...(after === undefined ? {} : { after }),
  });
  const rest = page.resumeAfter === undefined ? [] : await pagesOfTwo(store, page.resumeAfter);
  return [streamsOf(page), ...rest];
}

export function orgRecordsBehaviour(entry: LedgerEntry): void {
  describe("a read of an org's records", () => {
    it("reads every stream of the org, a playbook's and a definition's and the org's own, in the store's order, and none of another org", async () => {
      const store = await aStore(entry);
      await appendedInTurn(store);

      const read = await store.readRecordedOfOrg('acme', { order: 'asc', limit: 100 });

      expect(streamsOf(read)).toEqual(ofTheOrg);
      expect(read.resumeAfter).toBeUndefined();
    });

    it('pages after a place, neither repeating a record nor passing one over', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store);

      const pages = await pagesOfTwo(store);

      expect(pages.flat()).toEqual(ofTheOrg);
      expect(pages.map((page) => page.length)).toEqual([2, 2, 2]);
    });

    it('reads no record after the point it is read through', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store);
      const { records } = await store.readRecordedOfOrg('acme', { order: 'asc', limit: 100 });
      const third = Option.getOrThrow(Option.fromNullishOr(records[2]));

      const through = await store.readRecordedOfOrg('acme', { order: 'asc', limit: 100, to: third.point });

      expect(streamsOf(through)).toEqual(ofTheOrg.slice(0, 3));
      expect(through.resumeAfter).toBeUndefined();
    });

    it('reads the data of the types it is asked for alone', async () => {
      const store = await aStore(entry);
      await appendedInTurn(store);

      const { records } = await store.readRecordedOfOrg('acme', { order: 'desc', limit: 1, dataOf: [] });
      const [newest] = records;

      expect(Option.fromNullishOr(newest).pipe(Option.map(({ stream, data }) => [stream, data]))).toEqual(
        Option.some([`${triage}run-logs/r1`, undefined]),
      );
    });
  });
}
