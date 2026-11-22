import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { Effect } from 'effect';

import { reportedOnStderr, startingFor, type AgentRelaying } from '../background-start/agent-starting.ts';
import { pingOf, runtimeConnectionTo } from '../runtime-recovery/runtime-connection.ts';
import { relayBounds, type RelayBounds } from './relay-bounds.ts';
import { relayedThrough } from './relayed-through.ts';

export function relayedAgent(port: number, relaying: AgentRelaying, bounds: RelayBounds = relayBounds): Promise<void> {
  return Effect.runPromise(
    relayedThrough(
      port,
      {
        agent: () => new StdioServerTransport(),
        runtime: (heard) => runtimeConnectionTo(port, heard),
        ping: pingOf(port),
        starting: startingFor(relaying),
        report: reportedOnStderr,
      },
      bounds,
    ),
  );
}
