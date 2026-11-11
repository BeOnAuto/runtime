import { runCorrelationIn } from '@on.auto/definitions';
import type { PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import type { IntakeParts } from '../replies/reply-recorder.ts';
import { answeredAlreadyTellingOf, type IntakeState } from '../replies/reply-recording.ts';
import type { KeptRequest, Reply } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { told } from './tellings.ts';

export interface LateReply {
  readonly parts: IntakeParts;
  readonly playbook: PlaybookAddress;
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly causationId: string;
  readonly roomForATelling: Effect.Effect<boolean>;
}

export function toldAnsweredAlready(late: LateReply, state: IntakeState): Effect.Effect<void> {
  const { parts, playbook, request, causationId, roomForATelling } = late;
  const { runId, row, sent } = request;
  return Effect.gen(function* () {
    const call = yield* answeredAlreadyTellingOf(parts.ledger, playbook, state, late);
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
