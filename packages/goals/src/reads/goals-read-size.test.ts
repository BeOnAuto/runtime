import { Buffer } from 'node:buffer';

import { goalsDocumentOf, type Contributes, type Goal } from '@on.auto/definitions/goals';
import { mostBytesLoadedInAPage } from '@on.auto/operations';
import { mostGoalsBytes } from '@on.auto/playbooks';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostDays } from '../results/judged-days.ts';
import { mostClosedShown, mostDismissedByBytes, mostInFlight, type Assessments } from './assessments-schema.ts';
import { GoalsReadSchema } from './goals-read-schema.ts';
import { goalsReadOf } from './goals-read.ts';

type AssessmentRead = NonNullable<Assessments['current']>;

type ClosedRead = Assessments['closed']['latest'][number];

type StandingWorkflow = Parameters<typeof goalsReadOf>[0]['workflows'][number];

const mostGoals = 8;

const mostMilestones = 7;

const mostTextCharacters = 200;

const widestText = '\u{1D11E}'.repeat(mostTextCharacters);

const instant = '2026-11-13T10:00:00.000Z';

const runId = '0199a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';

function filled(characters: number, most: number): string {
  return 'w'.repeat(Math.min(characters, most));
}

function goalLinesOf(index: number, characters: number): readonly string[] {
  return [
    `- id: goal-${String(index)}`,
    `  statement: ${filled(characters, 200)}`,
    '  per: request',
    '  window: { after: m-0, for: P1D, grace: PT1H }',
    '  success:',
    `    label: ${filled(characters, 200)}`,
    '    settles: at_close',
    '    target: { at_most: 1 }',
    `    passed: ${filled(characters, 40)}`,
    `    failed: ${filled(characters, 40)}`,
    '  milestones:',
    ...Array.from(
      { length: mostMilestones },
      (_, milestone) => `    - { id: m-${String(milestone)}, label: ${filled(characters, 80)}, by: auto }`,
    ),
    '  notify: { passed: now, failed: now, overdue: now, through: tell-owner }',
  ];
}

function goalsTextFilled(characters: number): string {
  return Array.from({ length: mostGoals }, (_, index) => goalLinesOf(index, characters))
    .flat()
    .join('\n');
}

function widestGoalsText(): string {
  const room = mostGoalsBytes - Buffer.byteLength(goalsTextFilled(2));
  return goalsTextFilled(2 + Math.floor(room / (mostGoals * (4 + mostMilestones))));
}

const subject = { id: widestText, title: widestText, link: widestText };

const widestDismissal = { at: '2026-11-13T10:00:00.000Z', by: '\u{1D11E}'.repeat(mostDismissedByBytes / 4) };

const window = { opens: instant, closes: instant, due: instant };

function assessmentOf({ success, milestones = [] }: Goal, index: number, dismissed = false): AssessmentRead {
  return {
    id: `0199a3b2-7c4d-7e8f-9a0b-${String(index).padStart(12, '0')}`,
    per: subject,
    window,
    rule: { settles: success.settles, target: success.target },
    milestones,
    marks: milestones.map(({ id }) => ({ milestone: id, at: instant, run: runId, says: widestText })),
    next: milestones.at(-1)?.id ?? 'none',
    measurement: {
      value: -1.234_567_890_123_456_7e308,
      final: false,
      as_of: instant,
      at: instant,
      run: runId,
      says: widestText,
    },
    final_measurement: { value: -1.234_567_890_123_456_7e308, as_of: instant, at: instant, run: runId },
    verdict: 'open',
    verdict_at: instant,
    verdict_by: 'deadline',
    overdue_since: instant,
    stopped: { at: instant, run: runId, reason: widestText },
    ...(dismissed ? { dismissed: widestDismissal } : {}),
    goals_version: 1,
    notices: (['passed', 'failed', 'overdue'] as const).map((change) => ({
      change,
      at: instant,
      run: runId,
      delivered: false,
    })),
  };
}

function closedOf(goal: Goal, index: number): ClosedRead {
  const { rule, milestones, marks, measurement, final_measurement } = assessmentOf(goal, index);
  return {
    id: `0199a3b2-7c4d-7e8f-9a0b-${String(index).padStart(12, '0')}`,
    outcome: 'no_result',
    at: instant,
    per: subject,
    window,
    value: -1.234_567_890_123_456_7e308,
    by: 'deadline',
    rule,
    milestones,
    marks: marks.map(({ milestone, at, run }) => ({ milestone, at, run })),
    ...(measurement === undefined ? {} : { measurement }),
    ...(final_measurement === undefined ? {} : { final_measurement }),
  };
}

function widestAssessmentsOf(goal: Goal, dismissed = false): Assessments {
  const counted = Object.fromEntries((goal.milestones ?? []).map(({ id }) => [id, 999_999]));
  return {
    current: assessmentOf(goal, 0, dismissed),
    open_count: 999_999,
    stopped_count: 999_999,
    dismissed_count: 999_999,
    in_flight: Array.from({ length: mostInFlight }, (_, index) => assessmentOf(goal, index + 1, dismissed)),
    by_milestone: counted,
    waiting: counted,
    closed: {
      total: 999_999,
      passed: 999_999,
      failed: 999_999,
      no_result: 999_999,
      latest: Array.from({ length: mostClosedShown }, (_, index) => closedOf(goal, index)),
      days: {
        time_zone: 'America/Argentina/ComodRivadavia',
        counts: Array.from({ length: mostDays }, () => ({
          day: '2026-11-16',
          judged: 999_999,
          passed: 999_999,
          says: widestText,
        })),
      },
      last_passed: { id: runId, at: instant },
      misses_since: { at: instant, count: 999_999 },
    },
  };
}

function workflowsServing(goals: readonly Goal[]): readonly StandingWorkflow[] {
  return goals.map(({ id }, index) => {
    const contributes: Contributes = [{ goal: id, purpose: widestText, per_id: '/id', marks: 'm-0', measures: '/n' }];
    return { name: `workflow-${String(index)}`, version: 1, paused: false, contributes };
  });
}

describe('the size of the goals read', () => {
  it('keeps sixty closed results a goal, the history of eight weeks of weekday checks', () => {
    expect(mostClosedShown).toBe(60);
  });

  it.each([
    ['no dismissed thing read', false],
    ['every open thing read dismissed, by the widest caller id the read carries', true],
  ])(
    'stays within the bytes a page of the ledger loads with eight goals at their widest, each with sixty closed results and thirty-one days, %s',
    (_, dismissed: boolean) => {
      const text = widestGoalsText();
      const { goals } = Result.getOrThrow(goalsDocumentOf(text));
      const read = goalsReadOf(
        { version: 1, source: text, goals, workflows: workflowsServing(goals), notifiers: new Set() },
        (goal) => widestAssessmentsOf(goal, dismissed),
      );
      const bytes = Buffer.byteLength(JSON.stringify(Schema.encodeUnknownSync(GoalsReadSchema)(read)));

      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(mostGoalsBytes);
      expect(Buffer.byteLength(JSON.stringify(widestDismissal.by)) - 2).toBe(mostDismissedByBytes);
      expect(read.goals.map(({ assessments }) => assessments.closed.latest.length)).toEqual(
        Array.from({ length: mostGoals }, () => mostClosedShown),
      );
      expect(bytes).toBeLessThanOrEqual(mostBytesLoadedInAPage);
    },
  );
});
