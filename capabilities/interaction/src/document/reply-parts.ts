import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';
import { issueAt } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import { Result, type Schema } from 'effect';

import type { ReplyRule, WrittenRule } from '../replies/reply-rule.ts';
import { checkedRule } from '../replies/rule-checks.ts';
import { compiledTemplate } from './request-templates.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export function fromOf(
  written: string | undefined,
  lines: SourceLines,
  inputSchema: Schema.JsonObject | undefined,
): Checked<ParsedTemplate | null> {
  if (written === undefined) {
    return Result.succeed(null);
  }
  const line = issueAt(lines, '/from', '').line;
  return compiledTemplate(written, { line, pointer: '/from', what: 'the party whose reply counts' }, inputSchema);
}

const ruleNeeded =
  'A function that reads replies needs a reply rule: an answer schema with one required string and its enum, or a reply block that maps the words';

export interface Answering {
  readonly reply: WrittenRule | undefined;
  readonly answerSchema: Schema.JsonObject | undefined;
  readonly readsReplies: boolean;
}

export function replyOf(
  { reply, answerSchema, readsReplies }: Answering,
  lines: SourceLines,
): Checked<ReplyRule | null> {
  const checked = Result.mapError(checkedRule(reply, answerSchema), (issues) =>
    issues.map(({ pointer, detail }) => issueAt(lines, pointer, detail)),
  );
  return Result.flatMap(checked, (rule) =>
    rule === null && readsReplies && answerSchema !== undefined
      ? Result.fail([issueAt(lines, '/replies', ruleNeeded)])
      : Result.succeed(rule),
  );
}
