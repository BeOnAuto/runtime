import { deferredCanceller } from '@on.auto/definitions';
import { Clock, Effect, Layer, Schema } from 'effect';

import {
  alpha,
  answeredInTime,
  askedHandle,
  clockAt,
  videoSource,
  type GatewayAnswering,
  type GenerationHarness,
} from '../testing/index.ts';
import type { GenerationsDue } from '../waiting/generations-due.ts';
import type { WaitingParts } from '../waiting/waiting-parts.ts';
import { generationsWaitingName, waitingRowFrom, type WaitingRow } from '../waiting/waiting-rows.ts';
import { numberedHarness, ran, runIdOf } from './run-outcomes.ts';

export const minute = 60_000;

export const spent = { model: 'gateway/example/short-film', own_key: true, cost_usd: 0.8 };

export const standingPath = `/v1/videos/${askedHandle}`;

export const contentPath = `${standingPath}/content`;

export const cancelReason = 'Not needed any more';

export async function flying(
  answering: GatewayAnswering = answeredInTime(),
  options: Parameters<typeof numberedHarness>[0] = {},
): Promise<GenerationHarness> {
  const playbook = numberedHarness({ answering, ...options });
  await playbook.define('flight', videoSource);
  await ran(playbook, 'flight', {}, 1);
  return playbook;
}

export async function waitingRowIn(playbook: GenerationHarness, index = 1): Promise<WaitingRow> {
  const [kept] = await Effect.runPromise(
    playbook.ledger.service.readProjectedRows(generationsWaitingName, alpha, {
      where: [{ column: 'row_key', equals: runIdOf(index) }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
  );
  return waitingRowFrom(kept?.row);
}

const RunSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({
    status: Schema.String,
    output: Schema.optionalKey(Schema.Unknown),
    record: Schema.optionalKey(Schema.Unknown),
    rejection: Schema.optionalKey(Schema.Unknown),
  }),
});

const decodeRun = Schema.decodeUnknownSync(RunSchema);

export async function runIn(playbook: GenerationHarness, index = 1) {
  return decodeRun(await playbook.runOf(runIdOf(index))).output;
}

const RejectedSchema = Schema.Struct({ rejection: Schema.Struct({ detail: Schema.String }) });

export async function rejectionIn(playbook: GenerationHarness): Promise<string> {
  return Schema.decodeUnknownSync(RejectedSchema)(await runIn(playbook)).rejection.detail;
}

export async function polledUntilTheDeadline(playbook: GenerationHarness, polls = 0): Promise<number> {
  const { poll_due_at: due } = await waitingRowIn(playbook);
  return due === null ? polls : polledUntilTheDeadline(playbook, polls + (await playbook.pollAt(due)));
}

export function pathsAsked(playbook: GenerationHarness): readonly string[] {
  return playbook.gateway.asked().map(({ path }) => path);
}

export function contentsAsked(playbook: GenerationHarness): readonly string[] {
  return pathsAsked(playbook).filter((path) => path.endsWith('/content'));
}

export function making(progress: number) {
  return { id: askedHandle, status: 'in_progress', progress };
}

export function failedWith(code: string) {
  return { id: askedHandle, status: 'failed', error: { code, message: 'no' } };
}

export function contentAnswering(content: () => Response | Promise<Response>): GatewayAnswering {
  return answeredInTime({ standings: [{ id: askedHandle, status: 'completed' }], content });
}

export function answeringAfter(polls: number, then: GatewayAnswering): GatewayAnswering {
  const asked = { polls: 0 };
  const inTime = answeredInTime();
  return (seen) => {
    const standing = seen.path === standingPath;
    asked.polls += standing ? 1 : 0;
    return standing && asked.polls <= polls ? then(seen) : inTime(seen);
  };
}

export interface Held {
  readonly answering: GatewayAnswering;
  readonly asked: Promise<void>;
  readonly release: () => void;
}

export function heldAt(path: string, answering: GatewayAnswering): Held {
  const gate = Promise.withResolvers<void>();
  const asked = Promise.withResolvers<void>();
  return {
    answering: async (seen) => {
      if (seen.path === path) {
        asked.resolve();
        await gate.promise;
      }
      return answering(seen);
    },
    asked: asked.promise,
    release: () => {
      gate.resolve();
    },
  };
}

export function cancelled(playbook: GenerationHarness): Promise<void> {
  return Effect.runPromise(
    deferredCanceller([playbook.capability], playbook.ledger.service)(
      { ...alpha, id: runIdOf(1) },
      { kind: 'requested', reason: cancelReason, by: 'acme-admin' },
      { causationId: null, correlationId: runIdOf(1) },
    ),
  );
}

export function partsOf(playbook: GenerationHarness, ledger: WaitingParts['ledger'] = playbook.ledger.service) {
  return {
    ledger,
    gateways: [playbook.gateway.settings],
    fetch: playbook.gateway.fetch,
    content: playbook.ledger.service.content,
  };
}

export function polledBy(work: GenerationsDue, now: number, times = 1): Promise<number> {
  return Effect.runPromise(
    Effect.flatMap(work.due(now, 10, true), (items) =>
      Effect.as(
        Effect.forEach(Array.from({ length: times }, () => items).flat(), (item) => item.perform(now), {
          concurrency: 'unbounded',
          discard: true,
        }),
        items.length,
      ),
    ).pipe(
      Effect.provide(
        Layer.succeed(
          Clock.Clock,
          clockAt(() => now),
        ),
      ),
    ),
  );
}
