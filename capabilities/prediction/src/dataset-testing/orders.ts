import { randomUUID } from 'node:crypto';

import type { Schema } from 'effect';

export interface Order {
  readonly region: Schema.Json;
  readonly at: Schema.Json;
  readonly total?: Schema.Json;
  readonly promotion?: Schema.Json;
}

export interface Placed {
  readonly type?: string;
  readonly time?: string;
  readonly subject?: string;
  readonly data?: Schema.Json;
}

export function orderPlaced(
  { region, at, total, promotion }: Order,
  { type = 'order.placed', time = '2026-10-06T10:00:00Z', subject, data }: Placed = {},
): Schema.JsonObject {
  const ordered = {
    region,
    placed_at: at,
    ...(total === undefined ? {} : { total }),
    ...(promotion === undefined ? {} : { promotion }),
  };
  return {
    specversion: '1.0',
    id: randomUUID(),
    source: '/shop',
    type,
    time,
    ...(subject === undefined ? {} : { subject }),
    data: data ?? ordered,
  };
}

export function north(at: string): Schema.JsonObject {
  return orderPlaced({ region: 'north', at, total: 1 });
}
