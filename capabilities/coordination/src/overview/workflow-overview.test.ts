import { readFileSync } from 'node:fs';

import { markdownOf } from '@on.auto/definitions';
import { overviewAsRead, sectionIn, type HeldDefinition } from '@on.auto/definitions/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { summaryOf } from '../document/workflow-summary.ts';
import { recordingStarts, recordingWorkflows } from '../testing/recording-starts.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowOverview } from './workflow-overview.ts';

const workflows = recordingWorkflows(recordingStarts().recording);

const header = "document:\n  dsl: '1.0.3'\n  namespace: acme\n  name: flow\n  version: '1.0.0'\n";

function blocksOf(page: string, language: string): readonly string[] {
  const text = readFileSync(new URL(`../../../../docs/reference/${page}`, import.meta.url), 'utf8');
  return [...text.matchAll(new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'gu'))].map(
    ([, body = '']: readonly string[]) => body,
  );
}

function descriptionIn(page: string, block: number): string {
  return (
    /^description: (?<description>.*)$/mu.exec(blocksOf(page, 'markdown')[block] ?? '')?.groups?.['description'] ?? ''
  );
}

const heldByTheReferences: readonly HeldDefinition[] = [
  { type: 'reasoning', name: 'review-campaign-brief', description: descriptionIn('workflow-format.md', 0) },
  { type: 'interaction', name: 'approve-campaign-brief', description: descriptionIn('workflow-format.md', 1) },
  { type: 'prediction', name: 'weekly-orders', description: descriptionIn('prediction-format.md', 0) },
  { type: 'computation', name: 'campaign-pace', description: descriptionIn('computation-format.md', 0) },
];

function goldenOf(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

function overviewOf(source: string, name = 'flow'): string {
  const { summary, overview } = Effect.runSync(workflows.prepare(source));
  const details = summary.details === undefined ? {} : { details: summary.details };
  return overviewAsRead({ type: 'workflow', name, overview: overview(name), ...details }, heldByTheReferences);
}

const [reviewAndApprove = '', schedule = ''] = blocksOf('workflow-format.md', 'yaml');

const [, nextWeekOrders = ''] = blocksOf('prediction-format.md', 'yaml');

const [, campaignPaceTable = ''] = blocksOf('output-shapes.md', 'yaml');

describe('the overview of the examples of the references of workflows, prediction functions and output shapes', () => {
  it('is, byte for byte, the overview pinned beside this test for each, as read beside the functions the references save', () => {
    expect(overviewOf(reviewAndApprove, 'review-and-approve')).toBe(goldenOf('reference-example.overview.md'));
    expect(overviewOf(nextWeekOrders, 'next-week-orders')).toBe(goldenOf('prediction-example.overview.md'));
    expect(overviewOf(campaignPaceTable, 'campaign-pace-table')).toBe(goldenOf('shaped-example.overview.md'));
  });
});

describe('the overview of a workflow whose output names a shape', () => {
  it('says the shape in what it produces, in place of the fields of its schema', () => {
    const overview = overviewOf(`${header}output: { shape: text }\ndo:\n  - write: { set: { text: done } }\n`);

    expect(sectionIn(overview, 'What it produces')).toBe('It answers a **text**: Markdown of at most 65,536 bytes.');
  });
});

describe('the overview of a workflow with a schedule', () => {
  const overview = overviewOf(`${header}${schedule}do:\n  - greet: { set: { greeting: hello } }\n`);

  it('says each trigger of the schedule of the reference in words, and that a call starts it too', () => {
    expect(sectionIn(overview, 'What starts it')).toBe(
      [
        '- On an event, each time an event `com.example.brief.submitted` is published to the playbook, when `$data.priority === "high"` holds for its data',
        '- On a schedule, at 09:00 UTC from Monday to Friday',
        '- Every 15 minutes, counted from when the trigger was saved',
        '- By a call of `run_definition`, from a caller or from a step of another workflow',
      ].join('\n'),
    );
  });

  it('enters its first step from each trigger, and says nothing of what it calls, since it calls nothing', () => {
    expect(sectionIn(overview, 'What it does').split('\n').slice(2, 11)).toEqual([
      '  n1(["On com.example.brief.submitted"])',
      '  n2(["At 09:00 UTC from Monday to Friday"])',
      '  n3(["Every 15 minutes"])',
      '  n4(["By a call"])',
      '  n5["1. Set greeting"]',
      '  n1 --> n5',
      '  n2 --> n5',
      '  n3 --> n5',
      '  n4 --> n5',
    ]);
    expect(overview).not.toContain('## What it calls');
  });
});

describe('the overview of a workflow that calls definitions', () => {
  const source = [
    `${header}output:`,
    '  schema:',
    '    document: { type: object, properties: { review: { type: string } }, required: [review] }',
    'do:',
    '  - first: { call: run_definition, with: { type: reasoning, name: review-brief } }',
    '  - again: { call: run_definition, with: { type: reasoning, name: review-brief } }',
    "  - chosen: { call: run_definition, with: { type: '${ $data.type }', name: review-brief } }",
    '  - pace: { call: run_definition, with: { type: computation, name: campaign-pace } }',
  ].join('\n');

  it('says, as read, each definition its steps run once, with its type, and leaves a definition named when a step runs to that step', () => {
    const overview = overviewOf(source);

    expect(sectionIn(overview, 'What it produces')).toBe(
      '| Field | Required | What it is |\n| --- | --- | --- |\n| **review** | yes | Text. |',
    );
    expect(sectionIn(overview, 'What it calls')).toBe(
      [
        'It calls the reasoning function **Review brief**, which the playbook does not have yet.',
        'It calls the computation function **Campaign pace**: Spend, pace and projection per campaign, in cents, for a reporting period.',
      ].join('\n\n'),
    );
    expect(overview.split('\n\n## Details\n\n')[1]).toBe(
      '### What it calls\n\n- `review-brief`, a reasoning function\n- `campaign-pace`, a computation function\n',
    );
    expect(sectionIn(overview, 'What it does')).toContain(
      '3. **chosen** runs the definition its call names when it runs.',
    );
  });

  it('composes nothing of what it calls itself, since the read says it', () => {
    expect(markdownOf(Effect.runSync(workflows.prepare(source)).overview('flow'))).not.toContain('What it calls');
  });
});

describe('the overview of a workflow without steps', () => {
  it('says so in one line', () => {
    const document = workflow('do: []');
    const parts = workflowOverview({ document, locate: () => ({ line: 1, column: 1 }) }, 'idle', {
      summary: summaryOf(document),
    });
    const written = markdownOf({ title: 'idle', opening: [], ...parts });

    expect(written.endsWith('## What it does\n\nIt has no steps, so a run ends as it starts.\n')).toBe(true);
  });
});
