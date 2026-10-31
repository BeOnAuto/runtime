import { describe, expect, it } from 'vitest';

import type { Capability } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

function echoing(type: string): Capability {
  return { ...echo, type };
}

const { createDefinition, getDefinition, listDefinitions, updateDefinition } = definitionOperationsFor([
  echoing('computation'),
  echoing('workflow'),
  echo,
]);

const toAlpha = toPlaybook('acme', 'alpha');

const hello = '{"greeting": "Hello"}';

const howItGreets = 'flowchart LR\n  guest[A guest arrives] --> greet[Greet them]';

function creating(input: object) {
  return harness().call(createDefinition, toAlpha(acmeAdmin, { name: 'greet', source: hello, ...input }));
}

function refusedAtTheDiagram(detail: string) {
  return { status: 'rejected', reason: 'invalid_input', detail, issues: [{ detail, pointer: '/diagram' }] };
}

const sayWhether =
  'Say whether this computation function has a diagram: give diagram as Mermaid source of a flowchart or a state diagram, or the word none when a picture would add nothing';

const notADiagram = {
  status: 'rejected',
  reason: 'invalid_input',
  detail: 'The input does not match the input schema',
  issues: [
    {
      detail:
        'Expected Mermaid source of a flowchart or a state diagram, whose first line is flowchart, graph or stateDiagram, or the word none',
      pointer: '/diagram',
    },
  ],
};

describe('the diagram of a function', () => {
  it('is required, so that its author says whether a picture shows how it works', async () => {
    expect(await creating({ type: 'computation' })).toEqual(refusedAtTheDiagram(sayWhether));
  });

  it('is Mermaid source of a flowchart or a state diagram, kept as written and answered with the definition', async () => {
    expect(await creating({ type: 'computation', diagram: howItGreets })).toMatchObject({
      status: 'succeeded',
      output: { type: 'computation', version: 1, diagram: howItGreets },
    });
  });

  it('is the word none when a picture would add nothing, kept as the choice its author made', async () => {
    expect(await creating({ type: 'computation', diagram: 'none' })).toMatchObject({
      status: 'succeeded',
      output: { diagram: 'none' },
    });
  });

  it('starts with flowchart, graph or stateDiagram, after any blank lines, with a direction or none', async () => {
    const accepted = [
      'flowchart',
      'graph TD',
      'flowchart TB;\n  a --> b',
      '\n\n  graph LR\n  a --> b',
      'flowchart RL  \r\n  a --> b',
      'Flowchart bt\n  a --> b',
      'stateDiagram\n  [*] --> Waiting',
      'stateDiagram-v2\n  [*] --> Waiting',
    ];
    const refused = [
      'None',
      'sequenceDiagram\n  a ->> b: hello',
      'flowchart TD a --> b',
      'flowchart sideways\n  a --> b',
      '```mermaid\nflowchart LR\n  a --> b\n```',
      '',
    ];

    const statuses = await Promise.all(
      accepted.map(async (diagram) => (await creating({ type: 'computation', diagram })).status),
    );
    const refusals = await Promise.all(refused.map((diagram) => creating({ type: 'computation', diagram })));

    expect(statuses).toEqual(accepted.map(() => 'succeeded'));
    expect(refusals).toEqual(refused.map(() => notADiagram));
  });
});

describe('the bounds of a diagram', () => {
  it('holds at most 8192 bytes in UTF-8, whatever its length in characters', async () => {
    const tooLong = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ detail: 'Expected a diagram of at most 8192 bytes in UTF-8', pointer: '/diagram' }],
    };
    const header = 'flowchart LR\n';

    expect(await creating({ type: 'computation', diagram: header.padEnd(8192, 'a') })).toMatchObject({
      status: 'succeeded',
    });
    expect(await creating({ type: 'computation', diagram: `${header}${'é'.repeat(4089)}` })).toMatchObject({
      status: 'succeeded',
    });
    expect(await creating({ type: 'computation', diagram: header.padEnd(8193, 'a') })).toEqual(tooLong);
    expect(await creating({ type: 'computation', diagram: `${header}${'é'.repeat(4090)}` })).toEqual(tooLong);
  });

  it('is answered by get_definition and left out of list_definitions', async () => {
    const { call } = harness();
    await call(
      createDefinition,
      toAlpha(acmeAdmin, { type: 'computation', name: 'greet', source: hello, diagram: howItGreets }),
    );

    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'computation', name: 'greet' }))).toMatchObject({
      output: { diagram: howItGreets },
    });
    const listed = await call(listDefinitions, toAlpha(acmeAdmin, { type: 'computation' }));

    expect(listed).toMatchObject({ output: { definitions: [{ name: 'greet' }] } });
    expect(JSON.stringify(listed)).not.toContain('"diagram"');
  });
});

describe('a definition that is not a function', () => {
  it('takes no diagram, since Auto Studio draws a workflow from its steps', async () => {
    expect(await creating({ type: 'workflow', diagram: howItGreets })).toEqual(
      refusedAtTheDiagram(
        'A workflow takes no diagram, since Auto Studio draws a workflow from its steps; leave diagram out',
      ),
    );
    expect(await creating({ type: 'workflow', diagram: 'none' })).toMatchObject({ status: 'rejected' });
    const created = await creating({ type: 'workflow' });

    expect(created).toMatchObject({ status: 'succeeded' });
    expect(JSON.stringify(created)).not.toContain('"diagram"');
  });

  it('of another type takes none either, since only a function has one', async () => {
    expect(await creating({ type: 'echo', diagram: 'none' })).toEqual(
      refusedAtTheDiagram('An echo definition takes no diagram, since only a function has one; leave diagram out'),
    );
    expect(await creating({ type: 'echo' })).toMatchObject({ status: 'succeeded' });
  });
});

async function updated(changes: object) {
  const { call } = harness();
  await call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'computation', name: 'greet', source: hello, diagram: 'none' }),
  );
  return call(updateDefinition, toAlpha(acmeAdmin, { type: 'computation', name: 'greet', source: hello, ...changes }));
}

describe('the diagram update_definition takes', () => {
  it('is given again with every update of a function', async () => {
    expect(await updated({})).toEqual(refusedAtTheDiagram(sayWhether));
  });

  it('makes a new version when it changes, and records nothing when it and the document are as saved', async () => {
    expect(await updated({ diagram: howItGreets })).toMatchObject({
      status: 'succeeded',
      output: { version: 2, diagram: howItGreets },
    });
    expect(await updated({ diagram: 'none' })).toMatchObject({
      status: 'succeeded',
      output: { version: 1, diagram: 'none' },
    });
  });

  it('is refused for a workflow, as when it is created', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'greet', source: hello }));

    expect(
      await call(
        updateDefinition,
        toAlpha(acmeAdmin, { type: 'workflow', name: 'greet', source: hello, diagram: 'none' }),
      ),
    ).toMatchObject({ status: 'rejected', issues: [{ pointer: '/diagram' }] });
  });
});
