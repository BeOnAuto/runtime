import type { GuideVariables } from '@on.auto/definitions';
import { changedOnlyByWhoeverRunsTheServer } from '@on.auto/phrasing';

import { thirtyDays } from '../document/workflow-document.ts';

const minute = 60_000;

const hour = 3_600_000;

const day = 86_400_000;

const counted = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });

function unitsOf(count: number, one: string, other: string): string {
  return `${counted.format(count)} ${count === 1 ? one : other}`;
}

function durationInWords(milliseconds: number): string {
  if (milliseconds % day === 0) {
    return unitsOf(milliseconds / day, 'day', 'days');
  }
  return milliseconds % hour === 0
    ? unitsOf(milliseconds / hour, 'hour', 'hours')
    : unitsOf(milliseconds / minute, 'minute', 'minutes');
}

interface Bounded {
  readonly mostDurationMs: number;
}

const asThePageHasIt: Bounded = { mostDurationMs: thirtyDays };

function fromItsStart(milliseconds: number): string {
  return `${durationInWords(milliseconds)} from its start`;
}

export function guideVariablesOf({ mostDurationMs }: Bounded = asThePageHasIt): GuideVariables {
  return {
    'workflow.longest_run': {
      value: fromItsStart(mostDurationMs),
      default: fromItsStart(asThePageHasIt.mostDurationMs),
    },
    'workflow.bounds_changed_by': {
      value: changedOnlyByWhoeverRunsTheServer,
      default: changedOnlyByWhoeverRunsTheServer,
    },
  };
}
