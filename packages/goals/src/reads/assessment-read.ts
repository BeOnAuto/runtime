import { cutAtCodePoint } from '@on.auto/definitions';
import type { ProjectedKeyedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { nextMilestoneOf } from '../assessments/assessment-dues.ts';
import { isUndecided, textOf, type AssessmentState, type PinnedRule } from '../assessments/assessment-state.ts';
import { countsIn } from '../assessments/window-counting.ts';
import type { Target, WindowSpan } from '../goal-rules/goal-rule.ts';
import { assessmentStateOfText, NoticesStartedSchema } from '../goal-tables/assessment-row-state.ts';
import { mostDismissedByBytes, type Assessments } from './assessments-schema.ts';

export type AssessmentRead = NonNullable<Assessments['current']>;

export type ClosedRead = Assessments['closed']['latest'][number];

export type NoticeRead = AssessmentRead['notices'][number];

export interface HeldAssessment {
  readonly id: string;
  readonly state: AssessmentState;
  readonly pinned: PinnedRule;
  readonly notices: readonly NoticeRead[];
}

const noticesOfText = Schema.decodeUnknownOption(NoticesStartedSchema);

export function instantIn({ row }: ProjectedKeyedRow, column: string, otherwise: number): number {
  const instant = row[column];
  return typeof instant === 'number' ? instant : otherwise;
}

export function heldAssessmentsOf({ key, row }: ProjectedKeyedRow): readonly HeldAssessment[] {
  const state = assessmentStateOfText(row['state']);
  const pinned = state?.pinned;
  if (state === undefined || pinned === undefined) {
    return [];
  }
  const notices = Option.getOrElse(noticesOfText(row['notices']), () => []);
  return [{ id: key, state, pinned, notices }];
}

function windowOf(window: WindowSpan | undefined) {
  return window === undefined
    ? {}
    : { window: { opens: textOf(window.opens), closes: textOf(window.closes), due: textOf(window.due) } };
}

function perOf({ state, pinned }: HeldAssessment) {
  if (pinned.per === undefined) {
    return {};
  }
  const title = state.title === undefined ? {} : { title: state.title };
  const link = state.link === undefined ? {} : { link: state.link };
  return { per: { id: pinned.per, ...title, ...link } };
}

function saying(says: string | undefined) {
  return says === undefined ? {} : { says };
}

function measurementsOf({ measurement, finalMeasurement }: AssessmentState) {
  const standing =
    measurement === undefined
      ? {}
      : {
          measurement: {
            value: measurement.value,
            final: measurement.final,
            as_of: textOf(measurement.as_of),
            at: textOf(measurement.at),
            run: measurement.run,
            ...saying(measurement.says),
          },
        };
  const final =
    finalMeasurement === undefined
      ? {}
      : {
          final_measurement: {
            value: finalMeasurement.value,
            as_of: textOf(finalMeasurement.as_of),
            at: textOf(finalMeasurement.at),
            run: finalMeasurement.run,
          },
        };
  return { ...standing, ...final };
}

function judgedByOf({ verdict, verdictBy }: AssessmentState) {
  return verdict === 'open' || verdictBy === undefined ? {} : { by: verdictBy };
}

function verdictOf(state: AssessmentState) {
  const { verdict, verdictAt, overdueSince } = state;
  const judged = judgedByOf(state);
  return {
    verdict,
    ...(verdictAt === undefined ? {} : { verdict_at: textOf(verdictAt) }),
    ...(judged.by === undefined ? {} : { verdict_by: judged.by }),
    ...(overdueSince === undefined || verdict !== 'open' ? {} : { overdue_since: textOf(overdueSince) }),
  };
}

function stoppedOf(state: AssessmentState) {
  const { stopped } = state;
  if (stopped === undefined || !isUndecided(state)) {
    return {};
  }
  return {
    stopped: {
      at: textOf(stopped.at),
      run: stopped.run,
      ...(stopped.reason === undefined ? {} : { reason: stopped.reason }),
    },
  };
}

function dismissedOf(state: AssessmentState) {
  const { dismissed } = state;
  if (dismissed === undefined || !isUndecided(state)) {
    return {};
  }
  return { dismissed: { at: textOf(dismissed.at), by: cutAtCodePoint(dismissed.by.id, mostDismissedByBytes) } };
}

function pinnedOf({ pinned }: HeldAssessment) {
  return { rule: { settles: pinned.settles, target: pinned.target }, milestones: pinned.milestones };
}

export function assessmentReadOf(held: HeldAssessment): AssessmentRead {
  const { id, state, pinned, notices } = held;
  const next = nextMilestoneOf(state);
  return {
    id,
    ...perOf(held),
    ...windowOf(state.window),
    ...pinnedOf(held),
    marks: state.marks.map(({ milestone, at, run, says }) => ({ milestone, at: textOf(at), run, ...saying(says) })),
    ...(next === undefined ? {} : { next }),
    ...measurementsOf(state),
    ...verdictOf(state),
    ...stoppedOf(state),
    ...dismissedOf(state),
    goals_version: pinned.goalsVersion,
    notices,
  };
}

function crosses(target: Target, value: number): boolean {
  return 'at_least' in target ? value >= target.at_least : value > target.at_most;
}

function decidedByCrossing({ state, pinned }: HeldAssessment): boolean {
  const { measurement, window } = state;
  if (pinned.settles !== 'on_crossing' || measurement === undefined) {
    return false;
  }
  const rule = pinned.window;
  const inWindow = window === undefined || rule === undefined || countsIn(rule, window, measurement);
  const passing = 'at_least' in pinned.target ? state.verdict === 'passed' : state.verdict === 'failed';
  return inWindow && passing && crosses(pinned.target, measurement.value);
}

export function judgedOnItsMeasurement(held: HeldAssessment): boolean {
  return held.state.measurement?.final === true || decidedByCrossing(held);
}

function judgedValueOf(held: HeldAssessment): number | undefined {
  if (held.state.verdict === 'open') {
    return undefined;
  }
  return decidedByCrossing(held) ? held.state.measurement?.value : held.state.finalMeasurement?.value;
}

type ClosedOutcome = ClosedRead['outcome'];

function closedOutcomeOf({ verdict, ended }: AssessmentState): ClosedOutcome | undefined {
  if (verdict !== 'open') {
    return verdict;
  }
  return ended === 'no_result' ? ended : undefined;
}

function endedMarksOf({ marks }: AssessmentState) {
  return marks.map(({ milestone, at, run }) => ({ milestone, at: textOf(at), run }));
}

export function closedReadsOf(held: HeldAssessment, at: number): readonly ClosedRead[] {
  const outcome = closedOutcomeOf(held.state);
  if (outcome === undefined) {
    return [];
  }
  const value = judgedValueOf(held);
  return [
    {
      id: held.id,
      outcome,
      at: textOf(at),
      ...perOf(held),
      ...windowOf(held.state.window),
      ...(value === undefined ? {} : { value }),
      ...judgedByOf(held.state),
      ...pinnedOf(held),
      marks: endedMarksOf(held.state),
      ...measurementsOf(held.state),
    },
  ];
}
