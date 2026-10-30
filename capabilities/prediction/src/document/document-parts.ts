import type { DocumentIssue, DocumentParts, ReadFrontMatter } from '@on.auto/definitions/document';
import { Result } from 'effect';

import { dataOf } from '../data/data-part.ts';
import { issuesOf, type Checked } from './checked-parts.ts';
import type { PredictionFrontMatter } from './front-matter.ts';
import { predictsOf } from './predicts-part.ts';

const noBody =
  'A prediction function has no body: leave the body after the front matter empty, and say what the function predicts in description';

export function bodyIssues({ body, bodyLine }: DocumentParts): readonly DocumentIssue[] {
  const firstWritten = body.split('\n').findIndex((line) => line.trim() !== '');
  return firstWritten === -1 ? [] : [{ line: bodyLine + firstWritten, pointer: '', detail: noBody }];
}

function partsOf(front: PredictionFrontMatter, { lines }: ReadFrontMatter) {
  return {
    predicts: predictsOf(front.predicts, front.data, lines),
    data: dataOf(front.data, lines),
  };
}

type Parts = ReturnType<typeof partsOf>;

export type Done = { readonly [Part in keyof Parts]: Result.Result.Success<Parts[Part]> };

export function doneOf(
  front: PredictionFrontMatter,
  read: ReadFrontMatter,
  body: readonly DocumentIssue[],
): Checked<Done> {
  const parts = partsOf(front, read);
  const all = Result.all(parts);
  if (Result.isSuccess(all) && body.length === 0) {
    return Result.succeed(all.success);
  }
  return Result.fail([...issuesOf(() => parts.predicts), ...issuesOf(() => parts.data), ...body]);
}
