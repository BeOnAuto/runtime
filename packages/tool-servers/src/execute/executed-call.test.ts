import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallReply } from '../calls/call-replies.ts';
import type { OfferedTool } from '../calls/offered-tools.ts';
import type { RunTools } from '../calls/run-tools.ts';
import { playbookToolCalls, reportingAccess } from '../testing/index.ts';

function noEnding(): undefined {
  return undefined;
}

function runToolsOffering(offered: readonly OfferedTool[]): RunTools {
  return {
    offered,
    keepsContent: true,
    argumentsDigest: () => 'a'.repeat(64),
    scrubJson: (json) => json,
    callsEnded: () => false,
    ended: new AbortController().signal,
    ending: noEnding,
    calledAny: () => false,
    calledOnlyReadOnly: () => true,
    usedInWords: () => 'no tool',
    answeredBytes: () => 0,
    close: () => Promise.resolve(),
  };
}

const unsent: CallReply = {
  text: 'The run has ended, so this call was not sent.',
  isError: true,
  outcome: 'not_sent',
  resultBytes: null,
  durationMs: 0,
  serverRequestId: null,
};

const search: OfferedTool = {
  name: 'graph__search',
  reference: { server: 'graph', tool: 'search' },
  server: { type: 'mcp', connection: null },
  description: 'Finds the rows of the graph that match a query.',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
  readOnly: true,
  start: ({ callId }) =>
    Promise.resolve({ call_id: callId, server: 'graph', tool: 'search', arguments_bytes: 2, read_only: true }),
  send: () =>
    Promise.resolve({
      ended: { type: 'tool_call_failed', data: { because: 'cancelled', duration_ms: 0, jsonrpc_id: null } },
      reply: { text: unsent.text, isError: true },
    }),
  call: () => Promise.resolve(unsent),
};

function executingOver(tools: RunTools) {
  const { access } = reportingAccess({});
  return playbookToolCalls({ ...access, open: () => Effect.succeed(tools) });
}

describe('a call answered by tools that do not behave as a server’s do', () => {
  it('refuses a tool the opened tools do not offer as one its server does not list', async () => {
    const { call } = executingOver(runToolsOffering([]));

    expect(await call('execute', { server: 'graph', tool: 'search' })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'tool_not_offered',
      because: 'tool_not_listed',
      detail: 'The tool server graph does not list the tool search',
    });
  });

  it('fails with an incident when the call answers that it was never sent, which a call that was sent never does', async () => {
    const { call, incidents } = executingOver(runToolsOffering([search]));

    expect(await call('execute', { server: 'graph', tool: 'search' })).toMatchObject({ status: 'failed' });
    expect(String(incidents()[0]?.original)).toContain('answered not_sent');
  });
});
