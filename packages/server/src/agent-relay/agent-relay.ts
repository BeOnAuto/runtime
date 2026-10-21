import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { Effect } from 'effect';

import { reportedOnStderr, startingFor, type AgentRelaying } from '../background-start/agent-starting.ts';
import { answersOn, impatient, lookedAt, runningRuntime } from '../background-start/background-start.ts';
import { pingOf, runtimeConnectionTo } from '../runtime-recovery/runtime-connection.ts';
import { recovered, type Recovering } from '../runtime-recovery/runtime-recovery.ts';
import { stoppedRuntime } from '../runtime-recovery/runtime-stop.ts';
import { relay } from './mcp-relay.ts';
import { relayBounds, type RelayBounds } from './relay-bounds.ts';

export function relayedAgent(port: number, relaying: AgentRelaying, bounds: RelayBounds = relayBounds): Promise<void> {
  const { starting, sighting, started, log } = startingFor(relaying);
  const recovering: Recovering = {
    port,
    graceMs: bounds.graceMs,
    answering: answersOn(port, starting),
    runningAfter: (patience) => runningRuntime(port, starting, patience),
    sighted: () => sighting.last(),
    lookedAgain: lookedAt(port, starting).pipe(Effect.map(() => sighting.last())),
    startedHere: (instance) => started.living(instance),
    stopped: (runtime) => stoppedRuntime(runtime, bounds, log),
  };
  return Effect.runPromise(
    Effect.gen(function* () {
      const notRunning = yield* runningRuntime(port, starting, impatient);
      if (notRunning !== undefined) {
        reportedOnStderr(notRunning.words);
      }
      yield* relay({
        agent: () => new StdioServerTransport(),
        runtime: (heard) => runtimeConnectionTo(port, heard),
        ping: pingOf(port),
        recover: (seen, heardBefore) => recovered(seen, heardBefore, recovering),
        report: reportedOnStderr,
        bounds,
      });
    }),
  );
}
