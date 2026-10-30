import type { DocumentIssue, DocumentParts, ReadFrontMatter } from '@on.auto/definitions/document';
import { Result } from 'effect';

import { compiledBrief } from '../brief/brief-template.ts';
import { dataOf } from '../data/data-part.ts';
import { issuesOf, type Checked } from './checked-parts.ts';
import { evaluationOf } from './evaluation-part.ts';
import type { PredictionFrontMatter } from './front-matter.ts';
import { predictsOf } from './predicts-part.ts';
import { rulesOf, sourceOf } from './source-part.ts';

export function partsOf(front: PredictionFrontMatter, { lines }: ReadFrontMatter, parts: DocumentParts) {
  const predicts = predictsOf(front.predicts, front.data, lines);
  return {
    predicts,
    data: dataOf(front.data, front.predicts.target, lines),
    evaluation: Result.isFailure(predicts)
      ? Result.fail([])
      : evaluationOf(front.evaluation, predicts.success, front.data.window, lines),
    source: sourceOf(front.source, lines),
    rules: rulesOf(front.rules ?? [], lines),
    brief: compiledBrief(parts),
  };
}

export type Parts = ReturnType<typeof partsOf>;

export type Done = { readonly [Part in keyof Parts]: Result.Result.Success<Parts[Part]> };

export function doneOf(partsChecked: () => Parts): Checked<Done> {
  const parts = partsChecked();
  const all = Result.all(parts);
  if (Result.isSuccess(all)) {
    return Result.succeed(all.success);
  }
  const found: readonly DocumentIssue[] = [
    ...issuesOf(() => parts.predicts),
    ...issuesOf(() => parts.data),
    ...issuesOf(() => parts.evaluation),
    ...issuesOf(() => parts.source),
    ...issuesOf(() => parts.rules),
    ...issuesOf(() => parts.brief),
  ];
  return Result.fail(found);
}
