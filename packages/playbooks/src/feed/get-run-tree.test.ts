import { makeDispatcher, mostRecordsInAPage, type Lineage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { defineGetRunTree, runTreeBounds } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { playbookFeed, presenterOf, textsIn, textsOf, toAlpha } from '../testing/playbook-feed.ts';

const root = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const ofRoot: Lineage = { causationId: null, correlationId: root };

const notes = presenterOf('notes', { added: 'note_added', kept: 'note_kept' });

const getRunTree = defineGetRunTree([notes], { eventsInAPage: 2, pagesAtMost: 2 });

async function aTreeOf(texts: readonly string[]) {
  const feed = playbookFeed();
  await feed.recording('notes', 'added', 'another run');
  await texts.reduce(async (before, text) => {
    await before;
    await feed.recordingWith('notes', { type: 'added', data: { text } }, ofRoot);
  }, Promise.resolve());
  const reading = (input: object = {}) =>
    feed.run(
      makeDispatcher([]).dispatchToPlaybook(getRunTree.registration, toAlpha(acmeAdmin, { run_id: root, ...input })),
    );
  return { ...feed, reading };
}

describe('get_run_tree', () => {
  it('is a playbook query served over HTTP alone at GET /runs/{run_id}/tree', () => {
    expect(getRunTree.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'get_run_tree',
      route: { method: 'GET', path: '/runs/{run_id}/tree' },
      servedOverHttpAlone: { kind: 'none' },
    });
  });

  it('reads a page of a hundred records at a time, ten pages at most, as it ships', () => {
    expect(runTreeBounds).toEqual({ eventsInAPage: mostRecordsInAPage, pagesAtMost: 10 });
  });
});

describe('the tree of a run, read in one answer', () => {
  it('holds every event of the run and the runs it started, oldest first, across as many pages as it reads', async () => {
    const { reading } = await aTreeOf(['a', 'b', 'c', 'd']);

    expect(textsOf(await reading()).output).toEqual({
      events: [{ data: { text: 'a' } }, { data: { text: 'b' } }, { data: { text: 'c' } }, { data: { text: 'd' } }],
      has_more: false,
      next_cursor: null,
    });
  });

  it('stops after the most pages it reads, with a cursor that reads on from there', async () => {
    const { reading } = await aTreeOf(['a', 'b', 'c', 'd', 'e']);
    const first = textsOf(await reading());

    expect([first.output.has_more, textsIn(await reading())]).toEqual([true, ['a', 'b', 'c', 'd']]);
    expect(textsOf(await reading({ cursor: first.output.next_cursor })).output).toEqual({
      events: [{ data: { text: 'e' } }],
      has_more: false,
      next_cursor: null,
    });
  });

  it('is empty for a run that recorded nothing', async () => {
    const { reading } = await aTreeOf([]);

    expect(textsIn(await reading())).toEqual([]);
  });

  it('is refused for an id that is not a UUID', async () => {
    const { reading } = await aTreeOf([]);

    expect(await reading({ run_id: 'not-a-run' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/run_id' }],
    });
  });
});
