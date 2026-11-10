import { Effect } from 'effect';

import type { ConversationParts, ConversationPlace } from '../conversations/conversation-parts.ts';
import { readingKeyOf, readingRowFrom, readingsName } from './reading-rows.ts';
import type { ReadingOfATurn } from './turn-readings.ts';

export interface ReadingsOfAPlace {
  readonly parts: ConversationParts;
  readonly place: ConversationPlace;
  readonly leading: string | undefined;
}

export function leadingOf(readings: readonly ReadingOfATurn[]): string | undefined {
  return readings.find(({ namesItsMessage }) => !namesItsMessage)?.reading;
}

export function isLeading({ leading }: ReadingsOfAPlace, { reading }: ReadingOfATurn): boolean {
  return reading === leading;
}

function ownSinceOf({ parts, place }: ReadingsOfAPlace, reading: ReadingOfATurn) {
  const row = { column: 'row_key', equals: readingKeyOf(place.key, reading.reading) };
  return Effect.map(
    parts.ledger.readProjectedRows(readingsName, place.playbook, { where: [row], orderBy: [], order: 'asc', limit: 1 }),
    ([own]): string | null => {
      if (own !== undefined) {
        return readingRowFrom(own.row).since;
      }
      return reading.namesItsMessage ? null : place.row.since;
    },
  );
}

export function sinceOf(readings: ReadingsOfAPlace, reading: ReadingOfATurn): Effect.Effect<string | null> {
  return isLeading(readings, reading) ? Effect.succeed(readings.place.row.since) : ownSinceOf(readings, reading);
}
