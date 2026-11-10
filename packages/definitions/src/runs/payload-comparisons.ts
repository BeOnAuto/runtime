import { sha256Of } from '@on.auto/content';
import { Unavailable } from '@on.auto/operations';
import type { Payload } from '@on.auto/operations/payloads';
import type { Schema } from 'effect';

export const comparedWithoutItsValue = new Unavailable({
  detail:
    "The run's recorded value, which its playbook keeps outside the run's record, could not be compared with this one just now; ask again in a moment",
});

export type Compared = 'same' | 'different' | 'unknown';

export type ValuesEqual = (recorded: Schema.Json, offered: Schema.Json) => boolean;

function digestOfItsText(payload: Payload<Schema.Json>): string {
  return 'inline' in payload ? sha256Of(JSON.stringify(payload.inline)) : payload.kept.sha256;
}

export function comparedPayloads(
  recorded: Payload<Schema.Json>,
  offered: Payload<Schema.Json>,
  equal: ValuesEqual,
): Compared {
  if ('inline' in recorded && 'inline' in offered) {
    return equal(recorded.inline, offered.inline) ? 'same' : 'different';
  }
  return digestOfItsText(recorded) === digestOfItsText(offered) ? 'same' : 'unknown';
}
