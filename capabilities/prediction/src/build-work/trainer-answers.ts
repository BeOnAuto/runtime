import type { RecordedAnswer } from '@on.auto/definitions';
import { Schema } from 'effect';

import type { TrainerAnswer } from '../scoring/version-card.ts';

const AnswerSchema = Schema.Struct({
  candidates: Schema.Array(Schema.String),
  recipe: Schema.optionalKey(Schema.String),
  limitations: Schema.optionalKey(Schema.String),
});

const decodeAnswer = Schema.decodeUnknownSync(AnswerSchema);

export function trainerAnswerOf({ answer, by }: RecordedAnswer): TrainerAnswer {
  const { candidates, recipe, limitations } = decodeAnswer(answer);
  return {
    candidates: [...new Set(candidates)],
    by,
    ...(recipe === undefined ? {} : { recipe }),
    ...(limitations === undefined ? {} : { limitations }),
  };
}
