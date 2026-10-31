import { Order } from 'effect';

import { isReadOnly } from '../bounds/tool-results.ts';
import type { AvailableServer, ServerTool, ToolServer } from '../listing/tool-server.ts';
import { bestFoundOn } from './found-tools.ts';
import { rankedOf, type Searchable } from './search-scoring.ts';
import { wordsIn } from './search-terms.ts';

export interface RequestCarrier {
  readonly server: string;
  readonly connection?: string;
  readonly provider: string | null;
  readonly sending: string;
  readonly reading?: string;
}

const sendingVerb = /^(?:send|post|publish|comment|mail)(?:s|es|ed|ing|a|an)?$|^repl(?:y|ies|ied|ying)$/u;

const makingVerb = /^(?:creat|writ)(?:e|es|ed|ing)$/u;

const sentNoun = /^(?:message|comment|e?mail)s?$/u;

const anotherOperation =
  /^(?:(?:updat|delet|remov|archiv|hid|mov|renam|retriev)(?:e|es|ed|ing)|(?:edit|pin|unpin|trash|set|mark|get|list|read|search|find|fetch|download|count)(?:s|es|ed|ing|ned|ning|ting)?)$/u;

const sendingTerms = 'send post mail comment message';

const readingTerms = 'replies thread messages comments';

function carries(words: readonly string[], form: Readonly<RegExp>): boolean {
  return words.some((word) => form.test(word));
}

function namesASending(name: string): boolean {
  const words = wordsIn(name);
  const sends = carries(words, sendingVerb) || (carries(words, makingVerb) && carries(words, sentNoun));
  return sends && !carries(words, anotherOperation);
}

function sendsWithAnAnswer({ name, annotations, answersNoBody }: ServerTool): boolean {
  const adds = !isReadOnly(annotations) && annotations?.destructiveHint !== true;
  return adds && answersNoBody !== true && namesASending(name);
}

function byWhatItDoes({ name, description }: ServerTool): Searchable {
  return { names: [name], argumentNames: [], description };
}

const byName = Order.mapInput(Order.String, ({ name }: ServerTool) => name);

function sendingOn({ tools }: AvailableServer): ServerTool | undefined {
  const senders = tools.filter((tool) => sendsWithAnAnswer(tool));
  const [best] = rankedOf(senders, sendingTerms, byWhatItDoes, byName);
  return best;
}

function carriedBy(server: ToolServer): readonly RequestCarrier[] {
  const sending = 'unavailable' in server ? undefined : sendingOn(server);
  if (sending === undefined) {
    return [];
  }
  const [reading] = bestFoundOn(server, { only: 'read', terms: readingTerms });
  const { name, connection, provider } = server;
  return [
    {
      server: name,
      ...(connection === undefined ? {} : { connection }),
      provider,
      sending: sending.name,
      ...(reading === undefined ? {} : { reading: reading.tool }),
    },
  ];
}

export function requestCarriersAmong(servers: readonly ToolServer[]): readonly RequestCarrier[] {
  return servers.flatMap((server) => carriedBy(server));
}
