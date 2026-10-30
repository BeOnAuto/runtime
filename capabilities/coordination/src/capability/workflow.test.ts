import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';

let playbook: WorkflowPlaybook;

const header = `document:
  dsl: '1.0.3'
  namespace: acme
  name: greeting-flow
  version: '1.0.0'
`;

const greetingFlow = `${header}  summary: Greets someone through the echo definition, louder for friends
input:
  schema:
    document:
      type: object
      properties:
        name: { type: string }
do:
  - greet:
      call: run_definition
      with:
        type: echo
        name: greet
        input:
          name: \${ $data.name }
  - decide:
      switch:
        - friend:
            when: $data.input.name === "Ada"
            then: shout
        - stranger:
            then: end
  - shout:
      set:
        greeting: \${ $data.greeting + ", " + $data.input.name + "!" }
`;

beforeAll(async () => {
  playbook = await workflowPlaybook();
  await playbook.call(playbook.createDefinition, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
  await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'greeting-flow', source: greetingFlow });
});

afterAll(async () => {
  await playbook.close();
});

function creating(name: string, source: string) {
  return playbook.call(playbook.createDefinition, { type: 'workflow', name, source });
}

describe('creating a workflow definition', () => {
  it('stores its YAML document with its summary and input schema', async () => {
    expect(await creating('other-flow', greetingFlow)).toMatchObject({
      status: 'succeeded',
      output: {
        type: 'workflow',
        name: 'other-flow',
        version: 1,
        media_type: 'application/yaml',
        description: 'Greets someone through the echo definition, louder for friends',
        input_schema: { type: 'object', properties: { name: { type: 'string' } } },
      },
    });
  });

  it('is rejected for a document that breaks the DSL, with the line of each problem', async () => {
    expect(await creating('broken-flow', `${header}do:\n  - loop:\n      for: { each: item }\n      do: []\n`)).toEqual(
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The workflow document is not a workflow this runtime runs',
        issues: [{ detail: 'Line 8, column 12: at /do/0/loop/for: It needs in', pointer: '/source' }],
      },
    );
  });
});

describe('creating a workflow definition the runtime does not run', () => {
  it('is rejected for steps that do not connect', async () => {
    expect(
      await creating('lost-flow', `${header}do:\n  - s: { switch: [{ always: { then: nowhere } }] }\n`),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          detail:
            "Line 1, column 1: The steps of the workflow do not connect: Unable to find task to transition to 'nowhere' from 's'",
          pointer: '/source',
        },
      ],
    });
  });

  it('is rejected for tasks the policy rejects', async () => {
    expect(
      await creating(
        'fetch-flow',
        `${header}do:\n  - fetch: { call: http, with: { method: get, endpoint: https://example.com } }\n`,
      ),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          detail:
            'Line 7, column 20: at /do/0/fetch/call: call: http is not allowed: a workflow reaches the world only through its playbook functions; call run_definition',
          pointer: '/source',
        },
      ],
    });
  });
});
