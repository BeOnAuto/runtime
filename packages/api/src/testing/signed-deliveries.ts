import { Buffer } from 'node:buffer';

import { webhookSignatureOf, type SigningKey } from '@on.auto/identity';
import { rejected, type Settled } from '@on.auto/operations';
import { Redacted } from 'effect';

import {
  signedAnswerRoutes,
  type HeardDelivery,
  type SignedAnswer,
  type SignedAnswerServing,
  type WebhookTaken,
} from '../index.ts';
import { deliveryBounds } from '../webhooks/delivery-bounds.ts';
import { createTestHandler } from './api-calls.ts';

export const approvalsSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

export const otherSecret = `whsec_${Buffer.alloc(32, 9).toString('base64')}`;

export const nowSeconds = 1_794_318_120;

export const runId = '019a4131-9d2e-7f40-8a51-6b7c8d9e0f12';

export const approvalsId = '019a4000-0000-7000-8000-00000000a991';

export const answerPath = `/v1/orgs/acme/playbooks/ops/connections/approvals/runs/${runId}/answer`;

export const answerBody = JSON.stringify({ answer: { verdict: 'approve' }, claimed_for: 'june@acme.example' });

export function keyOf(secret: string): SigningKey {
  return Redacted.make(Uint8Array.from(Buffer.from(secret.slice('whsec_'.length), 'base64')));
}

export interface Signing {
  readonly secret?: string;
  readonly id?: string;
  readonly timestamp?: number;
  readonly body?: string;
}

export function signedHeaders({
  secret = approvalsSecret,
  id = 'msg_2Lh9KRb1t3',
  timestamp = nowSeconds,
  body = answerBody,
}: Signing = {}): Readonly<Record<string, string>> {
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': webhookSignatureOf(keyOf(secret), id, timestamp, new TextEncoder().encode(body)),
  };
}

interface Served {
  readonly answered: SignedAnswer[];
  readonly heard: HeardDelivery[];
  readonly keysAsked: string[];
  readonly taken: WebhookTaken[];
}

const taken: Settled = { status: 'succeeded', output: { run_id: runId, answer: { verdict: 'approve' } } };

export function servedWith(changes: Partial<SignedAnswerServing> = {}) {
  const served: Served = { answered: [], heard: [], keysAsked: [], taken: [] };
  const holders = new Map<string, string>();
  const serving: SignedAnswerServing = {
    signingKeys: (org, connection, read) => {
      served.keysAsked.push(`${org}/${connection} ${read}`);
      return Promise.resolve(
        connection === 'approvals' ? { connection: approvalsId, keys: [keyOf(approvalsSecret)] } : undefined,
      );
    },
    taken: (webhook) => {
      served.taken.push(webhook);
      const { org, connection, webhookId, takenFor } = webhook;
      const key = `${org}/${connection}/${webhookId}`;
      const held = holders.get(key) ?? takenFor;
      holders.set(key, held);
      return Promise.resolve(held);
    },
    answered: (answer) => {
      served.answered.push(answer);
      return Promise.resolve(taken);
    },
    heard: (delivery) => {
      served.heard.push(delivery);
    },
    now: () => nowSeconds * 1000,
    bounds: deliveryBounds,
    ...changes,
  };
  const { handler } = createTestHandler({ routes: [signedAnswerRoutes(serving)] });
  return { handler, served };
}

export const notFound: Settled = rejected('not_found', 'There is no request this connection was asked at this address');
