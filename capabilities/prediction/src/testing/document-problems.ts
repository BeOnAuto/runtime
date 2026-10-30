import { issueText } from '@on.auto/definitions/document';
import { Result } from 'effect';

import { parsePredictionDocument } from '../document/document-parsing.ts';

export function problemsOf(source: string): readonly string[] {
  const parsed = parsePredictionDocument(source);
  return Result.isFailure(parsed) ? parsed.failure.map((issue) => issueText(issue)) : [];
}
