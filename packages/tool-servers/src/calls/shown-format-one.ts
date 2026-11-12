import { Option, Schema } from 'effect';

const ContentBlockSchema = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
});

const AnswerSchema = Schema.Struct({
  content: Schema.Array(ContentBlockSchema),
  structuredContent: Schema.optionalKey(Schema.Json),
});

type ContentBlock = typeof ContentBlockSchema.Type;

type Answer = typeof AnswerSchema.Type;

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(AnswerSchema));

const noAnswer: Answer = { content: [] };

function answerOf(resultJson: string): Answer {
  return Option.getOrElse(decodeAnswer(resultJson), () => noAnswer);
}

const nothing = '(The tool answered with no content.)';

function placeholderOf({ type, mimeType }: ContentBlock): string {
  return mimeType === undefined ? `[${type} content, not shown]` : `[${type} content (${mimeType}), not shown]`;
}

function isText(block: ContentBlock): block is ContentBlock & { readonly text: string } {
  return block.type === 'text' && block.text !== undefined;
}

function resultText({ content, structuredContent }: Answer): string {
  const hasText = content.some((block) => isText(block));
  const blocks = content.map((block) => (isText(block) ? block.text : placeholderOf(block)));
  const lines = hasText || structuredContent === undefined ? blocks : [JSON.stringify(structuredContent), ...blocks];
  return lines.length === 0 ? nothing : lines.join('\n');
}

export function textShownInFormatOne(kept: string): string {
  return resultText(answerOf(kept));
}
