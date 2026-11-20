import type {
  Instant,
  MilestoneRule,
  Settles,
  Target,
  Verdict,
  WindowRule,
  WindowSpan,
} from '../goal-rules/goal-rule.ts';
import type { AssessmentFact, AssessmentOpened, EndReason, GoalObserved, JudgedBy } from './assessment-facts.ts';
import type { NoticeChange } from './assessment-identity.ts';
import { dismissedAfter, type Dismissed } from './dismissing.ts';
import { measuredChangeOf, openingPart, type Measured } from './measured-change.ts';
import { refusedAfter, startedAfter } from './notice-owing.ts';
import { stoppedAfterObserving, stoppedOf, type Stopped } from './stopping.ts';
import { opensInRun } from './window-counting.ts';

const recentSources = 32;

export interface PinnedRule {
  readonly goalVersion: number;
  readonly per?: string;
  readonly settles: Settles;
  readonly target: Target;
  readonly window?: WindowRule;
  readonly milestones: readonly MilestoneRule[];
}

export interface Mark {
  readonly milestone: string;
  readonly at: Instant;
  readonly run: string;
  readonly says?: string;
}

export interface StandingMeasurement {
  readonly value: number;
  readonly final: boolean;
  readonly as_of: Instant;
  readonly at: Instant;
  readonly run: string;
  readonly says?: string;
  readonly opening?: true;
}

export interface FinalMeasurement {
  readonly value: number;
  readonly as_of: Instant;
  readonly at: Instant;
  readonly run: string;
  readonly opening?: true;
}

export interface OwedNotice {
  readonly change: NoticeChange;
  readonly due: Instant;
  readonly attempt: number;
}

export interface AssessmentState {
  readonly pinned?: PinnedRule;
  readonly window?: WindowSpan;
  readonly marks: readonly Mark[];
  readonly measurement?: StandingMeasurement;
  readonly finalMeasurement?: FinalMeasurement;
  readonly lateMeasurement?: FinalMeasurement;
  readonly title?: string;
  readonly link?: string;
  readonly verdict: 'open' | Verdict;
  readonly verdictAt?: Instant;
  readonly verdictBy?: JudgedBy;
  readonly overdueSince?: Instant;
  readonly ended?: EndReason;
  readonly stopped?: Stopped;
  readonly dismissed?: Dismissed;
  readonly sources: readonly string[];
  readonly owed: readonly OwedNotice[];
  readonly started: readonly { readonly change: NoticeChange; readonly run: string }[];
}

export const unopened: AssessmentState = { marks: [], verdict: 'open', sources: [], owed: [], started: [] };

function instantOf(text: string): Instant {
  return Date.parse(text);
}

export function textOf(instant: Instant): string {
  return new Date(instant).toISOString();
}

function spanOf(window: { readonly opens: string; readonly closes: string; readonly due: string }): WindowSpan {
  return { opens: instantOf(window.opens), closes: instantOf(window.closes), due: instantOf(window.due) };
}

export function isOpen(state: AssessmentState): boolean {
  return state.pinned !== undefined && state.ended === undefined;
}

export function isUndecided(state: AssessmentState): boolean {
  return isOpen(state) && state.verdict === 'open';
}

export function isMarked(state: AssessmentState, milestone: string): boolean {
  return state.marks.some((mark) => mark.milestone === milestone);
}

export function pinsMilestone(state: AssessmentState, milestone: string): boolean {
  return state.pinned?.milestones.some(({ id }) => id === milestone) === true;
}

export function pinnedOf(data: AssessmentOpened): PinnedRule {
  return {
    goalVersion: data.goal_version ?? 0,
    ...(data.per === undefined ? {} : { per: data.per.id }),
    settles: data.rule.settles,
    target: data.rule.target,
    ...(data.rule.window === undefined ? {} : { window: data.rule.window }),
    milestones: data.milestones,
  };
}

function markedAfter(state: AssessmentState, data: GoalObserved): readonly Mark[] {
  const { marks } = data;
  if (marks === undefined || !pinsMilestone(state, marks) || isMarked(state, marks)) {
    return state.marks;
  }
  const says = data.measurement === undefined && data.says !== undefined ? { says: data.says } : {};
  return [...state.marks, { milestone: marks, at: instantOf(data.at), run: data.source.run, ...says }];
}

