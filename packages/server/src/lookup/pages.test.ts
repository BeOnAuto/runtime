import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { lookingUp } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const paging = {
  tool: 'pages',
  read: null,
  with: ["    cursor: '{{ input.cursor }}'"],
  input: ['input:', '  schema: { type: object, properties: { cursor: { type: string } } }'],
  output: ['output:', '  schema: { type: object, required: [items, next] }'],
};

const throughEveryPage = `do:
  - page:
      call: run_definition
      with: { type: lookup, name: paging, input: { cursor: '\${ $context.next ?? "" }' } }
      export:
        as: '\${ ({ items: [...($context.items ?? []), ...$data.items], next: $data.next }) }'
  - more:
      switch:
        - again:
            when: '\${ $context.next != null }'
            then: page
        - done:
            then: continue
  - all:
      set: '\${ $context.items }'
`;

const onReplies = workflowSource(
  'on-replies',
  `schedule:
  on: { one: { with: { type: run_succeeded, subject: lookup/thread-replies } } }
do:
  - noted: { set: { replies: '\${ $data[0].data.output.length }' } }
`,
);

const decodeRuns = Schema.decodeUnknownSync(
  Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String, status: Schema.String })) }),
);

describe('a workflow that reads every page of a tool that pages', () => {
  it('calls again with the cursor while there is one, each page a run of its own, keeping what it read', async () => {
    const server = await lookingUp();
    await server.define('paging', paging);

    const ended = await server.settled(await server.workflow('every-page', throughEveryPage));

    expect(ended).toMatchObject({ status: 'succeeded', output: [1, 2, 3] });
    expect(server.fake.received().map(({ arguments: given }) => given)).toEqual([{ cursor: '' }, { cursor: 'p2' }]);
  });
});

describe('what a call read and reacted to', () => {
  it('starts a workflow that listens for the run that ended', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-replies', source: onReplies } });

    await server.runCall('thread-replies');
    const [reaction] = await until(
      async () => decodeRuns((await server.call('GET', `${alpha}/runs?type=workflow&name=on-replies`)).body).runs,
      (runs) => runs.some(({ status }) => status !== 'started'),
    );

    expect(await server.settled(String(reaction?.run_id))).toMatchObject({
      status: 'succeeded',
      output: { replies: 2 },
    });
  });
});
