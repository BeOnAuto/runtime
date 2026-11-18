import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { approvalDocument, interactionHarness } from '../testing/index.ts';
import { listInteractionsAbout } from './list-interactions.ts';
import type { DismissedShown, RequestSetAside, RequestThings } from './requests-set-aside.ts';

const runs = ['1', '2', '3', '4', '5'].map((last) => `0199a3c4-7d2e-7c1a-9b3f-00000000000${last}`);

const [first = '', second = '', third = '', fourth = '', fifth = ''] = runs;

const dismissal: RequestSetAside = {
  goal: 'revisions',
  id: 'a1',
  at: '2026-11-17T09:00:00.000Z',
  by: 'person:katy',
};

const PageSchema = Schema.Struct({
  output: Schema.Struct({
    interactions: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

const decodePage = Schema.decodeUnknownSync(PageSchema);

async function fiveRequests() {
  const playbook = interactionHarness();
  await playbook.define('ask-the-producer', approvalDocument());
  await runs.reduce(
    (before: Promise<unknown>, run, index) =>
      before.then(() => playbook.ask('ask-the-producer', { campaign: `Campaign ${String(index)}`, owner: 'ada' }, run)),
    Promise.resolve(),
  );
  return playbook;
}

function goalsSettingAside(setAside: readonly string[]) {
  const asked: DismissedShown[] = [];
  const about: RequestThings = (chains, shown) =>
    Effect.sync(() => {
      asked.push(shown);
      return chains.map(() => []);
    });
  const listing = listInteractionsAbout({
    about,
    setAside: () => Effect.succeed(new Map(setAside.map((run) => [run, dismissal]))),
  });
  return { asked, listing };
}

describe('the requests a dismissal set aside', () => {
  it('are left out of the list, whose pages stay full and read on past them', async () => {
    const playbook = await fiveRequests();
    const { asked, listing } = goalsSettingAside([fourth, third, second]);

    const page = decodePage(await playbook.call(listing, { limit: 1 })).output;
    const next = decodePage(await playbook.call(listing, { limit: 1, cursor: page.next_cursor })).output;

    expect([page.interactions.map(({ run_id: run }) => run), page.has_more]).toEqual([[fifth], true]);
    expect([next.interactions.map(({ run_id: run }) => run), next.has_more]).toEqual([[first], false]);
    expect(asked).toEqual([{}, {}]);
  });

  it('are listed with the dismissed thing that set them aside when the list asks to include them', async () => {
    const playbook = await fiveRequests();
    const { asked, listing } = goalsSettingAside([fourth]);

    const { interactions } = decodePage(await playbook.call(listing, { dismissed: 'include' })).output;

    expect(interactions.map(({ run_id: run, dismissed }) => [run, dismissed])).toEqual([
      [fifth, undefined],
      [fourth, dismissal],
      [third, undefined],
      [second, undefined],
      [first, undefined],
    ]);
    expect(asked).toEqual([{ dismissed: 'include' }]);
  });
});
