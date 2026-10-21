import type { RuntimeAction } from '@on.auto/api';
import { Effect, Function, Option, Schedule, Schema } from 'effect';

interface RuntimeRequest {
  readonly method: 'GET' | 'POST';
  readonly timeoutMs: number;
  readonly signal: Readonly<AbortSignal>;
}

export type RuntimeFetch = (address: string, request: RuntimeRequest) => Promise<Response>;

export const overTheNetwork: RuntimeFetch = (address, { method, timeoutMs, signal }) =>
  fetch(address, { method, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });

const RunningStatusSchema = Schema.Struct({
  version: Schema.String,
  pid: Schema.Number,
  instance: Schema.optionalKey(Schema.String),
  started_at: Schema.String,
  started_by: Schema.Literals(['terminal', 'agent']),
  directory: Schema.String,
  log_file: Schema.optionalKey(Schema.String),
  runs_in_flight: Schema.Number,
});

export type RunningStatus = typeof RunningStatusSchema.Type;

const HealthSchema = Schema.Struct({ status: Schema.Literal('ok') });

const isRunningStatus = Schema.is(RunningStatusSchema);

const isHealthy = Schema.is(HealthSchema);

export type Probe =
  | { readonly state: 'running'; readonly status: RunningStatus }
  | { readonly state: 'uncontrolled' }
  | { readonly state: 'foreign' }
  | { readonly state: 'down' };

const probeTimeoutMs = 2000;

export const probeEveryMs = 100;

export const stopWaitMs = 15_000;

export function runtimeAddressOf(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function bodyOf(fetch: RuntimeFetch, address: string, signal: Readonly<AbortSignal>): Promise<unknown> {
  const response = await fetch(address, { method: 'GET', timeoutMs: probeTimeoutMs, signal });
  return response.ok ? response.json().catch(Function.constVoid) : undefined;
}

async function answeringProbe(fetch: RuntimeFetch, port: number, signal: Readonly<AbortSignal>): Promise<Probe> {
  const status = await bodyOf(fetch, `${runtimeAddressOf(port)}/runtime`, signal);
  if (isRunningStatus(status)) {
    return { state: 'running', status };
  }
  return isHealthy(await bodyOf(fetch, `${runtimeAddressOf(port)}/health`, signal))
    ? { state: 'uncontrolled' }
    : { state: 'foreign' };
}

async function probed(port: number, fetch: RuntimeFetch, signal: Readonly<AbortSignal>): Promise<Probe> {
  try {
    return await answeringProbe(fetch, port, signal);
  } catch {
    return { state: 'down' };
  }
}

export function probeAt(port: number, fetch: RuntimeFetch): Effect.Effect<Probe> {
  return Effect.promise((signal) => probed(port, fetch, signal));
}

async function accepted(
  action: RuntimeAction,
  port: number,
  fetch: RuntimeFetch,
  signal: Readonly<AbortSignal>,
): Promise<boolean> {
  try {
    const response = await fetch(`${runtimeAddressOf(port)}/runtime/${action}`, {
      method: 'POST',
      timeoutMs: probeTimeoutMs,
      signal,
    });
    return response.status === 202;
  } catch {
    return false;
  }
}

export function askedTo(action: RuntimeAction, port: number, fetch: RuntimeFetch): Effect.Effect<boolean> {
  return Effect.promise((signal) => accepted(action, port, fetch, signal));
}

export function waitedFor(
  port: number,
  fetch: RuntimeFetch,
  waitMs: number,
  isWhatWeWait: (probe: Probe) => boolean,
): Effect.Effect<boolean> {
  if (waitMs <= 0) {
    return Effect.succeed(false);
  }
  return probeAt(port, fetch).pipe(
    Effect.repeat({ schedule: Schedule.spaced(probeEveryMs), until: isWhatWeWait }),
    Effect.timeoutOption(waitMs),
    Effect.map(Option.isSome),
  );
}

function isDown(probe: Probe): boolean {
  return probe.state === 'down';
}

export function stoppedWhenAsked(port: number, fetch: RuntimeFetch): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    return (yield* askedTo('stop', port, fetch)) && (yield* waitedFor(port, fetch, stopWaitMs, isDown));
  });
}
