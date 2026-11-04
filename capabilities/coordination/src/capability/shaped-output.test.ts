import { readFileSync } from 'node:fs';

import { shapeNamed } from '@on.auto/definitions/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';

let playbook: WorkflowPlaybook;

const header = `document:
  dsl: '1.0.3'
  namespace: acme
  name: hours
  version: '1.0.0'
`;

function counting(
  values: string,
  output = 'output:\n  shape: categories\n  as: \'${ ({ unit: "hours", values: $data.values }) }\'',
): string {
  return `${header}${output}\ndo:\n  - count:\n      set:\n        values: ${values}\n`;
}

const inShape = counting('[{ name: North, value: 4, low: 3 }, { name: South, value: 2 }]');

const outOfShape = counting('[{ name: North, value: 4 }, { name: North, value: 2, high: 1 }]');

const page = readFileSync(new URL('../../../../docs/reference/output-shapes.md', import.meta.url), 'utf8');

const [, [, campaignPaceTable = ''] = []] = [...page.matchAll(/```yaml\n([\s\S]*?)```/gu)];

function creating(name: string, source: string) {
  return playbook.call(playbook.createDefinition, { type: 'workflow', name, source });
}

function ran(name: string, runId: string) {
  return playbook.call(playbook.runDefinition, { type: 'workflow', name, run_id: runId });
}

function refusedWith(detail: string) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    issues: [{ pointer: '/source', detail }],
  };
}

beforeAll(async () => {
  playbook = await workflowPlaybook();
  await creating('hours-in-shape', inShape);
  await creating('hours-out-of-shape', outOfShape);
});

afterAll(async () => {
  await playbook.close();
});

describe('a workflow whose output names a shape', () => {
  it('publishes the schema of the shape as its output schema, and the shape in its details', async () => {
    expect(await creating('hours-published', inShape)).toMatchObject({
      status: 'succeeded',
      output: { output_schema: shapeNamed('categories').schema, details: { shape: 'categories' } },
    });
  });

  it('is saved as the reference of output shapes gives it, with its expressions checked', async () => {
    expect(await creating('campaign-pace-table', campaignPaceTable)).toMatchObject({
      status: 'succeeded',
      output: { output_schema: shapeNamed('table').schema, details: { shape: 'table' } },
    });
  });
});

describe('a workflow whose output names a shape it cannot have', () => {
  it('is refused beside a schema of its own', async () => {
    expect(
      await creating(
        'beside-a-schema',
        counting('[]', 'output:\n  shape: table\n  schema:\n    document: { type: object }'),
      ),
    ).toMatchObject(
      refusedWith(
        "Line 9, column 5: at /output/schema: An output that names a shape takes no schema: the shape's schema is its schema",
      ),
    );
  });

  it('is refused for a name no shape has', async () => {
    expect(await creating('no-such-shape', counting('[]', 'output:\n  shape: chart'))).toMatchObject(
      refusedWith(
        'Line 7, column 10: at /output/shape: Expected the name of a shape: series, categories, table, or text',
      ),
    );
  });

  it('is refused on a task, where the DSL has no shape', async () => {
    expect(
      await creating(
        'on-a-task',
        `${header}do:\n  - count:\n      set: { values: [] }\n      output: { shape: table }\n`,
      ),
    ).toMatchObject(
      refusedWith('Line 9, column 15: at /do/0/count/output: It has shape, which the DSL does not know here'),
    );
  });
});

describe('the run of a workflow whose output names a shape', () => {
  it('ends with its output when the output is in the shape', async () => {
    const runId = '0199a3c4-7d2e-7c1a-9b3f-4444444444a1';
    await ran('hours-in-shape', runId);

    expect(await playbook.settled(runId)).toMatchObject({
      output: {
        status: 'succeeded',
        output: {
          unit: 'hours',
          values: [
            { name: 'North', value: 4, low: 3 },
            { name: 'South', value: 2 },
          ],
        },
      },
    });
  });

  it('ends as a conflict of the kind unworkable, naming its issues, when the output is not in the shape', async () => {
    const runId = '0199a3c4-7d2e-7c1a-9b3f-4444444444a2';
    await ran('hours-out-of-shape', runId);

    expect(await playbook.settled(runId)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'conflict',
          kind: 'unworkable',
          detail:
            'The output of the workflow does not match the shape categories: /values/1/name: Expected a name no value before it has; /values/1/high: Expected a high of at least the value.',
        },
      },
    });
  });
});

describe('the run of a workflow whose output names no shape', () => {
  it('ends with its output, whatever its output schema says', async () => {
    const runId = '0199a3c4-7d2e-7c1a-9b3f-4444444444a3';
    await creating(
      'hours-unshaped',
      counting('[1]', 'output:\n  schema:\n    document: { type: object, required: [unit] }'),
    );
    await ran('hours-unshaped', runId);

    expect(await playbook.settled(runId)).toMatchObject({
      output: { status: 'succeeded', output: { values: [1] } },
    });
  });
});
