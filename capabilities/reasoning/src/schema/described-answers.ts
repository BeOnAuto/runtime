import { Option, Schema } from 'effect';

const howToAnswer =
  'Answer with only a JSON value that matches this JSON Schema, and no other text. Leave out a property that is not required when you have no value for it.';

export function describedInstructions(instructions: string | undefined, schema: Schema.JsonObject): string {
  const described = `${howToAnswer}\n\n${JSON.stringify(schema)}`;
  return instructions === undefined ? described : `${instructions}\n\n${described}`;
}

const jsonOf = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const oneCodeFence = /^```[^\n`]*\n(?<inside>[\s\S]*)\n```$/u;

function insideOneCodeFence(text: string): Option.Option<string> {
  return Option.fromNullishOr(oneCodeFence.exec(text.trim())?.groups?.['inside']);
}

export function answerValueOf(text: string): Option.Option<Schema.Json> {
  return Option.orElse(jsonOf(text), () => Option.flatMap(insideOneCodeFence(text), jsonOf));
}
