import { Buffer } from 'node:buffer';

import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';
import { readDuration } from '@on.auto/workflow-engine/dsl';
import { Result } from 'effect';

import { figure } from '../capability/figures.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import { checkedFrom, refusedAt, type Checked } from './checked-parts.ts';
import type { WrittenSource } from './front-matter.ts';
import { functionNameIssues } from './function-names.ts';
import type { BuildSource } from './prediction-document.ts';

const { shortestExpiryMs, longestExpiryMs, mostRules, mostRuleBytes } = predictionBounds;

const defaultParty = 'trainer';

const expiryBounds = 'A build waits for its trainer from one minute to thirty days, such as P7D or PT12H';

const mostPartyCharacters = 256;

function expiryOf(
  expires: string,
  lines: SourceLines,
): { readonly ms?: number; readonly issues: readonly DocumentIssue[] } {
  const reading = readDuration(expires);
  if ('problem' in reading) {
    return { issues: refusedAt(lines, '/source/expires', `${reading.problem}. ${expiryBounds}`) };
  }
  const { milliseconds } = reading;
  return milliseconds >= shortestExpiryMs && milliseconds <= longestExpiryMs
    ? { ms: milliseconds, issues: [] }
    : { issues: refusedAt(lines, '/source/expires', `${expires} is not a time a build may wait. ${expiryBounds}`) };
}

function partyIssues({ through, to }: WrittenSource, lines: SourceLines): readonly DocumentIssue[] {
  if (to === undefined) {
    return through === undefined ? [] : functionNameIssues(through, '/source/through', lines);
  }
  if (through !== undefined) {
    return refusedAt(
      lines,
      '/source/to',
      'to names the party of a build asked in the inbox; a build sent through a function goes to the party that function names',
    );
  }
  return to.trim() === '' || to.length > mostPartyCharacters
    ? refusedAt(lines, '/source/to', `to is the party a build goes to, text of 1 to ${mostPartyCharacters} characters`)
    : [];
}

export function sourceOf(written: WrittenSource | undefined, lines: SourceLines): Checked<BuildSource | undefined> {
  if (written === undefined) {
    return Result.succeed(written);
  }
  const expiry = expiryOf(written.expires, lines);
  const issues = [...expiry.issues, ...partyIssues(written, lines)];
  return checkedFrom(issues, () => ({
    ...(written.through === undefined ? {} : { through: written.through }),
    to: written.to ?? defaultParty,
    expires: written.expires,
    expiresMs: Number(expiry.ms),
  }));
}

export function rulesOf(written: readonly string[], lines: SourceLines): Checked<readonly string[]> {
  const counted =
    written.length > mostRules
      ? refusedAt(
          lines,
          '/rules',
          `A prediction function states at most ${mostRules} rules; it states ${figure(written.length)}`,
        )
      : [];
  const each = written.flatMap((rule, index) => {
    const at = `/rules/${index}`;
    if (rule.trim() === '') {
      return refusedAt(lines, at, 'A rule is a line in words; this one is empty');
    }
    const bytes = Buffer.byteLength(rule, 'utf8');
    return bytes > mostRuleBytes || rule.includes('\n')
      ? refusedAt(
          lines,
          at,
          `A rule is one line of at most ${mostRuleBytes} bytes; this one takes ${figure(bytes)} bytes`,
        )
      : [];
  });
  return checkedFrom([...counted, ...each], () => written.map((rule) => rule.trim()));
}
