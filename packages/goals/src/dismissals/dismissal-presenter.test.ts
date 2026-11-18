import { mostNameBytes } from '@on.auto/definitions';
import {
  mostPublicEventDataBytes,
  presentationOf,
  presentedChangeCatalogOf,
  type RecordedEvent,
} from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { mostRequestsSetAside } from '../assessments/dismissing.ts';
import { assessmentRows } from '../goal-tables/assessment-rows.ts';
import { goalChangeNamings } from '../reads/goal-changes.ts';
import { goalPresenters } from './dismissal-presenter.ts';

const thing = '3dd23e5e-aaf8-576a-bdbb-6f35d728ebc8';

const robin = { id: 'person:user_robin', name: 'Robin Park' };

const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' } as const;

const { present, publicTypes, storedTypesOf } = presentationOf(goalPresenters(true));

function recordOf(type: string, data: object): RecordedEvent {
  return {
    id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9d',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream: `assessments/${thing}`,
    version: 4,
    globalPosition: 9,
    type,
    data,
    context: { at: '2026-11-09T11:00:00.000Z', by: robin.id },
    recordedAt: '2026-11-09T11:00:00.000Z',
  };
}

const utf8 = new TextEncoder();

const inWords: unknown = expect.stringMatching(/\S/u);

const ofTheGoal = { goal: 'paying-customers', per: 'experiment-7' };

const dismissed = { ...ofTheGoal, at: '2026-11-09T11:00:00.000Z', by: robin, requests: ['ask-1', 'ask-2'] };

describe('the events of the things of a goal', () => {
  it('are a dismissal and a restoring, each with the goal, the thing, who and, for a dismissal, the requests it set aside', () => {
    expect(publicTypes).toEqual(['thing.dismissed', 'thing.restored']);
    expect(storedTypesOf('thing.dismissed')).toEqual(['goal_dismissed']);
    expect(present(recordOf('goal_dismissed', dismissed), showing)).toEqual([
      expect.objectContaining({
        type: 'thing.dismissed',
        summary: inWords,
        data: { goal: 'paying-customers', id: thing, per: 'experiment-7', by: robin, requests: ['ask-1', 'ask-2'] },
      }),
    ]);
    expect(
      present(recordOf('goal_restored', { goal: 'paying-customers', at: dismissed.at, by: robin }), showing),
    ).toEqual([
      expect.objectContaining({ type: 'thing.restored', data: { goal: 'paying-customers', id: thing, by: robin } }),
    ]);
  });

  it('show no other fact of a thing, carry who dismissed it cut to two hundred bytes, and no per where it has none', () => {
    const wide = { ...robin, id: `person:${'é'.repeat(300)}` };
    const { per: _, ...ofACalendarDay } = dismissed;

    const [shown] = present(recordOf('goal_dismissed', { ...ofACalendarDay, by: wide }), showing);

    expect(present(recordOf('goal_stopped', { at: dismissed.at, run: 'run-1' }), showing)).toEqual([]);
    expect(shown?.data['by']).toEqual({ ...robin, id: `person:${'é'.repeat(96)}` });
    expect(shown?.data['per']).toBeUndefined();
  });
});

describe('the data of a dismissal event', () => {
  it('fits in the data of a public event at its widest', () => {
    const widest = {
      goal: `g${'-'.repeat(47)}`,
      per: '\u0001'.repeat(200),
      at: dismissed.at,
      by: { id: `person:${'é'.repeat(300)}`, name: '\u0001'.repeat(mostNameBytes * 2) },
      requests: Array.from({ length: mostRequestsSetAside }, () => thing),
    };

    const [shown] = present(recordOf('goal_dismissed', widest), showing);

    expect(utf8.encode(JSON.stringify(shown?.data)).byteLength).toBeLessThanOrEqual(mostPublicEventDataBytes);
  });
});

describe('the changes the facts of a thing raise', () => {
  it('raise a goal change, as every fact of a thing does, where goals are kept, and are served only there', () => {
    const catalog = presentedChangeCatalogOf(goalPresenters(true), goalChangeNamings(true));
    const fact = { id: 'fact-1', stream: `assessments/${thing}`, context: { at: dismissed.at, by: robin.id } };

    expect(assessmentRows.types.map((type) => catalog.changesOf({ ...fact, type }))).toEqual(
      assessmentRows.types.map(() => [{ kind: 'goal' }]),
    );
    expect(goalPresenters(false)).toEqual([]);
  });
});
