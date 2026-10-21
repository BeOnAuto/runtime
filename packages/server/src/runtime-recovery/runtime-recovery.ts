import { Effect, Option, Schedule } from 'effect';

import { anotherProgramOn, impatient } from '../background-start/background-start.ts';
import { probeEveryMs } from '../local-runtime/runtime-probe.ts';
import type { Patience } from '../local-runtime/runtime-restarts.ts';
import type { PingOutcome } from './runtime-ping.ts';

export type Recovery = { readonly runs: true } | { readonly runs: false; readonly words: string };

export interface Recovering {
  readonly port: number;
  readonly graceMs: number;
  readonly answering: Effect.Effect<boolean>;
  readonly runningAfter: (patience: Patience) => Effect.Effect<string | undefined>;
}

const runs: Recovery = { runs: true };

function leftAlone(words: string): Recovery {
  return { runs: false, words };
}

function askingForACredential(port: number): string {
  return `Auto Runtime on port ${port} asks for a credential, as one started with PUBLIC_URL or API_KEYS does, so this connection cannot reach it. Ask the person to stop it, or connect to it over HTTP at http://localhost:${port}/mcp as an MCP client that signs in.`;
}

function notAnswering(port: number): string {
  return `Auto Runtime on port ${port} does not answer, and this connection did not start it, so it leaves it alone. Ask the person to stop the program that holds port ${port}, then send the request again.`;
}

function afterTheStart(problem: string | undefined): Recovery {
  return problem === undefined ? runs : leftAlone(problem);
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

type Recover = (recovering: Recovering, heardBefore: boolean) => Effect.Effect<Recovery>;

const recoveries: Readonly<Record<PingOutcome, Recover>> = {
  answers: () => Effect.succeed(runs),
  refused: (recovering, heardBefore) => (heardBefore ? startedAfterAGrace(recovering) : started(recovering)),
  'asks for a credential': ({ port }) => Effect.succeed(leftAlone(askingForACredential(port))),
  'not a runtime': ({ port }) => Effect.succeed(leftAlone(anotherProgramOn(port))),
  silent: ({ port }) => Effect.succeed(leftAlone(notAnswering(port))),
};

export function recovered(seen: PingOutcome, heardBefore: boolean, recovering: Recovering): Effect.Effect<Recovery> {
  return recoveries[seen](recovering, heardBefore);
}
