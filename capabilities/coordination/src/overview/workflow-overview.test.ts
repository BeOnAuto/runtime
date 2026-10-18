import { readFileSync } from 'node:fs';

import { markdownOf } from '@on.auto/definitions';
import { sectionIn } from '@on.auto/definitions/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { summaryOf } from '../document/workflow-summary.ts';
import { recordingStarts, recordingWorkflows } from '../testing/recording-starts.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowOverview } from './workflow-overview.ts';

const workflows = recordingWorkflows(recordingStarts().recording);

const header = "document:\n  dsl: '1.0.3'\n  namespace: acme\n  name: flow\n  version: '1.0.0'\n";

function yamlBlocksOf(page: string): readonly string[] {
  const text = readFileSync(new URL(`../../../../docs/reference/${page}`, import.meta.url), 'utf8');
  return [...text.matchAll(/```yaml\n([\s\S]*?)```/gu)].map(([, body = '']: readonly string[]) => body);
}

function goldenOf(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

function overviewOf(source: string, name = 'flow'): string {
  return Effect.runSync(workflows.prepare(source)).overview(name);
}

const [reviewAndApprove = '', schedule = ''] = yamlBlocksOf('workflow-format.md');

const [, nextWeekOrders = ''] = yamlBlocksOf('prediction-format.md');

const [, campaignPaceTable = ''] = yamlBlocksOf('output-shapes.md');

describe('the overview of the examples of the references of workflows, prediction functions and output shapes', () => {
  it('is, byte for byte, the overview pinned beside this test for each', () => {
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

  it('enters its first step from each trigger, and says it calls no function or workflow', () => {
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
    expect(sectionIn(overview, 'What it calls')).toBe('It calls no function or workflow.\n');
  });
});

describe('the overview of a workflow that calls definitions', () => {
  it('names each definition its steps run once, with its type, and a definition named when a step runs', () => {
    const overview = overviewOf(
      [
        `${header}output:`,
        '  schema:',
        '    document: { type: object, properties: { review: { type: string } }, required: [review] }',
        'do:',
        '  - first: { call: run_definition, with: { type: reasoning, name: review-brief } }',
        '  - again: { call: run_definition, with: { type: reasoning, name: review-brief } }',
        "  - chosen: { call: run_definition, with: { type: '${ $data.type }', name: review-brief } }",
        '  - pace: { call: run_definition, with: { type: computation, name: campaign-pace } }',
      ].join('\n'),
    );

    expect(sectionIn(overview, 'What it produces')).toBe(
      '| Field | Required | What it is |\n| --- | --- | --- |\n| **review** | yes | Text. |',
    );
    expect(sectionIn(overview, 'What it calls')).toBe(
      [
        'Its steps call:',
        '- the reasoning function **review-brief**\n- the definition that its step **chosen** names when it runs\n- the computation function **campaign-pace**\n',
      ].join('\n\n'),
    );
  });
});

describe('the overview of a workflow without steps', () => {
  it('says so in one line', () => {
    const document = workflow('do: []');
    const parts = workflowOverview({ document, locate: () => ({ line: 1, column: 1 }) }, 'idle', {
      summary: summaryOf(document),
    });
    const written = markdownOf({ title: 'idle', opening: [], ...parts });

    expect(sectionIn(written, 'What it does')).toBe('It has no steps, so a run ends as it starts.');
  });
});
