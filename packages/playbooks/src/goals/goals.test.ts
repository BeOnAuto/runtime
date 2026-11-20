import { Caller, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { beforeBuildingAfterAgreeOf, goalsSavedWordsOf, playbookOperationsOf } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { goalsInMemory, noGoalGap, refusedGoals } from '../testing/goals-in-memory.ts';
import { harness, toOrg } from '../testing/harness.ts';
import { createdWithGoals, restatedGoalsText } from '../testing/index.ts';
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
      settled(goals.save(alpha, { goals: { source, goals: [{ id: source }] }, onlyIfNone }));

    expect(await answered(goals.read(alpha))).toEqual({ goals: { gaps: [noGoalGap] } });
    const one = { versions: [{ id: 'one', version: 1 }] };
    expect(await saving('one', true)).toMatchObject({ success: { outcome: 'saved', goals: one } });
    expect(await saving('one')).toMatchObject({ success: { outcome: 'unchanged', goals: one } });
    expect(await saving('two', true)).toMatchObject({ success: { outcome: 'already_held', goals: { source: 'one' } } });
    const two = { source: 'two', goals: [{ id: 'one' }, { id: 'two' }] };
    const versions = [
      { id: 'one', version: 2 },
      { id: 'two', version: 1 },
    ];
    expect(await answered(goals.save(alpha, { goals: two }))).toEqual({
      outcome: 'saved',
      awaiting: true,
      goals: { source: 'two', versions, gaps: [] },
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

const toAcme = toOrg('acme');

const unsent = goalsSavedWordsOf(false).trim();

const Answered = Schema.Struct({ output: Schema.Struct({ before_building: Schema.optionalKey(Schema.String) }) });

async function answersWhere(messages: boolean) {
  const pages = pagesInMemory();
  const operations = playbookOperationsOf(pages, goalsInMemory(pages, messages));
  const named = (name: string) => {
    const found = operations.find(({ registration }) => registration.name === name);
    if (found === undefined) {
      throw new Error(`no ${name}`);
    }
    return found;
  };
  const { call } = harness();
  const updated = (input: object) => call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', ...input }));
  const created = await createdWithGoals({ call }, named('create_playbook'));
  const changed = await updated({ goals: restatedGoalsText });
  const same = await updated({ goals: restatedGoalsText });
  const renamed = await updated({ name: 'Beta' });
  const read = await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }));
  return [created, changed, same, renamed, read].map(
    (answer) => Schema.decodeUnknownSync(Answered)(answer).output.before_building,
  );
}

describe('before_building in the answers that save goals', () => {
  it('says to stop for the yes after a create and a change, and nothing after a save that changes nothing, a rename or a read', async () => {
    const [created, changed, ...rest] = await answersWhere(true);

    expect([typeof created, typeof changed, created === changed, rest]).toEqual([
      'string',
      'string',
      false,
      [undefined, undefined, undefined],
    ]);
  });

  it('adds, with messages off, that Auto sends no goal messages, after every save of goals', async () => {
    const told = await answersWhere(true);

    expect(await answersWhere(false)).toEqual([
      `${String(told[0])} ${unsent}`,
      `${String(told[1])} ${unsent}`,
      unsent,
      undefined,
      undefined,
    ]);
  });

  it('says, after a yes, only with messages off that Auto sends no goal messages', () => {
    expect([beforeBuildingAfterAgreeOf(false), beforeBuildingAfterAgreeOf(true)]).toEqual([unsent, undefined]);
  });

  it('is described in the output schemas of create_playbook and update_playbook', () => {
    const pages = pagesInMemory();
    const described = playbookOperationsOf(pages, goalsInMemory(pages))
      .filter(({ registration }) => JSON.stringify(registration.output).includes('"before_building"'))
      .map(({ registration }) => registration.name);

    expect(described).toEqual(['create_playbook', 'get_playbook', 'update_playbook']);
  });
});
