import { isCalendarRule, type GoalRule, type Instant, type Verdict, type WindowSpan } from '../goal-rules/goal-rule.ts';
import { afterSpanFrom } from '../goal-windows/calendar-windows.ts';
import type { Observation } from '../observations/observation.ts';
import type { AssessmentFact } from './assessment-facts.ts';
import {
  assessmentAfter,
  isMarked,
  isUndecided,
  measuredChangeOf,
  pinnedOf,
  pinsMilestone,
  textOf,
  type AssessmentState,
  type PinnedRule,
} from './assessment-state.ts';
import { openedFact, openingOf } from './opening.ts';
import { assessedFact, crossingOf, decidedBy, endedFact } from './verdict-rule.ts';
import { afterMilestoneOf, countsIn, opensInRun } from './window-counting.ts';

export interface Observing {
  readonly goal: GoalRule | undefined;
  readonly goalsVersion: number;
  readonly observations: readonly Observation[];
  readonly now: Instant;
  readonly clearing?: readonly string[];
}

interface Weighed {
  readonly fact?: AssessmentFact;
  readonly crossing?: Verdict;
}

function windowOpenedBy(state: AssessmentState, pinned: PinnedRule, observation: Observation): WindowSpan | undefined {
  const rule = pinned.window;
  if (rule === undefined || isCalendarRule(rule) || state.window !== undefined || observation.marks !== rule.after) {
    return undefined;
  }
  return pinsMilestone(state, rule.after) ? afterSpanFrom(rule, observation.at) : undefined;
}

interface Windows {
  readonly window: WindowSpan | undefined;
  readonly opened: WindowSpan | undefined;
  readonly opening: boolean;
}

function openedHere(opening: boolean): { readonly opening?: true } {
  return opening ? { opening: true } : {};
}

function crossingIn(
  state: AssessmentState,
  pinned: PinnedRule,
  windows: Windows,
  observation: Observation,
): Verdict | undefined {
  const { window, opening } = windows;
  const { measurement } = observation;
  if (pinned.settles !== 'on_crossing' || measurement === undefined || state.verdict !== 'open') {
    return undefined;
  }
  const rule = pinned.window;
  const inWindow =
    rule === undefined ||
    (window !== undefined &&
      countsIn(rule, window, { ...measurement, ...openedHere(opening) }) &&
      observation.at <= window.closes);
  return inWindow ? crossingOf(pinned.target, measurement.value) : undefined;
}

function measurementCounts(
  state: AssessmentState,
  windows: Windows,
  observation: Observation,
  crossing: Verdict | undefined,
): boolean {
  const { measurement } = observation;
  if (measurement === undefined) {
    return false;
  }
  const change = measuredChangeOf(state, windows.window, {
    ...measurement,
    at: observation.at,
    run: observation.source.run,
    ...openedHere(windows.opening),
  });
  return crossing !== undefined || change.measurement !== undefined || change.finalMeasurement !== undefined;
}

function isRetitled(state: AssessmentState, observation: Observation): boolean {
  return (
    (observation.title !== undefined && observation.title !== state.title) ||
    (observation.link !== undefined && observation.link !== state.link)
  );
}

function titledBy(
  title: string | undefined,
  link: string | undefined,
): { readonly title?: string; readonly link?: string } {
  return { ...(title === undefined ? {} : { title }), ...(link === undefined ? {} : { link }) };
}

function spanText(span: WindowSpan): { readonly opens: string; readonly closes: string; readonly due: string } {
  return { opens: textOf(span.opens), closes: textOf(span.closes), due: textOf(span.due) };
}

function observedFact(
  observation: Observation,
  parts: { readonly marks: boolean; readonly measured: boolean; readonly window: WindowSpan | undefined },
): AssessmentFact {
  const { marks, measurement, says, title, link } = observation;
  return {
    type: 'goal_observed',
    data: {
      source: observation.source,
      at: textOf(observation.at),
      ...(parts.marks && marks !== undefined ? { marks } : {}),
      ...(parts.measured && measurement !== undefined
        ? { measurement: { value: measurement.value, final: measurement.final, as_of: textOf(measurement.as_of) } }
        : {}),
      ...titledBy(title, link),
      ...(says !== undefined && (parts.marks || parts.measured) ? { says } : {}),
      ...(parts.window === undefined ? {} : { window: spanText(parts.window) }),
    },
  };
}

