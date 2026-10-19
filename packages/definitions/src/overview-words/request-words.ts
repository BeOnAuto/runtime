import { capitalized } from '@on.auto/operations';

import { durationInWords } from '../overview/duration-words.ts';
import { plainTextOf } from '../overview/markdown-text.ts';
import {
  listedPhrases,
  paragraph,
  sectionOf,
  type OverviewSection,
  type Paragraph,
  type Phrases,
} from '../overview/overview.ts';
import type { JsonSchema } from '../overview/schema-reading.ts';
import { schemaBlocks } from '../overview/schema-words.ts';
import { meaningAt } from './field-meanings.ts';
import { answeredWords, givenClause } from './field-sentences.ts';
import { quoteLead } from './template-words.ts';
import { theToolAsWritten } from './tool-words.ts';

export type ValueWords = Readonly<Record<string, readonly string[]>>;

type ReplyPart = { readonly from: 'word'; readonly words: ValueWords } | { readonly from: 'rest' | 'text' };

export type ReplyParts = Readonly<Record<string, ReplyPart>>;

type Asks = 'answer' | 'nothing';

interface MessageSent {
  readonly input?: JsonSchema | undefined;
  readonly party: Phrases;
  readonly server?: string | undefined;
}

interface Route {
  readonly server: string;
  readonly tool: string;
  readonly replies?: { readonly tool: string; readonly wait?: string | undefined } | undefined;
}

interface Where {
  readonly to: string;
  readonly from?: string | undefined;
  readonly route?: Route | undefined;
  readonly expires: string;
}

export const partyNamedUnderDetails = 'the party named under Details';

export const notificationSentence = 'It sends the message and waits for nothing.';

const notificationAnswer =
  'None: it is a notification, which takes no answer and succeeds once its request is delivered.';

const inboxEndings: Readonly<Record<Asks, string>> = {
  answer: 'answers it.',
  nothing: 'reads it, and waits for nothing.',
};

export function messageLead({ input, party, server }: MessageSent): Paragraph {
  return quoteLead(
    'run',
    ...givenClause(input),
    '. It sends ',
    ...party,
    ' this message',
    ...(server === undefined ? [] : [' through ', { server }]),
  );
}

export function replyWaitSentence(expiresMs: number, readEveryMs: number): string {
  return `It waits up to ${durationInWords(expiresMs)} for a reply to that message, reading the replies at least ${durationInWords(readEveryMs)} apart.`;
}

export function answerWaitSentence(expiresMs: number): string {
  return `It waits up to ${durationInWords(expiresMs)} for the answer, which whoever may write to the playbook gives.`;
}

export function inboxSentence(asks: Asks): string {
  return `It leaves the message in the playbook's inbox, where whoever may write to the playbook ${inboxEndings[asks]}`;
}

export function unansweredSentence(expiresMs: number): string {
  return `If nobody answers within ${durationInWords(expiresMs)}, the request ends unanswered.`;
}

export function notTakenSentence(told: boolean): string {
  return `A reply that begins with any other word is not taken${told ? ', and the person is told how to answer' : ''}.`;
}

export function firstWordsOf(value: string, words: readonly string[]): string {
  return plainTextOf(
    listedPhrases(
      [value, ...words].map((word) => [word]),
      'or',
      'serial-when-items-hold-commas',
    ),
  );
}

const wholePartClauses: Readonly<Record<'rest' | 'text', (meaning: string) => string>> = {
  rest: (meaning) => `whatever follows the first word is ${meaning}`,
  text: (meaning) => `the whole reply is ${meaning}`,
};

function partClauses(part: ReplyPart, meaning: string): readonly string[] {
  if (part.from !== 'word') {
    return [wholePartClauses[part.from](meaning)];
  }
  return Object.entries(part.words).map(([value, words]: readonly [string, readonly string[]], index) =>
    index === 0
      ? `a reply whose first word is ${firstWordsOf(value, words)} gives ${meaning} ${value}`
      : `one whose first word is ${firstWordsOf(value, words)} gives ${value}`,
  );
}

export function replyRuleSentence(rule: ReplyParts, answer: JsonSchema): string {
  const clauses = Object.entries(rule).flatMap(([property, part]: readonly [string, ReplyPart]) =>
    partClauses(part, meaningAt(answer, [property], property)),
  );
  return `${capitalized(clauses.join('; '))}.`;
}

export function answerSentence(answer: JsonSchema): Paragraph {
  return paragraph('It answers with ', ...answeredWords(answer), '.');
}

export function answerSection(answer?: JsonSchema): OverviewSection {
  return sectionOf('Answer', ...schemaBlocks(answer, notificationAnswer));
}

function routeWords({ server, tool, replies }: Route): Phrases {
  const waits = replies?.wait === undefined ? [] : [', at least ', { code: replies.wait }, ' apart'];
  return [
    'Sent through ',
    ...theToolAsWritten({ server, tool }),
    ...(replies === undefined ? [] : ['; the replies read with ', ...theToolAsWritten({ server, tool: replies.tool })]),
    ...waits,
  ];
}

export function whereSection({ to, from, route, expires }: Where): OverviewSection {
  return sectionOf(
    'Where',
    paragraph(
      'To ',
      { code: to },
      ...(from === undefined ? [] : [', answered by ', { code: from }]),
      '. ',
      ...(route === undefined ? ["Left in the playbook's inbox"] : routeWords(route)),
      '; expires after ',
      { code: expires },
      '.',
    ),
  );
}
