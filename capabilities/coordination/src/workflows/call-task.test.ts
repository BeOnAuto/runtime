import { describe, expect, it } from 'vitest';

import type { DefinitionCallResult } from '../testing/run-terms.ts';
import { acmeCaller, callsIn, interpret, workflow } from '../testing/workflows.ts';

const summarizing = workflow(`
do:
  - summarize:
      call: run_definition
      with:
        type: reasoning
        name: summarize
        input:
          text: \${ $data.text }
`);

function answering(result: DefinitionCallResult) {
  return { respond: () => result };
}

describe('a call of run_definition', () => {
  it('executes the definition with the evaluated input, for the caller of the workflow, and outputs its output', async () => {
    const { ending, commands } = await interpret(summarizing, {
      input: { text: 'long' },
      ...answering({ status: 'succeeded', output: { summary: 'short' } }),
    });

    expect(ending).toEqual({ kind: 'completed', output: { summary: 'short' } });
    expect(commands[1]).toEqual({
      kind: 'call',
      call: {
        org: 'acme',
        playbook: 'alpha',
        caller: acmeCaller,
        reference: '/do/0/summarize',
        run: 1,
        type: 'reasoning',
        name: 'summarize',
        input: { text: 'long' },
      },
    });
  });
});

describe('the runs of a call', () => {
  it('are counted per task, so each run is its own run', async () => {
    const document = workflow(`
do:
  - each:
      for: { in: $data.items }
      do:
        - summarize:
            call: run_definition
            with: { type: reasoning, name: summarize, input: '\${ $item }' }
`);

    const { commands } = await interpret(document, { input: { items: ['a', 'b'] } });

    expect(callsIn(commands).map(({ reference, run }) => [reference, run])).toEqual([
      ['/do/0/each/do/0/summarize', 1],
      ['/do/0/each/do/0/summarize', 2],
    ]);
  });

  it('calls a workflow as it calls any other function, its name computed or written out', async () => {
    const document = workflow(
      'do:\n  - x: { call: run_definition, with: { type: "${ \\"workflow\\" }", name: triage } }',
    );

    const { commands } = await interpret(document);

    expect(callsIn(commands)).toEqual([expect.objectContaining({ type: 'workflow', name: 'triage' })]);
  });

  it('gives a run an empty object when it is given no input', async () => {
    const document = workflow('do:\n  - plain: { call: run_definition, with: { type: echo, name: greet } }');

    const { commands } = await interpret(document);

    expect(commands[1]).toMatchObject({ kind: 'call', call: { input: {} } });
  });
});

describe('the arguments of run_definition', () => {
  it.each([
    ['nothing', 'do:\n  - x: { call: run_definition }', 'run_definition takes with: { type, name, input }'],
    [
      'no name',
      'do:\n  - x: { call: run_definition, with: { type: echo, name: "${ 1 }" } }',
      'run_definition needs a string type and a string name',
    ],
    [
      'no type',
      'do:\n  - x: { call: run_definition, with: { type: "${ null }", name: a } }',
      'run_definition needs a string type and a string name',
    ],
  ])('are rejected when they evaluate to %s', async (_case, source, title) => {
    const { settlement, commands } = await interpret(workflow(source));

    expect(settlement).toMatchObject({ status: 'rejected', detail: `${title}, at the step x.` });
    expect(callsIn(commands)).toEqual([]);
  });

  it('are rejected when the input is larger than a run takes', async () => {
    const { settlement } = await interpret(summarizing, { input: { text: 'x'.repeat(262_200) } });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'The input of run_definition takes 262211 bytes as JSON, more than the 262144 a run takes, at the step summarize.',
    });
  });
});
