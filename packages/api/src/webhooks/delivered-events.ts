import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { RegisterRoutes } from '../routes.ts';
import { deliveryBounds } from './delivery-bounds.ts';
import { limiterOf } from './delivery-limits.ts';
import { deliveryProblems } from './delivery-problems.ts';
import { eventAddressIn, eventRoutePath, limitedAs } from './event-address.ts';
import type { EventDoor, EventServing } from './event-ports.ts';
import { eventProven } from './proven-events.ts';

function eventDoorOf(serving: EventServing): EventDoor {
  const { now = Date.now, bounds = deliveryBounds } = serving;
  return {
    serving,
    limiter: limiterOf(bounds.deliveriesOfAConnectionAMinute),
    bounds,
    now,
    heard: (event, response) => {
      serving.heard({ ...event, status: response.status });
      return response;
    },
  };
}

function eventDelivered(door: EventDoor, c: Context<ApiEnv>): Promise<Response> | Response {
  const address = eventAddressIn(c);
  if (address === undefined) {
    return door.heard({ address, bytes: 0, outcome: 'malformed' }, deliveryProblems.unsigned());
  }
  const waitSeconds = door.limiter.secondsToWait(limitedAs(address), door.now());
  if (waitSeconds > 0) {
    return door.heard({ address, bytes: 0, outcome: 'limited' }, deliveryProblems.limited(waitSeconds));
  }
  return eventProven(door, c.req.raw, address);
}

export function deliveredEventRoutes(serving: EventServing): RegisterRoutes {
  const door = eventDoorOf(serving);
  return (routes) => {
    routes.addPublic('POST', eventRoutePath, (c) => eventDelivered(door, c));
  };
}
