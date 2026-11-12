import { Option, Schema } from 'effect';

const metaField = '_meta';

const TextContentSchema = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String });

const ImageContentSchema = Schema.Struct({ type: Schema.Literal('image'), mimeType: Schema.String });

const AudioContentSchema = Schema.Struct({ type: Schema.Literal('audio'), mimeType: Schema.String });

const ResourceLinkSchema = Schema.Struct({
  type: Schema.Literal('resource_link'),
  uri: Schema.String,
  name: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.Number),
});

const resourceContentsFields = { uri: Schema.String, mimeType: Schema.optionalKey(Schema.String) };

const TextResourceContentsSchema = Schema.Struct({ ...resourceContentsFields, text: Schema.String });

const BlobResourceContentsSchema = Schema.Struct({ ...resourceContentsFields, blob: Schema.String });

const EmbeddedResourceSchema = Schema.Struct({
  type: Schema.Literal('resource'),
  resource: Schema.Union([TextResourceContentsSchema, BlobResourceContentsSchema]),
});

const OtherContentSchema = Schema.Struct({ type: Schema.String, mimeType: Schema.optionalKey(Schema.Unknown) });

const ContentBlockSchema = Schema.Union([
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema,
  OtherContentSchema,
]);

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

const isTextContent = Schema.is(TextContentSchema);

const isResourceLink = Schema.is(ResourceLinkSchema);

const isEmbeddedResource = Schema.is(EmbeddedResourceSchema);

const isTextResourceContents = Schema.is(TextResourceContentsSchema);

interface Unshown {
  readonly type: string;
  readonly mimeType?: unknown;
}

function placeholderOf({ type, mimeType }: Unshown): string {
  return typeof mimeType === 'string' ? `[${type} content (${mimeType}), not shown]` : `[${type} content, not shown]`;
}

function textCarriedBy(block: ContentBlock): string | undefined {
  if (isTextContent(block)) {
    return block.text;
  }
  return isEmbeddedResource(block) && isTextResourceContents(block.resource) ? block.resource.text : undefined;
}

function shownWithoutText(block: ContentBlock): string {
  if (isResourceLink(block)) {
    return JSON.stringify(block);
  }
  return isEmbeddedResource(block) ? placeholderOf({ ...block.resource, type: block.type }) : placeholderOf(block);
}

function shownOf(block: ContentBlock): string {
  return textCarriedBy(block) ?? shownWithoutText(block);
}

function textsCarriedIn(content: readonly ContentBlock[]): readonly string[] {
  return content.flatMap((block) => {
    const text = textCarriedBy(block);
    return text === undefined ? [] : [text];
  });
}

export function resultText({ content, structuredContent }: ToolResult): string {
  const hasText = textsCarriedIn(content).length > 0;
  const blocks = content.map((block) => shownOf(block));
  const lines = hasText || structuredContent === undefined ? blocks : [JSON.stringify(structuredContent), ...blocks];
  return lines.length === 0 ? nothing : lines.join('\n');
}

export function answerDocument({ content, structuredContent }: ToolAnswer): Schema.Json | undefined {
  if (structuredContent !== undefined) {
    return structuredContent;
  }
  const texts = textsCarriedIn(content);
  if (texts.length === 0) {
    return undefined;
  }
  const text = texts.join('\n');
  return Option.getOrElse(decodeJsonText(text), () => text);
}

export function errorTextForModel(text: string, scrub: (text: string) => string): string {
  return scrub(text.trim()).slice(0, mostErrorCharacters);
}

export function errorTextForOperator(text: string, scrub: (text: string) => string): string {
  return scrub(text.trim()).slice(0, mostLoggedCharacters);
}
