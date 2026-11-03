import { readFileSync } from 'node:fs';

import { Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { standingRenderClock } from '../testing/time/stepping-clock.ts';
import { pageIn } from './page-key.ts';
import { latelyShown, resultShown, type ReadMoment } from './page-rendering.ts';

const moment: ReadMoment = { today: '2026-11-01', now: '2026-11-01T09:30:00.000Z', clock: standingRenderClock };

const succeeded = {
  status: 'succeeded',
  output: null,
  started: '2026-11-01T07:00:00.000Z',
  ended: '2026-11-01T07:02:00.000Z',
  version: 1,
} as const;

const waiting = { ...succeeded, status: 'started', output: null, ended: null } as const;

function referencePage(name: string): string {
  return readFileSync(new URL(`../../../../docs/reference/${name}`, import.meta.url), 'utf8');
}

function documentsIn(page: string): readonly string[] {
  return [...page.matchAll(/^(`{3,4})(\w+)\n([\s\S]*?)^\1$/gmu)].map(([, , , body = '']: readonly string[]) => body);
}

function pageOfTheExample(document: string, writtenIn: 'workflow' | 'function') {
  return Result.getOrThrow(
    Result.fromNullishOr(Option.getOrUndefined(Result.getOrThrow(pageIn(document, writtenIn))), () => 'no page'),
  );
}

type ExamplePage = ReturnType<typeof pageOfTheExample>;

function resultOf(page: ExamplePage) {
  return Result.getOrThrow(Result.fromNullishOr(page.templates.result, () => 'no result'));
}

function latelyOf(page: ExamplePage) {
  return Result.getOrThrow(Result.fromNullishOr(page.templates.lately, () => 'no lately'));
}

function viewsOf(page: ExamplePage) {
  return page.data?.views ?? {};
}

function chartOf(kind: string, view: Schema.Json): string {
  return `\`\`\`chart ${kind}\n${JSON.stringify(view)}\n\`\`\``;
}

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const decodeAnswering = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ answer: Schema.Json })));

const workflowFormat = referencePage('workflow-format.md');

const [reviewAndApprove = ''] = documentsIn(workflowFormat);

const pageOfTheReview = pageOfTheExample(reviewAndApprove, 'workflow');

const theReview = { type: 'workflow', name: 'review-and-approve', description: 'Reviews a brief', version: 1 };

function answered(approval: Schema.Json) {
  return { ...succeeded, output: { review: 'Ready.', approval } };
}

describe('the page of the example of the workflow format', () => {
  it('heads each run with the owner’s answer and its note, and a run that waits with whom it waits for', () => {
    const result = resultOf(pageOfTheReview);

    expect([
      resultShown(result, answered({ verdict: 'approve', note: 'Approved for the spring sale.' }), theReview, moment),
      resultShown(result, answered({ verdict: 'revise', note: 'No answer within two days' }), theReview, moment),
      resultShown(result, answered({ verdict: 'approve' }), theReview, moment),
      resultShown(result, waiting, theReview, moment),
    ]).toEqual([
      'Approved by the owner. Approved for the spring sale.',
      'Sent back for revision. No answer within two days',
      'Approved by the owner.',
      'Waiting for the owner to approve the review.',
    ]);
  });

  it('draws the briefs of each day by their verdict', () => {
    const briefs = {
      columns: [{ name: 'Day' }, { name: 'Verdict' }, { name: 'Briefs' }],
      rows: [
        ['2026-10-31', 'approve', 2],
        ['2026-10-31', 'revise', 1],
      ],
    };
    const shown = { declared: viewsOf(pageOfTheReview), subject: theReview };

    expect(latelyShown(latelyOf(pageOfTheReview), { state: 'live', views: { briefs } }, shown, moment)).toBe(
      chartOf('bars x=Day y=Briefs color=Verdict', briefs),
    );
  });
});

const interactionFormat = referencePage('interaction-format.md');

const [approveCampaignBrief = ''] = documentsIn(interactionFormat);

const [answeringTheOwner = ''] = [...interactionFormat.matchAll(/```json\n([\s\S]*?)```/gu)].map(
  ([, body = '']: readonly string[]) => body,
);

const pageOfTheApproval = pageOfTheExample(approveCampaignBrief, 'function');

const theApproval = { type: 'interaction', name: 'approve-campaign-brief', description: 'Asks the owner', version: 1 };

describe('the page of the example of the interaction format', () => {
  it('says what the owner decided and when, in the words of the format’s Its page, and whom a request waits for', () => {
    const result = resultOf(pageOfTheApproval);
    const answer = decodeAnswering(answeringTheOwner).answer;
    const decided = resultShown(
      result,
      { ...succeeded, output: answer, ended: '2026-11-01T09:00:00.000Z' },
      theApproval,
      moment,
    );

    expect([
      decided,
      resultShown(result, { ...succeeded, output: { verdict: 'revise' } }, theApproval, moment),
      resultShown(result, waiting, theApproval, moment),
    ]).toEqual([
      'Approved by the campaign owner on 2026-11-01: Ready to launch.',
      'Sent back by the campaign owner on 2026-11-01.',
      'Waiting for the campaign owner to answer in the team chat.',
    ]);
    expect(interactionFormat).toContain(`such as \`${decided}\``);
  });

  it('draws the requests still waiting and the answers of each day', () => {
    const open = { values: [{ name: 'Waiting for an answer', value: 1 }] };
    const decisions = {
      columns: [{ name: 'Day' }, { name: 'Answer' }, { name: 'Briefs' }],
      rows: [['2026-11-01', 'Approved', 1]],
    };
    const shown = { declared: viewsOf(pageOfTheApproval), subject: theApproval };

    expect(
      latelyShown(latelyOf(pageOfTheApproval), { state: 'live', views: { waiting: open, decisions } }, shown, moment),
    ).toBe([chartOf('figure', open), '', chartOf('bars x=Day y=Briefs color=Answer', decisions)].join('\n'));
  });
});

const computationFormat = referencePage('computation-format.md');

const [campaignPace = '', , paceOutput = ''] = documentsIn(computationFormat);

const pageOfThePace = pageOfTheExample(campaignPace, 'function');

const thePace = { type: 'computation', name: 'campaign-pace', description: 'Spend and pace', version: 1 };

describe('the page of the example of the computation format', () => {
  it('heads the run with the total spent, as the format says, above a row for each campaign', () => {
    const shown = resultShown(
      resultOf(pageOfThePace),
      { ...succeeded, output: decodeJson(paceOutput) },
      thePace,
      moment,
    );

    expect(shown).toBe(
      [
        '$2,630.50 spent across 2 campaigns.',
        '',
        '| Campaign | Spent | Projected | Pace |',
        '| --- | --- | --- | --- |',
        '| spring-sale | $2,230.50 | $5,762.12 | 72% of budget |',
        '| summer-launch | $400 | $1,033.33 | 34.4% of budget |',
      ].join('\n'),
    );
    expect(computationFormat).toContain(`\`${String(shown.split('\n')[0])}\``);
  });

  it('draws the spend so far of each day', () => {
    const spend = {
      unit: 'USD',
      period: 'day',
      lines: [{ name: 'Spend so far', points: [{ at: '2026-11-01', value: 2630.5 }] }],
    };
    const shown = { declared: viewsOf(pageOfThePace), subject: thePace };

    expect(latelyShown(latelyOf(pageOfThePace), { state: 'live', views: { spend } }, shown, moment)).toBe(
      chartOf('line', spend),
    );
  });
});
