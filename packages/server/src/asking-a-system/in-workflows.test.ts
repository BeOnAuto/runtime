import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { inTurn, threadReplies } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { chatKey } from '../testing/interaction-servers/chat-deliveries.ts';
import { askingASystem, calling, threadInput, type SystemServer } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const decodeRuns = Schema.decodeUnknownSync(Schema.Struct({ runs: Schema.Array(Schema.Unknown) }));

async function runsOf(server: SystemServer, name: string): Promise<number> {
  const listed = await server.call('GET', `${alpha}/runs?type=interaction&name=${name}&limit=100`);
  return decodeRuns(listed.body).runs.length;
}

function retried(name: string, caught: string): string {
  return `do:
  - ask:
      try:
        - call-it: { call: run_definition, with: { type: interaction, name: ${name}, input: {} } }
      catch:
        ${caught}
        retry:
          delay: PT0.01S
          limit:
            attempt: { count: 2 }
`;
}

const onStatus503 = 'errors: { with: { status: 503 } }';

function catching(name: string): string {
  return `do:
  - ask:
      try:
        - call-it: { call: run_definition, with: { type: interaction, name: ${name}, input: {} } }
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

describe('a workflow that asks a system in a step', () => {
  it('takes what the tool answered at read as the output of the step', async () => {
    const server = await askingASystem();
    await server.define('thread-replies');
    const input = `{ channel: ${threadInput.channel}, thread: '${threadInput.thread}' }`;

    const ended = await endedWorkflow(
      server,
      'reading',
      `do:\n  - read: { call: run_definition, with: { type: interaction, name: thread-replies, input: ${input} } }\n`,
    );

    expect(ended).toMatchObject({ status: 'succeeded', output: threadReplies });
  });

  it('retries on status 503 what is safe to try again, and neither what is wrong nor what may have changed something', async () => {
    const server = await askingASystem({
      hints: { broken: { readOnlyHint: false } },
      servers: { gone: { url: 'http://127.0.0.1:1/mcp', org: 'acme' } },
    });
    await server.define('unreachable', { ...calling('search'), server: 'gone' });
    await server.define('unlisted', calling('missing'));
    await server.define('unfinished', calling('denied'));
    await server.define('unworkable', calling('strict', ["    limit: '15'"]));
    await server.define('unknown', calling('broken'));

    const names = ['unreachable', 'unlisted', 'unfinished', 'unworkable', 'unknown'];
    await inTurn(names, (name) => endedWorkflow(server, `retrying-${name}`, retried(name, onStatus503)));

    expect(await Promise.all(names.map((name) => runsOf(server, name)))).toEqual([3, 3, 3, 1, 1]);
  });
});

describe('a workflow that names effect_unknown on purpose', () => {
  it('retries it when its catch names the type of effect_unknown, or the kind in a when', async () => {
    const server = await askingASystem({ hints: { broken: { readOnlyHint: false } } });
    await server.define('by-type', calling('broken'));
    await server.define('by-kind', calling('broken'));

    await endedWorkflow(
      server,
      'typed',
      retried('by-type', 'errors: { with: { type: https://on.auto/problems/effect_unknown } }'),
    );
    await endedWorkflow(
      server,
      'kinded',
      retried('by-kind', `errors: { with: { status: 409 } }\n        when: '\${ $error.kind == "effect_unknown" }'`),
    );

    expect([await runsOf(server, 'by-type'), await runsOf(server, 'by-kind')]).toEqual([3, 3]);
  });

  it('tells a tool that answered an error from a server that failed by because, after either ending', async () => {
    const writer = await serveFakeMcp({ bearer: chatKey, data: true, hints: { denied: { readOnlyHint: false } } });
    onTestFinished(writer.close);
    const server = await askingASystem({
      servers: { writer: { url: writer.url, headers: { Authorization: 'Bearer ${CHAT_KEY}' }, org: 'acme' } },
    });
    await server.define('only-reads', calling('denied'));
    await server.define('may-write', { ...calling('denied'), server: 'writer' });
    expect([
      await endedWorkflow(server, 'reading-errors', catching('only-reads')),
      await endedWorkflow(server, 'writing-errors', catching('may-write')),
    ]).toMatchObject([
      { status: 'succeeded', output: { kind: 'tools_unfinished', because: 'tool_error' } },
      { status: 'succeeded', output: { kind: 'effect_unknown', because: 'tool_error' } },
    ]);
  });
});
