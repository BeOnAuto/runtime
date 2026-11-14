import { Schema } from 'effect';

import { AssessmentFactSchema, type AssessmentFact } from '../assessments/assessment-facts.ts';
import { assessmentOf, type AssessmentState } from '../assessments/assessment-state.ts';

export interface Appended {
  readonly assessment: string;
  readonly fact: AssessmentFact;
}

export interface TraceLedger {
  readonly appended: (assessment: string, facts: readonly AssessmentFact[]) => readonly Appended[];
  readonly factsOf: (assessment: string) => readonly AssessmentFact[];
  readonly stateOf: (assessment: string) => AssessmentState;
  readonly holds: (assessment: string) => boolean;
  readonly assessments: () => readonly string[];
}

const decoded = Schema.decodeUnknownSync(AssessmentFactSchema);

export function traceLedgerOf(): TraceLedger {
  const streams = new Map<string, readonly AssessmentFact[]>();
  const factsOf = (assessment: string) => streams.get(assessment) ?? [];
  return {
    appended: (assessment, facts) => {
      if (facts.length > 0) {
        const recorded = facts.map((fact) => decoded(fact, { onExcessProperty: 'error' }));
        streams.set(assessment, [...factsOf(assessment), ...recorded]);
      }
      return facts.map((fact) => ({ assessment, fact }));
    },
    factsOf,
    stateOf: (assessment) => assessmentOf(factsOf(assessment)),
    holds: (assessment) => streams.has(assessment),
    assessments: () => [...streams.keys()],
  };
}
