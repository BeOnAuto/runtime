import { cutAtCodePoint, mostNameBytes } from '@on.auto/definitions';
import { strictRecordedDecoder, type Presenter } from '@on.auto/operations';

import { assessmentsKind, DismissalEventSchema } from '../goal-facts/goal-facts.ts';
import { assessmentRows } from '../goal-tables/assessment-rows.ts';
import { mostDismissedByBytes } from '../reads/assessments-schema.ts';
import { goalChangesOf } from '../reads/goal-changes.ts';
import { restoring } from './dismissal-notices.ts';

const dismissalOf = strictRecordedDecoder(DismissalEventSchema);

const shownNames: Readonly<Record<string, readonly string[]>> = {
  goal_dismissed: ['thing.dismissed'],
  goal_restored: ['thing.restored'],
};

const subjectStart = assessmentsKind.length + 1;

const assessmentsPresenter: Presenter = {
  streamKind: assessmentsKind,
  publicNames: Object.fromEntries(assessmentRows.types.map((type) => [type, shownNames[type] ?? []])),
  present: (recorded) => {
    const event = dismissalOf(recorded);
    const by = {
      id: cutAtCodePoint(event.data.by.id, mostDismissedByBytes),
      name: cutAtCodePoint(event.data.by.name, mostNameBytes),
    };
    const { goal, per } = event.data;
    const thing = { goal, id: recorded.stream.slice(subjectStart), ...(per === undefined ? {} : { per }) };
    return [
      event.type === 'goal_dismissed'
        ? {
            type: 'thing.dismissed',
            summary: `Dismissed ${per ?? thing.id} of the goal ${goal} for everyone in the organization.`,
            data: { ...thing, by, requests: [...event.data.requests] },
          }
        : {
            type: 'thing.restored',
            summary: `${restoring.done} ${per ?? thing.id} of the goal ${goal}.`,
            data: { ...thing, by },
          },
    ];
  },
  changes: goalChangesOf(assessmentRows.types),
  listedAs: `a goal's things dismissed or ${restoring.past}`,
};

export function goalPresenters(goals: boolean): readonly Presenter[] {
  return goals ? [assessmentsPresenter] : [];
}
