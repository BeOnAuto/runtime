import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { Effect } from 'effect';

import { reportedOnStderr, startingFor, type AgentRelaying } from '../background-start/agent-starting.ts';
import { answersOn, impatient, runningRuntime } from '../background-start/background-start.ts';
import type { Patience } from '../local-runtime/runtime-restarts.ts';
import { pingOf, runtimeConnectionTo } from '../runtime-recovery/runtime-connection.ts';
import { recovered, type Recovering } from '../runtime-recovery/runtime-recovery.ts';
import { relay } from './mcp-relay.ts';
import { relayBounds } from './relay-bounds.ts';

export async function relayedAgent(port: number, relaying: AgentRelaying): Promise<void> {
  const starting = startingFor(relaying);
  const notRunning = await runningRuntime(port, starting, impatient);
  if (notRunning !== undefined) {
    reportedOnStderr(notRunning);
  }
  const recovering: Recovering = {
    port,
    graceMs: relayBounds.graceMs,
    answering: Effect.promise(() => answersOn(port, starting)),
    runningAfter: (patience: Patience) => Effect.promise(() => runningRuntime(port, starting, patience)),
  };
  await Effect.runPromise(
    relay({
      agent: () => new StdioServerTransport(),
      runtime: (heard) => runtimeConnectionTo(port, heard),
      ping: pingOf(port),
      recover: (seen, heardBefore) => recovered(seen, heardBefore, recovering),
      report: reportedOnStderr,
      bounds: relayBounds,
    }),
  );
}
