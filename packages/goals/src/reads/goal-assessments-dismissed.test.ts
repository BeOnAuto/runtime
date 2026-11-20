import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { requestsSetAside, requestsSetAsideBy } from '../dismissals/requests-set-aside.ts';
import {
  assessmentBookOf,
  day,
  experimentsGoal,
  firstDay,
  heldGoalOf,
  instantText,
  thingAt,
  type AssessmentBook,
} from './assessment-samples.ts';
import { goalAssessmentsIn, type GoalsAsked } from './goal-assessments.ts';

const hour = 3_600_000;

const live = firstDay + day;

const owner = 'person:owner';

function read(book: AssessmentBook, asked: GoalsAsked = {}) {
  return book.inThePlaybook(goalAssessmentsIn(heldGoalOf(experimentsGoal), undefined, asked));
}

function liveThing(book: AssessmentBook, per: string, at = firstDay): Promise<string> {
  return thingAt(book, { per, at, marked: ['chosen', 'prepared', 'live'], live });
}

async function threeThingsOneDismissed(book: AssessmentBook) {
  await book.goalsSaved([experimentsGoal]);
  const kept = await liveThing(book, 'MAR-1');
  const dismissed = await liveThing(book, 'MAR-2', firstDay + hour);
  const chosen = await thingAt(book, { per: 'MAR-3', at: firstDay + 2 * hour, marked: ['chosen'], live });
  await book.stopped(dismissed, 'failed-run', live + hour, 'The lookup of the orders failed.');
  await book.dismissed(dismissed, owner, live + 2 * hour, ['ask-1']);
  return { kept, dismissed, chosen };
}

describe('the open assessments of a goal someone dismissed', () => {
  it('are left out of every open count and list, and counted on their own', async () => {
    const book = assessmentBookOf();
    const { kept, chosen } = await threeThingsOneDismissed(book);

    const assessments = await read(book);

    expect(assessments).toMatchObject({
      open_count: 2,
      stopped_count: 0,
      dismissed_count: 1,
      by_milestone: { chosen: 2, prepared: 1, live: 1, measured: 0 },
      waiting: { chosen: 0, prepared: 1, live: 0, measured: 1 },
    });
    expect(assessments.in_flight.map(({ id }) => id)).toEqual([kept, chosen]);
    expect(assessments.current?.id).toBe(chosen);
    expect(assessments.in_flight.filter((assessment) => 'dismissed' in assessment)).toEqual([]);
  });

  it('are read as before, each with when and by whom, when the read asks to include them', async () => {
    const book = assessmentBookOf();
    const { dismissed } = await threeThingsOneDismissed(book);

    const assessments = await read(book, { dismissed: 'include' });

    expect(assessments).toMatchObject({ open_count: 3, stopped_count: 1, dismissed_count: 1 });
    expect(assessments.in_flight.find(({ id }) => id === dismissed)).toMatchObject({
      stopped: { run: 'failed-run' },
      dismissed: { at: instantText(live + 2 * hour), by: owner },
    });
    expect(assessments.in_flight.filter((assessment) => 'dismissed' in assessment)).toHaveLength(1);
  });
});

describe('the dismissed assessments of a goal as they move on', () => {
  it('come back into the read once restored', async () => {
    const book = assessmentBookOf();
    const { dismissed } = await threeThingsOneDismissed(book);
    await book.restored(dismissed, owner, live + 3 * hour);

    const assessments = await read(book);

    expect([assessments.open_count, assessments.stopped_count, assessments.dismissed_count]).toEqual([3, 1, 0]);
    expect(assessments.in_flight.find(({ id }) => id === dismissed)).not.toHaveProperty('dismissed');
  });

  it('are still judged, and their result is counted and listed as any other, with no dismissed mark', async () => {
    const book = assessmentBookOf();
    const { dismissed } = await threeThingsOneDismissed(book);
    await book.assessed(dismissed, 'failed', live + 9 * day, 'deadline');

    const assessments = await read(book, { dismissed: 'include' });

    expect([assessments.open_count, assessments.dismissed_count]).toEqual([2, 0]);
    expect(assessments.closed).toMatchObject({ total: 1, failed: 1, latest: [{ id: dismissed, outcome: 'failed' }] });
  });

  it('shows the one judged as the current with its result and no dismissed mark', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const id = await liveThing(book, 'MAR-5');
    await book.dismissed(id, owner, live);
    await book.assessed(id, 'passed', live + hour);

    const { current } = await read(book, { dismissed: 'include' });

    expect(current).toMatchObject({ id, verdict: 'passed' });
    expect(current).not.toHaveProperty('dismissed');
  });

  it('carry the id of who dismissed them cut to two hundred bytes', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const id = await liveThing(book, 'MAR-4');
    await book.dismissed(id, `person:${'é'.repeat(300)}`, live);

    const { in_flight: inFlight } = await read(book, { dismissed: 'include' });

    expect(inFlight[0]?.dismissed?.by).toBe(`person:${'é'.repeat(96)}`);
  });
});

describe('the requests the standing dismissals of a playbook set aside', () => {
  it('are those of each thing still dismissed, judged or not, each with the newest dismissal that names it', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const older = await liveThing(book, 'MAR-1');
    const newer = await liveThing(book, 'MAR-2', firstDay + hour);
    const back = await liveThing(book, 'MAR-3', firstDay + 2 * hour);
    await book.dismissed(older, owner, live, ['ask-1', 'ask-2']);
    await book.dismissed(newer, 'person:other', live + hour, ['ask-2', 'ask-3']);
    await book.dismissed(back, owner, live + 2 * hour, ['ask-4']);
    await book.restored(back, owner, live + 3 * hour);
    await book.assessed(older, 'failed', live + 9 * day, 'deadline');

    const setAside = await book.inThePlaybook(requestsSetAside());

    const ofOlder = { goal: experimentsGoal.id, id: older, at: instantText(live), by: owner };
    const ofNewer = { goal: experimentsGoal.id, id: newer, at: instantText(live + hour), by: 'person:other' };
    expect(Object.fromEntries(setAside)).toEqual({ 'ask-1': ofOlder, 'ask-2': ofNewer, 'ask-3': ofNewer });
  });
});

describe('the requests a dismissal sets aside, of a goal the playbook no longer names', () => {
  it('are none, since the goal they were set aside for is another playbook’s now', async () => {
    const elsewhere = {
      org: 'acme',
      definition: 'goal-held-elsewhere',
      playbook: 'sales',
      key: 'thing-1',
      row: { dismissed: true, at: live, by: owner, requests: JSON.stringify(['ask-1']) },
    };

    const setAside = await Effect.runPromise(
      requestsSetAsideBy({ read: () => Effect.succeed([elsewhere]), goalNames: Effect.succeed([]) }),
    );

    expect(setAside.size).toBe(0);
  });
});
