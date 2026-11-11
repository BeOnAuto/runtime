import type { Issue } from '@on.auto/operations';

import type { ReplyRefusal } from '../facts/run-facts.ts';
import { interactionBounds } from '../run/run-bounds.ts';
import type { ReplyRule, RulePart } from './reply-rule.ts';

const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' });

const either = new Intl.ListFormat('en-GB', { type: 'disjunction' });

type Named = readonly [string, RulePart];

function wordsOf(rule: ReplyRule): readonly string[] {
  return Object.values(rule).flatMap((part) => (part.from === 'word' ? Object.keys(part.words) : []));
}

function partsFrom(rule: ReplyRule, from: RulePart['from']): readonly string[] {
  return Object.entries(rule)
    .filter(([, part]: Named) => part.from === from)
    .map(([property]: Named) => property);
}

function replyWith(rule: ReplyRule): string {
  const values = wordsOf(rule);
  return values.length > 0 ? `Reply with ${either.format(values)}.` : 'Reply with your answer in words.';
}

function keptAfterTheWord(rule: ReplyRule): string {
  const rest = partsFrom(rule, 'rest');
  return rest.length > 0 && wordsOf(rule).length > 0
    ? ` Anything after that word is kept as the ${listed.format(rest)}.`
    : '';
}

const mostSentencesTold = 5;

function whatIsWrong(issues: readonly Issue[]): string {
  const said = issues
    .slice(0, mostSentencesTold)
    .map(({ detail }) => detail)
    .join(' ');
  return said.endsWith('.') ? said : `${said}.`;
}

const kilobytes = interactionBounds.messageBytes / 1024;

export interface Refused {
  readonly rule: ReplyRule;
  readonly because: ReplyRefusal;
  readonly issues: readonly Issue[];
  readonly open: number;
  readonly namesItsMessage: boolean;
}

function ambiguousWords({ open, namesItsMessage }: Refused): string {
  if (namesItsMessage) {
    return "More than one request is open here. Reply in the thread of the one you're answering.";
  }
  return open === 2
    ? "Two requests are open here, so Auto can't tell which one this answers. Neither was answered. Answer them in Auto, or reply here when one is left."
    : `${open} requests are open here, so Auto can't tell which one this answers. None of them was answered. Answer them in Auto, or reply here when one is left.`;
}

export function tellingWords(refused: Refused): string {
  const { rule, because, issues } = refused;
  if (because === 'too_long') {
    return `That reply is too long for Auto to take. A reply can hold up to ${kilobytes} KB of text.`;
  }
  if (because === 'ambiguous') {
    return ambiguousWords(refused);
  }
  if (because === 'not_the_answerer') {
    return "This request is waiting for someone else's answer, so Auto didn't take this reply.";
  }
  return because === 'invalid'
    ? `Auto couldn't take that answer: ${whatIsWrong(issues)} ${replyWith(rule)}`
    : `Auto couldn't take that as an answer. ${replyWith(rule)}${keptAfterTheWord(rule)}`;
}

export const answeredAlreadyWords = "This request was already answered, so Auto didn't take this reply.";

export function wordsTakenOf(rule: ReplyRule, answer: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.entries(rule).flatMap(([property, part]: Named) => {
    const value = answer[property];
    return part.from === 'word' && typeof value === 'string' ? [value] : [];
  });
}

export function takenWords(words: readonly string[]): string {
  return words.length === 0 ? 'Auto recorded your answer.' : `Auto recorded your answer: ${listed.format(words)}.`;
}
