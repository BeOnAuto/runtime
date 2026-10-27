import { Context } from 'effect';

import type { RecordedPoint } from '../event-store.ts';

export interface LoggedEvent {
  readonly id: string;
  readonly stream: string;
  readonly version: number;
  readonly type: string;
  readonly point: RecordedPoint;
}

export interface LogPage {
  readonly events: readonly LoggedEvent[];
  readonly through: RecordedPoint | undefined;
  readonly more: boolean;
}

export interface LogPorts {
  readonly head: () => Promise<RecordedPoint | undefined>;
  readonly after: (point: RecordedPoint | undefined, most: number) => Promise<LogPage>;
  readonly at: (point: RecordedPoint) => Promise<LoggedEvent | undefined>;
}

export class LedgerLog extends Context.Service<LedgerLog, LogPorts>()('@on.auto/ledger/LedgerLog') {}

export function samePoint(one: RecordedPoint, other: RecordedPoint): boolean {
  return one.length === other.length && one.every((part, index) => part === other[index]);
}
