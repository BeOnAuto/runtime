import { stoppedWords } from '@on.auto/api';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ranOnATestClock, relayedTo } from '../testing/relays/relayed-agent.ts';
import { servingAToolThatWaits } from '../testing/servers/waiting-server.ts';
import { runtimeConnectionTo } from './runtime-connection.ts';

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'an-agent', version: '1.0.0' } },
};

function calling(id: number, name: string, input: Readonly<Record<string, unknown>>): unknown {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: input } };
}

const checkAndOutcome = `${stoppedWords}. Look at the playbook, its definitions and its runs to see whether it did before you send it again. Auto Runtime runs again.`;

describe("a call the runtime's own endpoint holds when the server stops, through the relay", () => {
  it('reaches the agent once, as the words to check whether it took effect joined to what the recovery found', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => servingAToolThatWaits());
        const relayed = yield* relayedTo({ open: (heard) => runtimeConnectionTo(server.port, heard) });
        yield* relayed.send(initialize);
        yield* relayed.next;
        yield* relayed.send(calling(2, 'create_playbook', { playbook: 'alpha', name: 'Alpha' }));
        yield* relayed.next;

        yield* relayed.send(calling(3, 'wait_forever', { playbook: 'alpha' }));
        yield* Effect.promise(() => server.calling);
        yield* Effect.promise(() => server.stop());
        const answer = yield* relayed.next;

        expect(answer).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32_603, message: checkAndOutcome } });
        expect(relayed.recoveries()).toEqual([{ seen: 'answers', heardBefore: true }]);
        expect(relayed.reported()).toEqual([]);
      }),
    ));
});
