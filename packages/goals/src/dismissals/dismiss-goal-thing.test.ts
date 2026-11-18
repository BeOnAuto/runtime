import {
  allPermissions,
  makeDispatcher,
  PlaybookReader,
  type CallerIdentity,
  type PlaybookRequest,
} from '@on.auto/operations';
import { memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentAfter, unopened } from '../assessments/assessment-state.ts';
import { mostRequestsSetAside } from '../assessments/dismissing.ts';
import { AssessmentEventSchema } from '../goal-facts/goal-facts.ts';
import {
  assessmentBookOf,
  controlsGoal,
  day,
  experimentsGoal,
  firstDay,
  thingAt,
  type AssessmentBook,
} from '../reads/assessment-samples.ts';
import { goalAssessmentsIn } from '../reads/goal-assessments.ts';
import { dismissGoalThingAsking, type AskedAbout, type ThingOfAGoal } from './dismiss-goal-thing.ts';

const katy: CallerIdentity = {
  id: 'person:user_katy',
  name: 'Katy',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

const sales = { org: 'acme', playbook: 'sales' };

const live = firstDay + day;

const goal = experimentsGoal.id;

const waiting = Array.from({ length: mostRequestsSetAside + 2 }, (_, index) => `ask-${String(index)}`);

const inWords: unknown = expect.stringMatching(/\S/u);

function askedOf(requests: readonly string[]) {
  const asked: ThingOfAGoal[] = [];
  const askedAbout: AskedAbout = (thing) =>
    Effect.sync(() => {
      asked.push(thing);
      return requests;
    });
  return { asked, askedAbout };
}

function dismissing(book: AssessmentBook, askedAbout?: AskedAbout) {
  const { registration } = dismissGoalThingAsking(askedAbout);
  const services = Layer.mergeAll(book.ledger, memoryPlaybookRegistry([sales]), recordingReporter().layer);
  return (input: PlaybookRequest['input']) =>
    Effect.runPromise(
      makeDispatcher([])
        .dispatchToPlaybook(registration, { caller: katy, ...sales, input, encoding: 'json' })
        .pipe(Effect.provide(services)),
    );
}

async function aThing(book: AssessmentBook): Promise<string> {
  await book.goalsSaved([experimentsGoal, controlsGoal]);
  return thingAt(book, { per: 'MAR-1', at: firstDay, marked: ['chosen', 'prepared', 'live'], live });
}

function factsOn(book: AssessmentBook, id: string): Promise<number> {
  const fold = { initialState: unopened, evolve: assessmentAfter, eventSchema: AssessmentEventSchema };
  return book.inThePlaybook(
    Effect.map(
      PlaybookReader.use((reader) => reader.load(`assessments/${id}`, fold)),
      ({ version }) => version,
    ),
  );
}

function openRead(book: AssessmentBook) {
  return book.inThePlaybook(goalAssessmentsIn(experimentsGoal, undefined, 1, {}));
}

describe('dismiss_goal_thing', () => {
  it('is a playbook command at PUT /goals/{goal}/things/{id}/dismissed that may be sent again', () => {
    expect(dismissGoalThingAsking().registration).toMatchObject({
      name: 'dismiss_goal_thing',
      scope: 'playbook',
      kind: 'command',
      route: { method: 'PUT', path: '/goals/{goal}/things/{id}/dismissed' },
      repeatable: true,
      reasons: ['not_found', 'invalid_input', 'conflict'],
    });
  });

  it('dismisses the thing for everyone, sets aside the first ten questions waiting on it, and notices both', async () => {
    const book = assessmentBookOf();
    const id = await aThing(book);
    const { asked, askedAbout } = askedOf(waiting);

    const answer = await dismissing(book, askedAbout)({ goal, id });

    expect(answer).toMatchObject({
      status: 'succeeded',
      output: {
        goal,
        id,
        per: 'MAR-1',
        dismissed: true,
        by: { id: katy.id, name: katy.name },
        open: true,
        questions_set_aside: mostRequestsSetAside,
        notices: [
          { kind: 'dismissed_for_everyone', certainty: 'reminder' },
          { kind: 'question_still_waits', certainty: 'exact' },
        ],
        before_going_on: inWords,
      },
    });
    expect(asked).toEqual([{ goal, id }]);
    expect(await openRead(book)).toMatchObject({ open_count: 0, dismissed_count: 1 });
  });
});

describe('dismissing several things one after another', () => {
  it('notices, from the second on, the other things the same caller dismissed in the playbook lately', async () => {
    const book = assessmentBookOf();
    const first = await aThing(book);
    const second = await thingAt(book, { per: 'MAR-2', at: firstDay, marked: ['chosen'], live });
    const dismissed = dismissing(book);

    const answers = [await dismissed({ goal, id: first }), await dismissed({ goal, id: second })];

    expect(answers).toMatchObject([
      { output: { notices: [{ kind: 'dismissed_for_everyone' }] } },
      { output: { notices: [{ kind: 'dismissed_for_everyone' }, { kind: 'dismissed_several' }] } },
    ]);
  });
});

describe('a dismissal sent again', () => {
  it('appends nothing and notices nothing when the thing is dismissed already, and asks for no questions', async () => {
    const book = assessmentBookOf();
    const id = await aThing(book);
    const { asked, askedAbout } = askedOf(['ask-1']);
    const dismissed = dismissing(book, askedAbout);
    await dismissed({ goal, id, dismissed: true });
    const facts = await factsOn(book, id);

    const again = await dismissed({ goal, id });

    expect(await factsOn(book, id)).toBe(facts);
    expect(again).toMatchObject({ status: 'succeeded', output: { dismissed: true, questions_set_aside: 1 } });
    expect(again).not.toHaveProperty('output.notices');
    expect(asked).toHaveLength(1);
  });
});

describe('restoring a thing', () => {
  it('restores a dismissed thing with dismissed: false, with no notices, and appends nothing when it is not dismissed', async () => {
    const book = assessmentBookOf();
    const id = await aThing(book);
    const { asked, askedAbout } = askedOf(['ask-1']);
    const dismissed = dismissing(book, askedAbout);
    await dismissed({ goal, id });

    const back = await dismissed({ goal, id, dismissed: false });
    const facts = await factsOn(book, id);
    const backAgain = await dismissed({ goal, id, dismissed: false });

    expect(back).toMatchObject({ status: 'succeeded', output: { dismissed: false, questions_set_aside: 0 } });
    expect(back).not.toHaveProperty('output.notices');
    expect(back).not.toHaveProperty('output.by');
    expect(backAgain).toMatchObject({ status: 'succeeded', output: { dismissed: false } });
    expect(await factsOn(book, id)).toBe(facts);
    expect(asked).toHaveLength(1);
    expect(await openRead(book)).toMatchObject({ open_count: 1, dismissed_count: 0 });
  });
});

describe('dismissing a thing judged or judged by the calendar', () => {
  it('dismisses a thing already judged, which stays judged, and notices that its result stands', async () => {
    const book = assessmentBookOf();
    const id = await aThing(book);
    await book.assessed(id, 'passed', live + day);

    const answer = await dismissing(book)({ goal, id });

    expect(answer).toMatchObject({
      status: 'succeeded',
      output: {
        dismissed: true,
        open: false,
        questions_set_aside: 0,
        notices: [{ kind: 'dismissed_for_everyone' }, { kind: 'already_judged', certainty: 'exact' }],
      },
    });
    expect((await openRead(book)).closed).toMatchObject({ total: 1, passed: 1 });
  });

  it('dismisses a thing of a goal judged by the calendar, which has no per', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([controlsGoal]);
    const id = await book.opened(controlsGoal, firstDay, { window: { opens: firstDay, closes: live, due: live } });

    const answer = await dismissing(book)({ goal: controlsGoal.id, id });

    expect(answer).toMatchObject({ status: 'succeeded', output: { id, dismissed: true } });
    expect(answer).not.toHaveProperty('output.per');
  });
});

