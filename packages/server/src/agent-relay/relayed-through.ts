import { Effect } from 'effect';

import type { AgentStarting } from '../background-start/agent-starting.ts';
import { answersOn, lookedAt, runningRuntime } from '../background-start/background-start.ts';
import { impatient } from '../local-runtime/runtime-probe.ts';
import { recovered, type Recovering } from '../runtime-recovery/runtime-recovery.ts';
import { stoppedRuntime } from '../runtime-recovery/runtime-stop.ts';
import { relay, type Relaying } from './mcp-relay.ts';
import type { RelayBounds } from './relay-bounds.ts';

/** What a relay reaches: the agent, the runtime on its port, the ping, the starting of a runtime and its report. */
export interface RelayedWiring extends Pick<Relaying, 'agent' | 'runtime' | 'ping' | 'report'> {
  readonly starting: AgentStarting;
}

export function relayedThrough(port: number, wiring: RelayedWiring, bounds: RelayBounds): Effect.Effect<void> {
  const { starting, sighting, started, log } = wiring.starting;
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
  return Effect.gen(function* () {
    const notRunning = yield* runningRuntime(port, starting, impatient);
    if (notRunning !== undefined) {
      wiring.report(notRunning.words);
    }
    yield* relay({
      agent: wiring.agent,
      runtime: wiring.runtime,
      ping: wiring.ping,
      recover: (seen, heardBefore) => recovered(seen, heardBefore, recovering),
      report: wiring.report,
      bounds,
    });
  });
}