function windowsOf(state: AssessmentState, pinned: PinnedRule, observation: Observation): Windows {
  const opened = windowOpenedBy(state, pinned, observation);
  return {
    window: state.window ?? opened,
    opened,
    opening: opened !== undefined || opensInRun(state, observation.source.run),
  };
}

function weighed(state: AssessmentState, pinned: PinnedRule, observation: Observation, clears: boolean): Weighed {
  const windows = windowsOf(state, pinned, observation);
  const { opened } = windows;
  const marks =
    observation.marks !== undefined && pinsMilestone(state, observation.marks) && !isMarked(state, observation.marks);
  const crossing = crossingIn(state, pinned, windows, observation);
  const measured = measurementCounts(state, windows, observation, crossing);
  if (!marks && !measured && !clears && !isRetitled(state, observation)) {
    return {};
  }
  return {
    fact: observedFact(observation, { marks, measured: measured || clears, window: opened }),
    ...(crossing === undefined ? {} : { crossing }),
  };
}

function verdictAfter(
  state: AssessmentState,
  goal: GoalRule,
  observation: Observation,
  now: Instant,
): AssessmentFact | undefined {
  const { window, finalMeasurement, pinned } = state;
  if (pinned === undefined || state.verdict !== 'open' || window === undefined || finalMeasurement === undefined) {
    return undefined;
  }
  return now >= window.due
    ? assessedFact(goal, {
        verdict: decidedBy(pinned.target, finalMeasurement.value),
        at: Math.max(observation.at, window.due),
        by: 'final',
        source: observation.source,
      })
    : undefined;
}

interface Opened {
  readonly facts: readonly AssessmentFact[];
  readonly state: AssessmentState;
  readonly pinned: PinnedRule;
}

function openedFor(
  state: AssessmentState,
  observing: Observing & { readonly goal: GoalRule },
  observation: Observation,
): Opened | undefined {
  if (state.pinned !== undefined) {
    return { facts: [], state, pinned: state.pinned };
  }
  const opening = openingOf(observing.goal, observing.goalsVersion, observation);
  if (opening === undefined) {
    return undefined;
  }
  const fact = openedFact(opening);
  return { facts: [fact], state: assessmentAfter(state, fact), pinned: pinnedOf(opening) };
}

function stepOf(
  state: AssessmentState,
  observing: Observing & { readonly goal: GoalRule },
  observation: Observation,
): readonly AssessmentFact[] {
  const opening = openedFor(state, observing, observation);
  if (opening === undefined) {
    return [];
  }
  const clears = observing.clearing?.includes(observation.source.record) === true;
  const { fact, crossing } = weighed(opening.state, opening.pinned, observation, clears);
  if (fact === undefined) {
    return opening.facts;
  }
  const observed = assessmentAfter(opening.state, fact);
  const verdict =
    crossing === undefined
      ? verdictAfter(observed, observing.goal, observation, observing.now)
      : assessedFact(observing.goal, {
          verdict: crossing,
          at: observation.at,
          by: 'crossing',
          source: observation.source,
        });
  return [...opening.facts, fact, ...(verdict === undefined ? [] : [verdict])];
}

function isLive(goal: GoalRule | undefined): goal is GoalRule {
  return goal !== undefined && goal.retired !== true;
}

function markingFirst(observations: readonly Observation[], milestone: string | undefined): readonly Observation[] {
  const marking = (observation: Observation) => milestone !== undefined && observation.marks === milestone;
  return [
    ...observations.filter((observation) => marking(observation)),
    ...observations.filter((observation) => !marking(observation)),
  ];
}

export function factsObserving(state: AssessmentState, observing: Observing): readonly AssessmentFact[] {
  const { goal } = observing;
  if (!isLive(goal)) {
    return isUndecided(state) ? [endedFact('goal_retired')] : [];
  }
  if (state.ended !== undefined) {
    return [];
  }
  const unseen = observing.observations.filter(({ source }) => !state.sources.includes(source.record));
  const fresh = markingFirst(unseen, afterMilestoneOf(state.pinned?.window ?? goal.window));
  const live = { ...observing, goal };
  const { facts } = fresh.reduce<{ readonly current: AssessmentState; readonly facts: readonly AssessmentFact[] }>(
    ({ current, facts: before }, observation) => {
      const step = stepOf(current, live, observation);
      return {
        current: step.reduce((after, fact) => assessmentAfter(after, fact), current),
        facts: [...before, ...step],
      };
    },
    { current: state, facts: [] },
  );
  return facts;
}
