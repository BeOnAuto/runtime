import { Buffer } from 'node:buffer';

import type { AnswerIssues } from '@on.auto/definitions';
import type { Issue } from '@on.auto/operations';
import { Schema } from 'effect';

import { mostNoteBytes } from '../build/build-request.ts';
import { figure } from '../capability/figures.ts';
import { buildWorkIn } from '../facts/build-facts.ts';

const AnswerSchema = Schema.Struct({
  candidates: Schema.Array(Schema.String),
  recipe: Schema.optionalKey(Schema.String),
  limitations: Schema.optionalKey(Schema.String),
});

const decodeAnswer = Schema.decodeUnknownSync(AnswerSchema);

function noteIssues(name: 'recipe' | 'limitations', text: string | undefined): readonly Issue[] {
  const bytes = text === undefined ? 0 : Buffer.byteLength(text, 'utf8');
  return bytes > mostNoteBytes
    ? [
        {
          pointer: `/${name}`,
          detail: `The ${name} takes ${figure(bytes)} bytes, more than the ${figure(mostNoteBytes)} an answer may give it`,
        },
      ]
    : [];
}

export const buildAnswerIssues: AnswerIssues = (answer, { work }) => {
  const uploaded = new Set(
    work
      .flatMap((each) => buildWorkIn(each))
      .flatMap((fact) => (fact.type === 'candidate_uploaded' ? [fact.data.sha256] : [])),
  );
  const { candidates, recipe, limitations } = decodeAnswer(answer);
  return [
    ...candidates.flatMap((sha256, index) =>
      uploaded.has(sha256)
        ? []
        : [
            {
              pointer: `/candidates/${index}`,
              detail: `Candidate ${sha256.slice(0, 12)}… was not uploaded to this build`,
            },
          ],
    ),
    ...noteIssues('recipe', recipe),
    ...noteIssues('limitations', limitations),
  ];
};
