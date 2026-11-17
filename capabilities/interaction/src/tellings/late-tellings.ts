import { runCorrelationIn } from '@on.auto/definitions';
import type { PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { answeredAlreadyTellingOf, type IntakeState } from '../replies/reply-recording.ts';
import type { KeptRequest, Reply } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { toldOnceAnswered, type TellingHold } from './due-tellings.ts';
import { toldUnknowingly } from './own-messages.ts';
import { told } from './tellings.ts';

export interface LateReply {
  readonly parts: DeliveryParts;
  readonly playbook: PlaybookAddress;
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly causationId: string;
  readonly roomForATelling: Effect.Effect<boolean>;
}

interface TakenAnswer {
  readonly parts: DeliveryParts;
  readonly playbook: PlaybookAddress;
  readonly request: KeptRequest;
  readonly answeredAt: number;
  readonly hold: TellingHold;
}

export function answerTold({ parts, playbook, request, answeredAt, hold }: TakenAnswer): Effect.Effect<boolean> {
  const address = { ...playbook, id: request.runId };
  return Effect.gen(function* () {
    const knownBefore = !(yield* toldUnknowingly(parts.ledger, playbook, request.runId));
    const toldInFull = yield* toldOnceAnswered(parts, { address, answeredAt, hold });
    return knownBefore && toldInFull;
  });
}

export function toldAnsweredAlready(late: LateReply, state: IntakeState): Effect.Effect<void> {
  const { parts, playbook, request, causationId, roomForATelling } = late;
  const { runId, row, sent } = request;
  return Effect.gen(function* () {
    const call = yield* answeredAlreadyTellingOf(parts, playbook, state, late);
    if (call === undefined || !(yield* roomForATelling)) {
      return;
    }
    const correlationId = yield* runCorrelationIn(parts.ledger, { ...playbook, id: runId });
    const definition = { definitionType: 'interaction', definitionName: row.function, definitionVersion: row.version };
    const telling = {
      playbook,
      server: routeOfRequest(request).server,
      runId,
      definition,
      lineage: { causationId, correlationId },
      conversation: sent.conversation,
      call,
    };
    yield* told(parts, telling, `${runId}-answered-line`);
  });
}
