import { InvalidInput } from '@on.auto/operations';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Option, Result } from 'effect';

import { issueText, type DocumentIssue } from '../document/document-issue.ts';
import { pageChecked } from './page-check.ts';
import { pageDetailsOf } from './page-details-of.ts';
import { pageIn } from './page-key.ts';
import type { PageCheck, PageWrittenIn } from './subject-pages-port.ts';

function placedIn(writtenIn: PageWrittenIn): (issue: DocumentIssue) => DocumentIssue {
  return writtenIn === 'playbook'
    ? (issue) => issue
    : (issue) => (issue.pointer === '' ? issue : { ...issue, pointer: `/page${issue.pointer}` });
}

function invalidPage(writtenIn: PageWrittenIn): (issues: readonly DocumentIssue[]) => InvalidInput {
  const pointer = writtenIn === 'playbook' ? '/page' : '/source';
  const placed = placedIn(writtenIn);
  return (issues) =>
    new InvalidInput({
      detail: `The page has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
      issues: issues.map((issue) => ({ pointer, detail: issueText(placed(issue)) })),
    });
}

export function pageCheckOn(pool: Pick<ProgramPool, 'check'>): PageCheck {
  return (text, writtenIn) => {
    const refused = invalidPage(writtenIn);
    return Result.match(Result.map(pageIn(text, writtenIn), Option.getOrUndefined), {
      onFailure: (issues) => Effect.fail(refused(issues)),
      onSuccess: (document) => {
        return document === null || document === undefined
          ? Effect.succeed(document)
          : Effect.map(pageChecked(pool, refused)(document), (stripped) => ({
              details: pageDetailsOf(document),
              ...(Object.keys(stripped).length === 0 ? {} : { stripped }),
            }));
      },
    });
  };
}