function measuredOf(data: GoalObserved, opening: boolean): Measured | undefined {
  const { measurement } = data;
  if (measurement === undefined) {
    return undefined;
  }
  return {
    value: measurement.value,
    final: measurement.final,
    as_of: instantOf(measurement.as_of),
    at: instantOf(data.at),
    run: data.source.run,
    ...(data.says === undefined ? {} : { says: data.says }),
    ...openingPart(opening),
  };
}

function observedAfter(state: AssessmentState, data: GoalObserved): AssessmentState {
  const opening = (data.window !== undefined && state.window === undefined) || opensInRun(state, data.source.run);
  const window = data.window === undefined || state.window !== undefined ? state.window : spanOf(data.window);
  const measured = measuredOf(data, opening);
  const change = measured === undefined ? {} : measuredChangeOf(state, window, measured);
  const marks = markedAfter(state, data);
  const { stopped: _, ...unstopped } = state;
  return {
    ...unstopped,
    ...stoppedAfterObserving(state, marks, change, data),
    ...(window === undefined ? {} : { window }),
    marks,
    ...change,
    ...(data.title === undefined ? {} : { title: data.title }),
    ...(data.link === undefined ? {} : { link: data.link }),
    sources: [...state.sources.filter((record) => record !== data.source.record), data.source.record].slice(
      -recentSources,
    ),
  };
}

function owedAfter(state: AssessmentState, change: NoticeChange, told: string, at: string): readonly OwedNotice[] {
  return told === 'now' ? [...state.owed, { change, due: instantOf(at), attempt: 0 }] : state.owed;
}

type FactOf<Type extends AssessmentFact['type']> = Extract<AssessmentFact, { readonly type: Type }>['data'];

function openedAfter(state: AssessmentState, data: FactOf<'goal_assessment_opened'>): AssessmentState {
  if (state.pinned !== undefined) {
    return state;
  }
  return { ...state, pinned: pinnedOf(data), ...(data.window === undefined ? {} : { window: spanOf(data.window) }) };
}

function assessedAfter(state: AssessmentState, data: FactOf<'goal_assessed'>): AssessmentState {
  if (state.verdict !== 'open' || !isOpen(state)) {
    return state;
  }
  return {
    ...state,
    verdict: data.verdict,
    verdictAt: instantOf(data.at),
    verdictBy: data.by,
    owed: owedAfter(state, data.verdict, data.told, data.at),
  };
}

function overdueAfter(state: AssessmentState, data: FactOf<'goal_overdue'>): AssessmentState {
  if (state.overdueSince !== undefined || !isOpen(state)) {
    return state;
  }
  return { ...state, overdueSince: instantOf(data.since), owed: owedAfter(state, 'overdue', data.told, data.since) };
}

type JudgingFact = Exclude<
  AssessmentFact,
  { readonly type: 'goal_notice_started' | 'goal_notice_refused' | 'goal_dismissed' | 'goal_restored' }
>;

function factAfter(state: AssessmentState, fact: JudgingFact): AssessmentState {
  if (fact.type === 'goal_assessment_opened') {
    return openedAfter(state, fact.data);
  }
  if (fact.type === 'goal_observed') {
    return isOpen(state) ? observedAfter(state, fact.data) : state;
  }
  if (fact.type === 'goal_assessed') {
    return assessedAfter(state, fact.data);
  }
  if (fact.type === 'goal_overdue') {
    return overdueAfter(state, fact.data);
  }
  if (fact.type === 'goal_stopped') {
    return isUndecided(state) ? { ...state, stopped: stoppedOf(fact.data) } : state;
  }
  return isOpen(state) ? { ...state, ended: fact.data.reason } : state;
}

export function assessmentAfter(state: AssessmentState, fact: AssessmentFact): AssessmentState {
  if (fact.type === 'goal_notice_started') {
    return startedAfter(state, fact.data);
  }
  if (fact.type === 'goal_dismissed' || fact.type === 'goal_restored') {
    return dismissedAfter(state, fact);
  }
  return fact.type === 'goal_notice_refused' ? refusedAfter(state, fact.data) : factAfter(state, fact);
}

export function assessmentOf(facts: readonly AssessmentFact[]): AssessmentState {
  return facts.reduce((state, fact) => assessmentAfter(state, fact), unopened);
}
