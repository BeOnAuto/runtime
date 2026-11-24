import type { RecordedWork } from '@on.auto/definitions';
import type { Result } from 'effect';

import { renderedCard } from '../rendering/card-rendering.ts';
import type { RenderedMessage } from '../rendering/rendered-message.ts';
import type { Redraw } from '../run/request-record.ts';
import { endingFrom } from '../tellings/ending-rows.ts';
import { answeredSoFar, answerSoFar, settingsOf } from './answer-parts.ts';

export type Over = 'answered' | 'closed';

export function overHowOf(ending: string | null): Over {
  return ending === null || endingFrom(ending).kind === 'answered' ? 'answered' : 'closed';
}

export function drawnMessage(
  { target, card, input, today, now }: Redraw,
  work: readonly RecordedWork[],
  over: Over | undefined,
): Result.Result<RenderedMessage, readonly string[]> {
  const settings = settingsOf(work);
  const state = {
    input,
    today,
    now,
    answer: answerSoFar(settings),
    answered: answeredSoFar(settings),
    ...(over === undefined ? {} : { finished: over }),
  };
  return renderedCard(target, card, state);
}
