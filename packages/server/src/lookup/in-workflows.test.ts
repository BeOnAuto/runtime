import { inTurn, threadReplies } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mayChange } from '../testing/interaction-servers/call-endings.ts';
import { calling, lookingUp, threadInput, type SystemServer } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const decodeRuns = Schema.decodeUnknownSync(Schema.Struct({ runs: Schema.Array(Schema.Unknown) }));

async function runsOf(server: SystemServer, name: string): Promise<number> {
  const listed = await server.call('GET', `${alpha}/runs?type=lookup&name=${name}&limit=100`);
  return decodeRuns(listed.body).runs.length;
}

function retried(name: string): string {
  return `do:
  - ask:
      try:
        - call-it: { call: run_definition, with: { type: lookup, name: ${name}, input: {} } }
      catch:
        errors: { with: { status: 503 } }
        retry:
          delay: PT0.01S
          limit:
            attempt: { count: 2 }
`;
}

function catching(name: string): string {
  return `do:
  - ask:
      try:
        - call-it: { call: run_definition, with: { type: lookup, name: ${name}, input: {} } }
      catch:
        as: failure
        when: '\${ $failure.because == "tool_error" }'
        do:
          - note: { set: { kind: '\${ $failure.kind }', because: '\${ $failure.because }' } }
`;
}

async function endedWorkflow(server: SystemServer, name: string, steps: string) {
  return server.settled(await server.workflow(name, steps));
}

describe('a workflow that runs a lookup function in a step', () => {
  it('takes what the tool answered at read as the output of the step', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');
    const input = `{ channel: ${threadInput.channel}, thread: '${threadInput.thread}' }`;

    const ended = await endedWorkflow(
      server,
      'reading',
      `do:\n  - read: { call: run_definition, with: { type: lookup, name: thread-replies, input: ${input} } }\n`,
    );

    expect(ended).toMatchObject({ status: 'succeeded', output: threadReplies });
  });

  it('retries on status 503 what is safe to try again, a tool no longer marked reads among it, and not what is wrong', async () => {
    const server = await lookingUp();
    await server.define('unfinished', calling('denied'));
    await server.define('unworkable', calling('strict', ["    limit: '15'"]));
    await server.define('no-longer-reads', calling('search', ['    query: acme']));
    server.fake.annotateTool('search', mayChange);

    const names = ['unfinished', 'unworkable', 'no-longer-reads'];
    await inTurn(names, (name) => endedWorkflow(server, `retrying-${name}`, retried(name)));

    expect(await Promise.all(names.map((name) => runsOf(server, name)))).toEqual([3, 1, 3]);
    expect(server.fake.received().map(({ tool }) => tool)).toEqual(['denied', 'denied', 'denied', 'strict']);
  });

  it('reads the because of a tool that answered an error, after an ending that is safe to try again', async () => {
    const server = await lookingUp();
    await server.define('only-reads', calling('denied'));

    expect(await endedWorkflow(server, 'reading-errors', catching('only-reads'))).toMatchObject({
      status: 'succeeded',
      output: { kind: 'tools_unfinished', because: 'tool_error' },
    });
  });
});
