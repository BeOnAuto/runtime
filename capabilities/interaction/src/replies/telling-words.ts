import type { Issue } from '@on.auto/operations';

import type { ReplyRefusal } from '../facts/run-facts.ts';
import { interactionBounds } from '../run/run-bounds.ts';
import type { ReplyRule, RulePart } from './reply-rule.ts';

const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' });

const counted = new Intl.NumberFormat('en');

type Named = readonly [string, RulePart];

function wordOf([, part]: Named): readonly string[] {
  return part.from === 'word' ? Object.keys(part.words) : [];
}

function partsFrom(rule: ReplyRule, from: RulePart['from']): readonly string[] {
  return Object.entries(rule)
    .filter(([, part]: Named) => part.from === from)
    .map(([property]: Named) => property);
}

export function howToAnswer(rule: ReplyRule): string {
  const values = Object.entries(rule).flatMap((named: Named) => wordOf(named));
  const rest = partsFrom(rule, 'rest');
  const text = partsFrom(rule, 'text');
  const first = values.length > 0 ? `reply with one of ${values.join(', ')}` : 'reply with your answer in words';
  const following = rest.length > 0 ? `; what follows is kept as the ${listed.format(rest)}` : '';
  const whole = text.length > 0 ? `; the whole reply is kept as the ${listed.format(text)}` : '';
  return `To answer, ${first}${following}${whole}.`;
}

const mostSentencesTold = 5;

export function tellingWords(rule: ReplyRule, because: ReplyRefusal, issues: readonly Issue[]): string {
  if (because === 'too_long') {
    return `A reply may hold at most ${counted.format(interactionBounds.messageBytes)} bytes.`;
  }
  if (because === 'ambiguous') {
    return 'Several questions are open here; reply to the message of the one you answer.';
  }
  const answer = howToAnswer(rule);
  return because === 'invalid'
    ? `That reply is not an answer this request takes: ${issues
        .slice(0, mostSentencesTold)
        .map(({ detail }) => detail)
        .join(' ')} ${answer}`
    : answer;
}
