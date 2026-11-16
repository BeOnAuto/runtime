import type { PlaybookProjectedRow, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { playbookOf, toldThrough } from './row-tellings.ts';

export interface DueTelling {
  readonly key: string;
  readonly callsOut: true;
  readonly perform: (now: number) => Effect.Effect<void, Unavailable>;
}

export interface TellingHold {
  readonly until: number;
  readonly room: Effect.Effect<boolean>;
}

interface AnswerTold {
  readonly address: RequestAddress;
  readonly answeredAt: number;
  readonly hold: TellingHold;
}

export function toldOnceAnswered(
  parts: DeliveryParts,
  { address, answeredAt, hold }: AnswerTold,
): Effect.Effect<boolean> {
  const playbook = playbookOf(address);
  const held = { set: { telling_due_at: hold.until }, when: [{ column: 'telling_due_at', equals: answeredAt }] };
  const released = { set: { telling_due_at: answeredAt }, when: [{ column: 'telling_due_at', equals: hold.until }] };
  return Effect.gen(function* () {
    yield* parts.ledger.advanceRow(openRequestsName, playbook, address.id, held);
    const made = yield* toldThrough(parts, address, hold.until, hold.room).pipe(
      Effect.catchTag('unavailable', () => Effect.succeed(false)),
    );
    if (!made) {
      yield* parts.ledger.advanceRow(openRequestsName, playbook, address.id, released);
    }
    return made;
  });
}

const everyCallNow = Effect.succeed(true);

export function dueTellingOf(parts: DeliveryParts, kept: PlaybookProjectedRow): DueTelling {
  const address = { org: kept.org, playbook: kept.playbook, id: kept.key };
  return {
    key: `${kept.org}/${kept.playbook}/${kept.key}/telling`,
    callsOut: true,
    perform: (now) => Effect.asVoid(Effect.suspend(() => toldThrough(parts, address, now, everyCallNow))),
  };
}
