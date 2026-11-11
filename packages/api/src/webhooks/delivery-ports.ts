import type { PresentedWebhook, SigningKey } from '@on.auto/identity';
import type { Settled } from '@on.auto/operations';

import type { DeliveryBounds } from './delivery-bounds.ts';
import type { Limiter } from './delivery-limits.ts';
import type { DeliveryOutcome } from './delivery-problems.ts';

export interface AnswerAddress {
  readonly org: string;
  readonly playbook: string;
  readonly connection: string;
  readonly runId: string;
}

export interface SigningKeys {
  readonly connection: string;
  readonly keys: readonly SigningKey[];
}

export type KeysRead = 'held' | 'current';

export interface KeysLimited {
  readonly retryAfterSeconds: number;
}

export type KeysAnswer = SigningKeys | KeysLimited | undefined;

export interface WebhookTaken {
  readonly org: string;
  readonly connection: string;
  readonly connectionName: string;
  readonly webhookId: string;
  readonly takenFor: string;
  readonly keptUntilMs: number;
  readonly verifiedWith: SigningKey;
}

export interface SignedAnswer extends AnswerAddress {
  readonly connectionId: string;
  readonly webhookId: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface HeardDelivery {
  readonly address: AnswerAddress | undefined;
  readonly outcome: DeliveryOutcome;
  readonly status: number;
  readonly webhookId: string | undefined;
  readonly bytes: number;
}

export interface SignedAnswerServing {
  readonly signingKeys: (org: string, connection: string, read: KeysRead) => Promise<KeysAnswer>;
  readonly holdsKeys?: boolean;
  readonly taken: (webhook: WebhookTaken) => Promise<string | undefined>;
  readonly answered: (answer: SignedAnswer) => Promise<Settled>;
  readonly heard: (delivery: HeardDelivery) => void;
  readonly now?: () => number;
  readonly bounds?: DeliveryBounds;
}

export interface Delivery {
  readonly address: AnswerAddress;
  readonly connectionId: string;
  readonly webhook: PresentedWebhook;
  readonly body: Readonly<Uint8Array>;
  readonly verifiedWith: SigningKey;
}

export interface Door {
  readonly serving: SignedAnswerServing;
  readonly limiter: Limiter;
  readonly bounds: DeliveryBounds;
  readonly now: () => number;
  readonly heard: (delivery: Omit<HeardDelivery, 'status'>, response: Readonly<Response>) => Response;
}
