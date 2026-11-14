import type { StudioPage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { experiments, monday, noticeBookOf, performedAt, startsAnswering } from '../notices/notice-samples.ts';
import { noticesOwedOf } from '../notices/notice-starts.ts';
import { noticedPlaybookIn } from '../notices/noticed-playbooks.ts';
import { goalLinksOver, noGoalLinks, type GoalLinkOf } from './goal-links.ts';

const pages: StudioPage[] = [];

const linkTo = (page?: StudioPage) => {
  if (page !== undefined) {
    pages.push(page);
  }
  return `https://studio.example/?page=${String(page?.kind)}`;
};

describe('the Studio address of a goal a host makes with no request in progress', () => {
  it('names the goal page, with its one thing when there is one', () => {
    pages.length = 0;
    const linkOf = goalLinksOver(linkTo);

    expect([
      linkOf({ playbook: 'sales', goal: 'paying-customers' }),
      linkOf({ playbook: 'sales', goal: 'paying-customers', per: 'MAR-41' }),
    ]).toEqual(['https://studio.example/?page=goal', 'https://studio.example/?page=goal']);
    expect(pages).toEqual([
      { kind: 'goal', playbook: 'sales', goal: 'paying-customers' },
      { kind: 'goal', playbook: 'sales', goal: 'paying-customers', per: 'MAR-41' },
    ]);
  });

  it('makes none where the host knows no Studio', () => {
    expect([
      goalLinksOver(null)({ playbook: 'sales', goal: 'g' }),
      noGoalLinks({ playbook: 'sales', goal: 'g' }),
    ]).toEqual([undefined, undefined]);
  });
});

async function startedWith(linkOf?: GoalLinkOf) {
  const book = noticeBookOf();
  await book.playbookCreated();
  await book.goalsSaved([experiments]);
  await book.opened();
  await book.assessed('passed', 'now');
  const seen = startsAnswering(() => 'started');
  const work = noticesOwedOf({
    ledger: book.ledger,
    start: seen.start,
    playbookOf: noticedPlaybookIn(book.ledger),
    ...(linkOf === undefined ? {} : { linkOf }),
  });
  await performedAt(work, monday);
  return seen.starts.map(({ input }) => Object.entries(input ?? {}));
}

describe('the link in a notice', () => {
  it('opens the goal and its thing in Studio, after the detail as the notice lists its fields', async () => {
    const asked: unknown[] = [];
    const [input] = await startedWith((place) => {
      asked.push(place);
      return 'https://studio.example/?playbook=sales&goal=paying-customers&per=experiment-7';
    });

    expect(asked).toEqual([{ playbook: 'sales', goal: experiments.id, per: 'experiment-7' }]);
    expect(input?.slice(0, 4)).toEqual([
      ['change', 'passed'],
      ['headline', 'Brought a customer: Bring in paying customers through my experiments.'],
      ['link', 'https://studio.example/?playbook=sales&goal=paying-customers&per=experiment-7'],
      ['owner', { id: 'person:ada', name: 'Ada' }],
    ]);
  });

  it('is left out where the host knows no Studio address', async () => {
    const [withNone] = await startedWith(noGoalLinks);
    const [unwired] = await startedWith();

    expect(
      [withNone, unwired].map((fields?: readonly (readonly [string, unknown])[]) =>
        fields?.some(([key]) => key === 'link'),
      ),
    ).toEqual([false, false]);
  });
});

describe('the link in a notice of a goal judged as a whole', () => {
  it('names no thing', async () => {
    const book = noticeBookOf();
    await book.playbookCreated();
    await book.goalsSaved([experiments]);
    const whole = assessmentIdOf({ goal: experiments.id });
    const opened = {
      goal: experiments.id,
      goals_version: 1,
      rule: { settles: 'on_crossing', target: { at_least: 1 } },
      milestones: experiments.milestones,
    };
    await book.append(`assessments/${whole}`, 'goal_assessment_opened', opened, { by: 'playbook:sales' });
    await book.append(
      `assessments/${whole}`,
      'goal_assessed',
      { verdict: 'passed', at: new Date(monday).toISOString(), by: 'crossing', told: 'now' },
      { by: 'playbook:sales' },
    );
    const asked: unknown[] = [];
    const seen = startsAnswering(() => 'started');
    const work = noticesOwedOf({
      ledger: book.ledger,
      start: seen.start,
      playbookOf: noticedPlaybookIn(book.ledger),
      linkOf: (place) => {
        asked.push(place);
        return noGoalLinks(place);
      },
    });
    await performedAt(work, monday);

    expect(asked).toEqual([{ playbook: 'sales', goal: experiments.id }]);
  });
});
