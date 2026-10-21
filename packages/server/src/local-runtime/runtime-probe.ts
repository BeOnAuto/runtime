import { Function, Schema } from 'effect';

interface RuntimeRequest {
  readonly method: 'GET' | 'POST';
  readonly timeoutMs: number;
}

export type RuntimeFetch = (address: string, request: RuntimeRequest) => Promise<Response>;

export const overTheNetwork: RuntimeFetch = (address, { method, timeoutMs }) =>
  fetch(address, { method, signal: AbortSignal.timeout(timeoutMs) });

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

export function runtimeAddressOf(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function bodyOf(fetch: RuntimeFetch, address: string): Promise<unknown> {
  const response = await fetch(address, { method: 'GET', timeoutMs: probeTimeoutMs });
  return response.ok ? response.json().catch(Function.constVoid) : undefined;
}

async function answeringProbe(fetch: RuntimeFetch, port: number): Promise<Probe> {
  const status = await bodyOf(fetch, `${runtimeAddressOf(port)}/runtime`);
  if (isRunningStatus(status)) {
    return { state: 'running', status };
  }
  return isHealthy(await bodyOf(fetch, `${runtimeAddressOf(port)}/health`))
    ? { state: 'uncontrolled' }
    : { state: 'foreign' };
}

export async function probeAt(port: number, fetch: RuntimeFetch): Promise<Probe> {
  try {
    return await answeringProbe(fetch, port);
  } catch {
    return { state: 'down' };
  }
}

export async function askedTo(action: 'stop' | 'restart', port: number, fetch: RuntimeFetch): Promise<boolean> {
  try {
    const response = await fetch(`${runtimeAddressOf(port)}/runtime/${action}`, {
      method: 'POST',
      timeoutMs: probeTimeoutMs,
    });
    return response.status === 202;
  } catch {
    return false;
  }
}

export interface Waiting {
  readonly fetch: RuntimeFetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export const probeEveryMs = 100;

export async function waitedFor(
  port: number,
  waiting: Waiting,
  attempts: number,
  isWhatWeWait: (probe: Probe) => boolean,
): Promise<boolean> {
  if (attempts <= 0) {
    return false;
  }
  if (isWhatWeWait(await probeAt(port, waiting.fetch))) {
    return true;
  }
  await waiting.sleep(probeEveryMs);
  return waitedFor(port, waiting, attempts - 1, isWhatWeWait);
}

const stopAttempts = 150;

function isDown(probe: Probe): boolean {
  return probe.state === 'down';
}

export async function stoppedWhenAsked(port: number, waiting: Waiting): Promise<boolean> {
  return (await askedTo('stop', port, waiting.fetch)) && (await waitedFor(port, waiting, stopAttempts, isDown));
}
