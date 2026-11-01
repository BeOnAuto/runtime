import { Option, Schema } from 'effect';

const metaField = '_meta';

const ContentBlockSchema = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
});

const AnswerSchema = Schema.Struct({
  content: Schema.Array(ContentBlockSchema),
  structuredContent: Schema.optionalKey(Schema.Json),
});

const ToolResultSchema = Schema.Struct({
  content: Schema.Array(ContentBlockSchema),
  structuredContent: Schema.optionalKey(Schema.Unknown),
  isError: Schema.optionalKey(Schema.Boolean),
  [metaField]: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export const ToolAnnotationsSchema = Schema.Struct({
  readOnlyHint: Schema.optionalKey(Schema.Boolean),
  destructiveHint: Schema.optionalKey(Schema.Boolean),
  idempotentHint: Schema.optionalKey(Schema.Boolean),
  openWorldHint: Schema.optionalKey(Schema.Boolean),
});

const ListedToolSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  inputSchema: Schema.JsonObject,
  annotations: Schema.optionalKey(
    Schema.Struct({ ...ToolAnnotationsSchema.fields, title: Schema.optionalKey(Schema.String) }),
  ),
});

export const toolMarks = ['reads', 'acts', 'unmarked'] as const;

const markGivers = ['server', 'method', 'catalogue', 'settings'] as const;

export const marksMeant =
  'reads when the tool only reads, acts when it may change something, and unmarked when nothing marks it, which counts as acts';

export const ToolMarkSchema = Schema.Literals(toolMarks);

export const MarkedBySchema = Schema.Literals(markGivers).annotate({
  description:
    'What gave the mark: server for the hints its server lists it with, or the lack of them, method for the HTTP method of its operation, catalogue for the entry of its provider, settings for its entry in the settings of whoever runs this server',
});

export type ToolMark = (typeof toolMarks)[number];

export type GivenMark = Exclude<ToolMark, 'unmarked'>;

export type MarkedBy = (typeof markGivers)[number];

export type ToolResult = typeof ToolResultSchema.Type;

export type ServedTool = typeof ListedToolSchema.Type & { readonly answersNoBody?: true };

export interface ToolMarking {
  readonly mark: ToolMark;
  readonly marked_by: MarkedBy;
}

export type ListedTool = ServedTool & ToolMarking;

export type ToolAnnotations = typeof ToolAnnotationsSchema.Type;

export function toolMarkOf(annotations: ToolAnnotations | undefined, override: GivenMark | undefined): ToolMark {
  if (override !== undefined) {
    return override;
  }
  if (annotations?.readOnlyHint === true) {
    return 'reads';
  }
  return annotations?.readOnlyHint === false || annotations?.destructiveHint === true ? 'acts' : 'unmarked';
}

export function onlyReads({ mark }: Pick<ToolMarking, 'mark'>): boolean {
  return mark === 'reads';
}

type ContentBlock = typeof ContentBlockSchema.Type;

export type AnswerBlock = ContentBlock;

export type ToolAnswer = typeof AnswerSchema.Type;

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(AnswerSchema));

const noAnswer: ToolAnswer = { content: [] };

export function answerOf(resultJson: string): ToolAnswer {
  return Option.getOrElse(decodeAnswer(resultJson), () => noAnswer);
}

const decodeJsonText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

export const decodeToolResult = Schema.decodeUnknownSync(ToolResultSchema);

export const decodeListedTools = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Array(ListedToolSchema) }));

const nothing = '(The tool answered with no content.)';

const mostErrorCharacters = 300;

const mostLoggedCharacters = 2000;

export function metaValueOf(result: ToolResult, key: string): unknown {
  return result[metaField]?.[key];
}

function placeholderOf({ type, mimeType }: ContentBlock): string {
  return mimeType === undefined ? `[${type} content, not shown]` : `[${type} content (${mimeType}), not shown]`;
}

function isText(block: ContentBlock): block is ContentBlock & { readonly text: string } {
  return block.type === 'text' && block.text !== undefined;
}

export function resultText({ content, structuredContent }: ToolResult): string {
  const hasText = content.some((block) => isText(block));
  const blocks = content.map((block) => (isText(block) ? block.text : placeholderOf(block)));
  const lines = hasText || structuredContent === undefined ? blocks : [JSON.stringify(structuredContent), ...blocks];
  return lines.length === 0 ? nothing : lines.join('\n');
}

export function answerDocument({ content, structuredContent }: ToolAnswer): Schema.Json | undefined {
  if (structuredContent !== undefined) {
    return structuredContent;
  }
  const text = content.find((block) => isText(block))?.text;
  return text === undefined ? undefined : Option.getOrElse(decodeJsonText(text), () => text);
}

export function errorTextForModel(text: string, scrub: (text: string) => string): string {
  return scrub(text.trim()).slice(0, mostErrorCharacters);
}

export function errorTextForOperator(text: string, scrub: (text: string) => string): string {
  return scrub(text.trim()).slice(0, mostLoggedCharacters);
}
