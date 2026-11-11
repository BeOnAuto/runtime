import { isSignedByAnyOf, type PresentedWebhook, type SigningKey } from '@on.auto/identity';
import { Result } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { deliveryBodyOf } from './delivery-body.ts';
import type { AnswerAddress, Door, KeysAnswer, KeysLimited, KeysRead, SigningKeys } from './delivery-ports.ts';
import { deliveryProblems } from './delivery-problems.ts';
import { answerTaken } from './taken-answers.ts';

interface Verification {
  readonly answer: KeysAnswer;
  readonly verifiedWith: SigningKey | undefined;
}

function isLimited(answer: KeysAnswer): answer is KeysLimited {
  return answer !== undefined && 'retryAfterSeconds' in answer;
}

function keyThatSigned(answer: SigningKeys | undefined, webhook: PresentedWebhook, body: Readonly<Uint8Array>) {
  return answer?.keys.find((key) => isSignedByAnyOf([key], webhook, body));
}

async function verifiedBy(
  door: Door,
  { org, connection }: AnswerAddress,
  read: KeysRead,
  signed: { readonly webhook: PresentedWebhook; readonly body: Readonly<Uint8Array> },
): Promise<Verification> {
  const answer = await door.serving.signingKeys(org, connection, read);
  return { answer, verifiedWith: isLimited(answer) ? undefined : keyThatSigned(answer, signed.webhook, signed.body) };
}

async function verificationOf(
  door: Door,
  address: AnswerAddress,
  signed: { readonly webhook: PresentedWebhook; readonly body: Readonly<Uint8Array> },
): Promise<Verification> {
  if (door.serving.holdsKeys !== true) {
    return verifiedBy(door, address, 'current', signed);
  }
  const held = await verifiedBy(door, address, 'held', signed);
  return isLimited(held.answer) || held.verifiedWith !== undefined
    ? held
    : verifiedBy(door, address, 'current', signed);
}

export async function deliveryVerified(
  door: Door,
  c: Context<ApiEnv>,
  address: AnswerAddress,
  webhook: PresentedWebhook,
): Promise<Response> {
  const seen = { address, webhookId: webhook.id };
  const body = await deliveryBodyOf(c.req.raw, door.bounds);
  if (Result.isFailure(body)) {
    return door.heard({ ...seen, bytes: 0, outcome: 'unread' }, deliveryProblems.of(body.failure));
  }
  const bytes = body.success.byteLength;
  const { answer, verifiedWith } = await verificationOf(door, address, { webhook, body: body.success });
  if (isLimited(answer)) {
    return door.heard(
      { ...seen, bytes, outcome: 'lookup_limited' },
      deliveryProblems.lookupLimited(answer.retryAfterSeconds),
    );
  }
  if (answer === undefined || verifiedWith === undefined) {
    const outcome = answer === undefined || answer.keys.length === 0 ? 'unknown' : 'not_signed';
    return door.heard({ ...seen, bytes, outcome }, deliveryProblems.unsigned());
  }
  return answerTaken(door, c, { address, connectionId: answer.connection, webhook, body: body.success, verifiedWith });
}
