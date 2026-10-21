import type { StartedBy } from '@on.auto/api';
import { Effect, Option, Schedule } from 'effect';

import { anotherProgramOn, impatient, type NotRunning } from '../background-start/background-start.ts';
import type { Sighted } from '../background-start/sighting.ts';
import type { StartedRuntime } from '../background-start/started-runtimes.ts';
import { probeEveryMs } from '../local-runtime/runtime-probe.ts';
import type { Patience } from '../local-runtime/runtime-restarts.ts';
import type { PingOutcome } from './runtime-ping.ts';

export type Recovery = { readonly runs: true } | ({ readonly runs: false } & NotRunning);

export interface Recovering {
  readonly port: number;
  readonly graceMs: number;
  readonly answering: Effect.Effect<boolean>;
  readonly runningAfter: (patience: Patience) => Effect.Effect<NotRunning | undefined>;
  readonly sighted: () => Sighted | undefined;
  readonly lookedAgain: Effect.Effect<Sighted | undefined>;
  readonly startedHere: (instance?: string) => StartedRuntime | undefined;
  readonly stopped: (runtime: StartedRuntime) => Effect.Effect<boolean>;
}

const runs: Recovery = { runs: true };

function leftAlone(words: string): Recovery {
  return { runs: false, words };
}

function askingForACredential(port: number): string {
  return `Auto Runtime on port ${port} asks for a credential, as one started with PUBLIC_URL or API_KEYS does, so this connection cannot reach it. Ask the person to stop it, or connect to it over HTTP at http://localhost:${port}/mcp as an MCP client that signs in.`;
}

const notAnsweringWhenStarted: Readonly<Record<StartedBy, (port: number, pid: number) => string>> = {
  terminal: (port, pid) =>
    `Auto Runtime on port ${port} does not answer. It was started in a terminal, as process ${pid}, so this connection leaves it alone: ask the person to stop it there with Ctrl+C, or to end process ${pid}, then send the request again.`,
  agent: (port, pid) =>
    `Auto Runtime on port ${port} does not answer. Another connection started it, as process ${pid}, so this one leaves it alone: ask the person to end process ${pid}, then send the request again.`,
};

function notAnswering(port: number, sighting: Sighted | undefined): string {
  return sighting === undefined
    ? `Auto Runtime on port ${port} does not answer, and this connection did not start it, so it leaves it alone. Ask the person to stop the program that holds port ${port}, then send the request again.`
    : notAnsweringWhenStarted[sighting.startedBy](port, sighting.pid);
}

function notStopped(port: number, pid: number | undefined): string {
  return `Auto Runtime on port ${port} does not answer, and process ${String(pid)}, which this connection started, did not end even after SIGKILL. Ask the person to end it, then send the request again.`;
}

function afterTheStart(notRunning: NotRunning | undefined): Recovery {
  return notRunning === undefined ? runs : { runs: false, ...notRunning };
}

function started({ runningAfter }: Recovering): Effect.Effect<Recovery> {
  return runningAfter(impatient).pipe(Effect.map(afterTheStart));
}

function answeredWithinTheGrace({ answering, graceMs }: Recovering): Effect.Effect<boolean> {
  return answering.pipe(
    Effect.repeat({ schedule: Schedule.spaced(probeEveryMs), until: (answers) => answers }),
    Effect.timeoutOption(graceMs),
    Effect.map(Option.isSome),
  );
}

function startedAfterAGrace(recovering: Recovering): Effect.Effect<Recovery> {
  return answeredWithinTheGrace(recovering).pipe(
    Effect.flatMap((answers) => (answers ? Effect.succeed(runs) : started(recovering))),
  );
}

function replacedIfOwn(recovering: Recovering): Effect.Effect<Recovery> {
  const own = recovering.startedHere(recovering.sighted()?.instance);
  if (own === undefined) {
    return recovering.lookedAgain.pipe(Effect.map((sighting) => leftAlone(notAnswering(recovering.port, sighting))));
  }
  return recovering
    .stopped(own)
    .pipe(
      Effect.flatMap((stopped) =>
        stopped ? started(recovering) : Effect.succeed(leftAlone(notStopped(recovering.port, own.pid))),
      ),
    );
}

type Recover = (recovering: Recovering, heardBefore: boolean) => Effect.Effect<Recovery>;

const recoveries: Readonly<Record<PingOutcome, Recover>> = {
  answers: () => Effect.succeed(runs),
  refused: (recovering, heardBefore) => (heardBefore ? startedAfterAGrace(recovering) : started(recovering)),
  'asks for a credential': ({ port }) => Effect.succeed(leftAlone(askingForACredential(port))),
  'not a runtime': ({ port }) => Effect.succeed(leftAlone(anotherProgramOn(port))),
  silent: replacedIfOwn,
};

export function recovered(seen: PingOutcome, heardBefore: boolean, recovering: Recovering): Effect.Effect<Recovery> {
  return recoveries[seen](recovering, heardBefore);
}
