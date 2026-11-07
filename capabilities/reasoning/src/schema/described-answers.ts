import { Option, Schema } from 'effect';

const jsonOf = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const oneCodeFence = /^```[^\n`]*\n(?<inside>[\s\S]*)\n```$/u;

function insideOneCodeFence(text: string): Option.Option<string> {
  return Option.fromNullishOr(oneCodeFence.exec(text.trim())?.groups?.['inside']);
}

export function answerValueOf(text: string): Option.Option<Schema.Json> {
  return Option.orElse(jsonOf(text), () => Option.flatMap(insideOneCodeFence(text), jsonOf));
}
