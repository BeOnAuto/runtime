import type { ViewDetails } from '@on.auto/workflow-host';
import { Effect, Result } from 'effect';

import { parseRecallDocument } from '../document/document-parsing.ts';
import { recallWith } from './recall-runs.ts';

export async function runnableDetailsOf(source: string): Promise<ViewDetails> {
  const details = Result.getOrThrow(parseRecallDocument(source)).details;
  const { module = details.fold } = await Effect.runPromise(recallWith().prepared(source).check());
  return { ...details, fold: module };
}
