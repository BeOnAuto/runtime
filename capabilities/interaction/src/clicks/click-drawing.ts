import { createHash } from 'node:crypto';

import { recordedRunIn, runCorrelationIn, type RecordedRun } from '@on.auto/definitions';
import { Effect } from 'effect';

import type { KeptRequest } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { onceFor, told } from '../tellings/tellings.ts';
import type { Delivery } from './click-intake.ts';
import { drawnCallOf } from './drawn-calls.ts';

const digestLength = 16;

const mostRedraws = 3;

function drawnKey(runId: string, clickId: string, attempt: number): string {
  return `${runId}-drawn-${createHash('sha256').update(clickId).digest('hex').slice(0, digestLength)}-${String(attempt)}`;
}

export interface Drawing {
  readonly request: KeptRequest;
  readonly clickId: string;
  readonly over: boolean;
}

function versionOf(run: RecordedRun | undefined): string {
  return JSON.stringify([run?.work.length, run?.answer?.at]);
}

function drawnOnce(delivery: Delivery, { request, clickId, over }: Drawing, attempt: number): Effect.Effect<void> {
  const { parts, delivered } = delivery;
  const address = { ...delivered.playbook, id: request.runId };
  return Effect.gen(function* () {
    const call = yield* drawnCallOf(parts, address, request.row, over);
    if (call === undefined || !(yield* delivery.hold.roomForATelling)) {
      return;
    }
    const correlationId = yield* runCorrelationIn(parts.ledger, address);
    const { row, sent } = request;
    const definition = { definitionType: 'interaction', definitionName: row.function, definitionVersion: row.version };
    const telling = {
      playbook: delivered.playbook,
      filedIn: request.address,
      server: routeOfRequest(request).server,
      runId: request.runId,
      definition,
      lineage: { causationId: row.request_id, correlationId },
      conversation: sent.conversation,
      call,
    };
    const callId = over ? onceFor({ runId: request.runId, call }) : drawnKey(request.runId, clickId, attempt);
    yield* told(parts, telling, callId);
  });
}

export function redrawn(delivery: Delivery, drawing: Drawing, attempt = 0): Effect.Effect<void> {
  const address = { ...delivery.delivered.playbook, id: drawing.request.runId };
  return Effect.gen(function* () {
    const before = versionOf(yield* recordedRunIn(delivery.parts.ledger, address));
    yield* drawnOnce(delivery, drawing, attempt);
    const after = versionOf(yield* recordedRunIn(delivery.parts.ledger, address));
    if (after !== before && !drawing.over && attempt + 1 < mostRedraws) {
      yield* redrawn(delivery, drawing, attempt + 1);
    }
  });
}
