import { Result } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { toHttpResponse } from '../operations/outcome-response.ts';
import { keptUntilMsOf, takenForOf } from './answer-address.ts';
import type { Delivery, Door } from './delivery-ports.ts';
import { answerBodyOf, deliveryProblems } from './delivery-problems.ts';

export async function answerTaken(door: Door, c: Context<ApiEnv>, delivery: Delivery): Promise<Response> {
  const { address, connectionId, webhook, body, verifiedWith } = delivery;
  const seen = { address, webhookId: webhook.id, bytes: body.byteLength };
  const waitSeconds = door.limiter.secondsToWait(`${address.org}/${connectionId}`, door.now());
  if (waitSeconds > 0) {
    return door.heard({ ...seen, outcome: 'limited' }, deliveryProblems.limited(waitSeconds));
  }
  const takenFor = takenForOf(address);
  const holder = await door.serving.taken({
    org: address.org,
    connection: connectionId,
    connectionName: address.connection,
    webhookId: webhook.id,
    takenFor,
    keptUntilMs: keptUntilMsOf(webhook, door.bounds),
    verifiedWith,
  });
  if (holder !== takenFor) {
    const outcome = holder === undefined ? 'not_signed' : 'replayed';
    return door.heard({ ...seen, outcome }, deliveryProblems.unsigned());
  }
  const fields = answerBodyOf(body, c.req.header('content-type') ?? null);
  if (Result.isFailure(fields)) {
    return door.heard({ ...seen, outcome: 'unreadable' }, deliveryProblems.of(fields.failure));
  }
  const settled = await door.serving.answered({
    ...address,
    connectionId,
    webhookId: webhook.id,
    body: fields.success,
  });
  const response = toHttpResponse(settled, { status: 200, signal: c.req.raw.signal, forbidden: {} });
  return door.heard({ ...seen, outcome: response.ok ? 'answered' : 'refused' }, response);
}
