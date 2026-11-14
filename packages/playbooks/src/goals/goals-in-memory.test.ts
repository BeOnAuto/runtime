import { Caller, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { goalsInMemory, noGoalGap, refusedGoals } from '../testing/goals-in-memory.ts';
import { pagesInMemory, refusedPage } from '../testing/playbook-pages.ts';

const alpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

function settled<A, E>(effect: Effect.Effect<A, E, Caller>) {
  return Effect.runPromise(Effect.result(effect.pipe(Effect.provideService(Caller, acmeAdmin))));
}

function answered<A, E>(effect: Effect.Effect<A, E, Caller>) {
  return Effect.runPromise(effect.pipe(Effect.provideService(Caller, acmeAdmin), Effect.orDie));
}

describe('goals kept in memory', () => {
  it('check goals by their text, refusing the one text it is told to refuse', async () => {
    const goals = goalsInMemory();

    expect(await settled(goals.check('- id: alpha\n', { name: 'Alpha' }))).toMatchObject({
      success: { source: '- id: alpha\n' },
    });
    expect(await settled(goals.check(refusedGoals, { name: 'Alpha' }))).toMatchObject({
      failure: { _tag: 'invalid_input', issues: [{ pointer: '/goals' }] },
    });
  });

  it('save a version at each change, nothing when the text is the same, and nothing over goals held when asked for none', async () => {
    const goals = goalsInMemory();
    const saving = (source: string, onlyIfNone = false) =>
      settled(goals.save(alpha, { goals: { source, goals: [] }, onlyIfNone }));

    expect(await answered(goals.read(alpha))).toEqual({ goals: { gaps: [noGoalGap] } });
    expect(await saving('one', true)).toMatchObject({ success: { outcome: 'saved', goals: { version: 1 } } });
    expect(await saving('one')).toMatchObject({ success: { outcome: 'unchanged', goals: { version: 1 } } });
    expect(await saving('two', true)).toMatchObject({ success: { outcome: 'already_held', goals: { source: 'one' } } });
    expect(await answered(goals.save(alpha, { goals: { source: 'two', goals: [] } }))).toEqual({
      outcome: 'saved',
      awaiting: true,
      goals: { source: 'two', version: 2, gaps: [] },
    });
  });

  it('save the page beside the goals, and answer no outcome when no goals were given', async () => {
    const pages = pagesInMemory();
    const goals = goalsInMemory(pages);

    expect(await answered(goals.save(alpha, { page: '---\n---\n' }))).toEqual({
      page: { source: '---\n---\n' },
      goals: { gaps: [noGoalGap] },
    });
    expect(await settled(goals.save(alpha, { page: refusedPage }))).toMatchObject({
      failure: { _tag: 'invalid_input' },
    });
    expect(await answered(pages.pageOf(alpha))).toEqual({ source: '---\n---\n' });
  });
});
