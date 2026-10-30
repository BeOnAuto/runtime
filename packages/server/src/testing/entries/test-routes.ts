import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';

import type { RegisterRoutes } from '@on.auto/api';

export interface RequestHold {
  readonly arrived: () => void;
  readonly released: () => Promise<unknown>;
}

export interface HeldRequests {
  readonly routes: RegisterRoutes;
  readonly arrived: Promise<void>;
  readonly release: () => void;
}

export function testRoutesHeldBy(hold: RequestHold): RegisterRoutes {
  return (routes) => {
    routes.add('GET', '/held', async (c) => {
      const released = hold.released();
      hold.arrived();
      await Promise.race([released, once(c.req.raw.signal, 'abort')]);
      return c.json({ held: true });
    });
    routes.add('GET', '/fail', () => {
      throw new Error('database password is hunter2');
    });
    routes.add('GET', '/linger', (c) => {
      const ms = Number(c.req.query('ms'));
      void setTimeout(ms);
      return c.json({ lingering: ms });
    });
  };
}

export function heldRequests(): HeldRequests {
  const arrival = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  return {
    routes: testRoutesHeldBy({ arrived: arrival.resolve, released: () => release.promise }),
    arrived: arrival.promise,
    release: release.resolve,
  };
}
