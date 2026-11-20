import { recordedDecoder, type KeyedProjection, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import { Option } from 'effect';

import { AssessmentEventSchema, assessmentsKind, type RecordedAssessmentEvent } from '../goal-facts/goal-facts.ts';

export const observationsName = 'goal_observations';

export interface ObservedEntry {
  readonly workflow: string;
  readonly version: number;
  readonly entry: number;
}

type Observed = Extract<RecordedAssessmentEvent, { readonly type: 'goal_observed' }>;

const isObserved = (event: RecordedAssessmentEvent): event is Observed => event.type === 'goal_observed';

const assessmentEventOf = recordedDecoder(AssessmentEventSchema);

const observedOf = (message: ProjectedMessage) => Option.filter(assessmentEventOf(message), isObserved);

export function observedEntryKeyOf({ workflow, version, entry }: ObservedEntry): string {
  return `${workflow}/${String(version)}/${String(entry)}`;
}

function observedAtIn(row: ProjectedRow | undefined): number {
  const at = row?.['observed_at'];
  return typeof at === 'number' ? at : -Infinity;
}

function observationAfter(row: ProjectedRow | undefined, { data }: Observed): ProjectedRow | undefined {
  const at = Date.parse(data.at);
  if (at <= observedAtIn(row)) {
    return undefined;
  }
  const { workflow, version, entry, run } = data.source;
  return { workflow, version, entry, observed_at: at, run };
}

export const observationRows: KeyedProjection = {
  name: observationsName,
  version: 2,
  scopes: ['definition'],
  kinds: [assessmentsKind],
  types: ['goal_observed'],
  columns: [
    { name: 'workflow', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'entry', kind: 'integer' },
    { name: 'observed_at', kind: 'integer' },
    { name: 'run', kind: 'text' },
  ],
  indexes: [],
  keyOf: (message) =>
    Option.getOrUndefined(Option.map(observedOf(message), ({ data }) => observedEntryKeyOf(data.source))),
  rowAfter: (row, message) =>
    Option.getOrUndefined(
      Option.flatMap(observedOf(message), (event) => Option.fromUndefinedOr(observationAfter(row, event))),
    ),
};
