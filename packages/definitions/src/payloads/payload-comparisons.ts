import { sha256Of, type Digested } from '@on.auto/content';
import { Unavailable } from '@on.auto/operations';
import type { Payload } from '@on.auto/operations/payloads';
import type { Schema } from 'effect';

export const comparedWithoutItsValue = new Unavailable({
  detail:
    "The run's recorded value, which its playbook keeps outside the run's record, could not be compared with this one just now; ask again in a moment",
});

export type Compared = 'same' | 'different' | 'unknown';

export type ValuesEqual = (recorded: Schema.Json, offered: Schema.Json) => boolean;

export type ValuesRead = ReadonlyMap<string, Schema.Json>;

const nothingRead: ValuesRead = new Map();

function digestOfItsText(payload: Payload<Schema.Json>): string {
  return 'inline' in payload ? sha256Of(JSON.stringify(payload.inline)) : payload.kept.sha256;
}

function valueOf(payload: Payload<Schema.Json>, read: ValuesRead): { readonly value: Schema.Json } | undefined {
  if ('inline' in payload) {
    return { value: payload.inline };
  }
  const value = read.get(payload.kept.sha256);
  return value === undefined ? undefined : { value };
}

export function comparedPayloads(
  recorded: Payload<Schema.Json>,
  offered: Payload<Schema.Json>,
  equal: ValuesEqual,
  read: ValuesRead = nothingRead,
): Compared {
  const [recordedValue, offeredValue] = [valueOf(recorded, read), valueOf(offered, read)];
  if (recordedValue !== undefined && offeredValue !== undefined) {
    return equal(recordedValue.value, offeredValue.value) ? 'same' : 'different';
  }
  return digestOfItsText(recorded) === digestOfItsText(offered) ? 'same' : 'unknown';
}

const anyValues: ValuesEqual = () => true;

export function keptToCompare(recorded: Payload<Schema.Json>, offered: Payload<Schema.Json>): readonly Digested[] {
  return comparedPayloads(recorded, offered, anyValues) === 'unknown'
    ? [recorded, offered].flatMap((payload) => ('kept' in payload ? [payload.kept] : []))
    : [];
}
