import type { KeptContent } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { cutAsStored } from '../bounds/text-bytes.ts';
import { answerDocument, answerOf } from '../bounds/tool-results.ts';

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

interface KeptFacts {
  readonly arguments_sha256?: string;
  readonly result_sha256?: string;
}

function keptText(digest: string | undefined, content: KeptContent): string | undefined {
  return digest === undefined ? undefined : content(digest);
}

export function keptArgumentsOf(fact: KeptFacts, content: KeptContent): { readonly arguments?: Schema.Json } {
  const text = keptText(fact.arguments_sha256, content);
  if (text === undefined) {
    return {};
  }
  return Option.match(decodeJson(text), {
    onNone: () => ({}),
    onSome: (value) => ({ arguments: value }),
  });
}

function answerShown(text: string): { readonly answer?: Schema.Json } {
  const answer = answerDocument(answerOf(text));
  return answer === undefined ? {} : { answer };
}

export function keptAnswerOf(
  fact: KeptFacts,
  content: KeptContent,
): { readonly result?: Schema.Json; readonly answer?: Schema.Json } {
  const text = keptText(fact.result_sha256, content);
  if (text === undefined) {
    return {};
  }
  return Option.match(decodeJson(text), {
    onNone: () => ({}),
    onSome: (result) => ({ result, ...answerShown(text) }),
  });
}

const mostTextBytes: Readonly<Record<string, number>> = {
  call_id: 256,
  server: 256,
  tool: 256,
  conversation: 256,
  since: 256,
  arguments_sha256: 128,
  result_sha256: 128,
  jsonrpc_id: 128,
  server_request_id: 256,
  detail: 1024,
};

export function callFieldsShown(data: Schema.JsonObject): Readonly<Record<string, Schema.Json>> {
  const shown: Record<string, Schema.Json> = {};
  for (const [field, value] of Object.entries(data)) {
    const mostBytes = mostTextBytes[field];
    shown[field] = typeof value === 'string' && mostBytes !== undefined ? cutAsStored(value, mostBytes) : value;
  }
  return shown;
}
