import { presentedWebhookOf } from '@on.auto/identity';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { RegisterRoutes } from '../routes.ts';
import { addressIn, answerRoutePath } from './answer-address.ts';
import { deliveryBounds } from './delivery-bounds.ts';
import { limiterOf } from './delivery-limits.ts';
import type { Door, SignedAnswerServing } from './delivery-ports.ts';
import { deliveryProblems } from './delivery-problems.ts';
import { deliveryVerified } from './verified-deliveries.ts';

function doorOf(serving: SignedAnswerServing): Door {
  const { now = Date.now, bounds = deliveryBounds } = serving;
  return {
    serving,
    limiter: limiterOf(bounds.deliveriesOfAConnectionAMinute),
    bounds,
    now,
    heard: (delivery, response) => {
      serving.heard({ ...delivery, status: response.status });
      return response;
    },
  };
}

function presentedAt(door: Door, c: Context<ApiEnv>): Promise<Response> | Response {
  const address = addressIn(c);
  const webhook = presentedWebhookOf((name) => c.req.header(name), door.now());
  if (address === undefined || typeof webhook === 'string') {
    const outcome = typeof webhook === 'string' ? webhook : 'malformed';
    return door.heard({ address, webhookId: undefined, bytes: 0, outcome }, deliveryProblems.unsigned());
  }
  return deliveryVerified(door, c, address, webhook);
}

export function signedAnswerRoutes(serving: SignedAnswerServing): RegisterRoutes {
  const door = doorOf(serving);
  return (routes) => {
    routes.addPublic('POST', answerRoutePath, (c) => presentedAt(door, c));
  };
}