describe('a dismissal that is refused', () => {
  it('is not_found for a goal the playbook does not have, a thing never opened, and a thing of another goal', async () => {
    const book = assessmentBookOf();
    const id = await aThing(book);
    const dismissed = dismissing(book);
    const unknown = '00000000-0000-4000-8000-000000000000';

    const outcomes = [
      await dismissed({ goal: 'no-such-goal', id }),
      await dismissed({ goal, id: unknown }),
      await dismissed({ goal: controlsGoal.id, id }),
    ];

    const notFound = { status: 'rejected', reason: 'not_found' };
    expect(outcomes).toMatchObject([notFound, notFound, notFound]);
    expect(await factsOn(book, unknown)).toBe(0);
  });

  it('is invalid_input for an id that is not one the goals read gives', async () => {
    const book = assessmentBookOf();
    await aThing(book);

    expect(await dismissing(book)({ goal, id: 'MAR-1' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
  });
});

describe('the dismissal in plain words', () => {
  it('names the thing by its per, or by its id when it has none, in either direction', () => {
    const words = dismissGoalThingAsking().registration.plainLanguage;
    const id = '00000000-0000-4000-8000-000000000001';
    const dismissed = { goal, id, per: 'MAR-1', dismissed: true, open: true, questions_set_aside: 0 };
    const back = { goal, id, dismissed: false, open: true, questions_set_aside: 0 };

    expect([
      words?.attempt({ goal, id }),
      words?.attempt({ goal, id, dismissed: false }),
      words?.outcome(dismissed, { goal, id }),
      words?.outcome(back, { goal, id, dismissed: false }),
    ]).toEqual([
      expect.stringContaining(id),
      expect.stringContaining(id),
      expect.stringContaining('MAR-1'),
      expect.stringContaining(id),
    ]);
  });
});
