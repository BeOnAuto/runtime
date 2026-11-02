import { InvalidInput } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { DefinitionSummary } from '../capability/capability.ts';
import { issueText, type DocumentIssue } from '../document/document-issue.ts';
import { encodePageDetails } from './page-details.ts';
import type { PageDefinitionDocument } from './page-document.ts';
import { parsePageDocument } from './page-parsing.ts';

export function invalidPage(issues: readonly DocumentIssue[]): InvalidInput {
  return new InvalidInput({
    detail: `The page has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
    issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
  });
}

export function parse(source: string): Effect.Effect<PageDefinitionDocument, InvalidInput> {
  return Result.match(parsePageDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) => Effect.fail(invalidPage(issues)),
  });
}

export function summarize({ description, of, data }: PageDefinitionDocument): DefinitionSummary {
  const details =
    data === undefined
      ? { of }
      : {
          of,
          data: {
            views: data.views,
            language: 'typescript' as const,
            fold: data.fold,
            foldLine: data.foldLine,
            filters: data.filters,
          },
        };
  return { ...(description === undefined ? {} : { description }), details: encodePageDetails(details) };
}
