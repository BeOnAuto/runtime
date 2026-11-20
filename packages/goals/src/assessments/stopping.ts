import type { Instant } from '../goal-rules/goal-rule.ts';
import type { AssessmentFact, GoalObserved, GoalStopped } from './assessment-facts.ts';
import type { AssessmentState, Mark, PinnedRule, StandingMeasurement } from './assessment-state.ts';
import type { MeasuredChange } from './measured-change.ts';

export interface Stopped {
  readonly at: Instant;
  readonly run: string;
  readonly reason?: string;
}

function cannotPass({ target }: PinnedRule, { value }: StandingMeasurement): boolean {
  return 'at_least' in target ? value < target.at_least : value > target.at_most;
}

function stoppedBy(state: AssessmentState, measurement: StandingMeasurement | undefined): Stopped | undefined {
  const { pinned } = state;
  if (pinned?.settles !== 'on_crossing' || measurement?.final !== true || !cannotPass(pinned, measurement)) {
    return undefined;
  }
  const { at, run, says } = measurement;
  return { at, run, ...(says === undefined ? {} : { reason: says }) };
}

function movedOn(state: AssessmentState, marks: readonly Mark[], data: GoalObserved): boolean {
  const marked = marks.length > state.marks.length && data.source.run !== state.stopped?.run;
  return marked || data.measurement?.final === false;
}

function stoppedPart(stopped: Stopped | undefined): { readonly stopped?: Stopped } {
  return stopped === undefined ? {} : { stopped };
}

export function stoppedAfterObserving(
  state: AssessmentState,
  marks: readonly Mark[],
  change: MeasuredChange,
  data: GoalObserved,
): { readonly stopped?: Stopped } {
  if (state.verdict !== 'open') {
    return stoppedPart(state.stopped);
  }
  const stopped = stoppedBy(state, change.measurement);
  if (stopped !== undefined) {
    return { stopped };
  }
  return movedOn(state, marks, data) ? {} : stoppedPart(state.stopped);
}

export function stoppedOf({ at, run, reason }: GoalStopped): Stopped {
  return { at: Date.parse(at), run, reason };
}

export interface Stopping {
  readonly run: string;
  readonly at: Instant;
  readonly reason: string;
}

export function factsStopping(state: AssessmentState, { run, at, reason }: Stopping): readonly AssessmentFact[] {
  const undecided = state.pinned !== undefined && state.ended === undefined && state.verdict === 'open';
  return undecided && state.stopped?.run !== run
    ? [{ type: 'goal_stopped', data: { run, at: new Date(at).toISOString(), reason } }]
    : [];
}
