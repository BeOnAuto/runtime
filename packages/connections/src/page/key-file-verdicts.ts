import { Conflict, Unavailable, type InvalidInput } from '@on.auto/operations';
import type { AssertionChecked } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { detailOf, unavailableWords, type ConsentNamed } from './consent-words.ts';
import { keyRefusedWith, refused } from './given-fields.ts';
import { unansweredWordsOf } from './unanswered-words.ts';

type Refused = InvalidInput | Unavailable | Conflict;

function unusableOf(named: ConsentNamed, checked: AssertionChecked): Refused | undefined {
  if (checked.kind === 'conflicting') {
    return new Conflict({ detail: detailOf(named, checked.refusal) });
  }
  return checked.kind === 'unanswered'
    ? new Unavailable({
        detail: unansweredWordsOf(`The key of the connection ${named.name} cannot be checked`, checked.call),
      })
    : undefined;
}

function refusalOf(named: ConsentNamed, checked: AssertionChecked): Refused | undefined {
  if (checked.kind === 'refused') {
    return refused([{ pointer: '', detail: keyRefusedWith(checked.code) }]);
  }
  return checked.kind === 'unreached'
    ? new Unavailable({ detail: unavailableWords.valueUnchecked(checked.hosts) })
    : unusableOf(named, checked);
}

export function keyFileVerdictOf(named: ConsentNamed, checked: AssertionChecked): Effect.Effect<void, Refused> {
  const refusal = refusalOf(named, checked);
  return refusal === undefined ? Effect.void : Effect.fail(refusal);
}
