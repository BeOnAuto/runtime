import { runCorrelationIn } from '@on.auto/definitions';
import { Effect } from 'effect';

import type { AnswerSet, ReplyRefused } from '../facts/run-facts.ts';
import { clickRule } from '../facts/work-rules.ts';
import { recordedReplyWork } from '../replies/reply-recorder.ts';
import { recordedWork } from '../schedule/request-ledger.ts';
import { intakeOf, replyOf, type Clicked, type Delivery } from './click-intake.ts';

export function setRecorded(delivery: Delivery, { request, click, sets }: Clicked) {
  const { parts, delivered } = delivery;
  const address = { ...delivered.playbook, id: request.runId };
  const fact: AnswerSet = {
    type: 'answer_set',
    data: { click: { id: click.id, sender: click.sender }, action: click.action, parts: sets },
  };
  return Effect.flatMap(runCorrelationIn(parts.ledger, address), (correlationId) =>
    recordedWork(
      parts.record,
      address,
      { work: { type: 'work', fact }, rule: clickRule(click.id) },
      { causationId: request.row.request_id, correlationId },
    ),
  );
}

export function unknownButtonRecorded(delivery: Delivery, { request, click }: Omit<Clicked, 'sets'>) {
  const { arrival } = intakeOf(delivery, request);
  const reply = replyOf(request, click);
  const fact: ReplyRefused = {
    type: 'reply_refused',
    data: {
      server: arrival.server,
      tool: arrival.tool,
      reply: { id: reply.id, sender: reply.sender },
      because: 'unknown_button',
      told: false,
      delivered: true,
    },
  };
  const place = { parts: delivery.parts, playbook: delivery.delivered.playbook, causationId: request.row.request_id };
  return recordedReplyWork(place, request, reply, { work: { type: 'work', fact }, refusal: 'unknown_button' }).pipe(
    Effect.catchTag('unavailable', () => Effect.undefined),
  );
}
