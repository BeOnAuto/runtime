import { Schema } from 'effect';

const NameSchema = Schema.Struct({ name: Schema.String });

const EmphasisSchema = Schema.Struct({ emphasis: Schema.String });

const CodeSchema = Schema.Struct({ code: Schema.String });

const PhrasedDefinitionSchema = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  title: Schema.optionalKey(Schema.String),
});

const DefinitionPhraseSchema = Schema.Struct({ definition: PhrasedDefinitionSchema });

const ServerPhraseSchema = Schema.Struct({ server: Schema.String });

const PhraseSchema = Schema.Union([
  Schema.String,
  NameSchema,
  EmphasisSchema,
  CodeSchema,
  DefinitionPhraseSchema,
  ServerPhraseSchema,
]);

const PhrasesSchema = Schema.Array(PhraseSchema);

const ParagraphSchema = Schema.Struct({ kind: Schema.Literal('paragraph'), phrases: PhrasesSchema });

const BulletListSchema = Schema.Struct({ kind: Schema.Literal('list'), items: Schema.Array(PhrasesSchema) });

const NumberedListSchema = Schema.Struct({ kind: Schema.Literal('numbered'), items: Schema.Array(PhrasesSchema) });

const FieldRowSchema = Schema.Struct({ name: Schema.String, required: Schema.Boolean, words: PhrasesSchema });

const FieldTableSchema = Schema.Struct({
  kind: Schema.Literal('fields'),
  rows: Schema.Array(FieldRowSchema),
  more: Schema.optionalKey(Schema.Int),
});

const NodeShapeSchema = Schema.Literals(['step', 'decision', 'terminal', 'cylinder']);

const DiagramNodeSchema = Schema.Struct({ label: Schema.String, shape: Schema.optionalKey(NodeShapeSchema) });

const DiagramEdgeSchema = Schema.Struct({
  from: Schema.Int,
  to: Schema.Int,
  label: Schema.optionalKey(Schema.String),
  dashed: Schema.optionalKey(Schema.Boolean),
});

const DiagramGroupSchema = Schema.Struct({
  label: Schema.String,
  nodes: Schema.Array(Schema.Int),
  within: Schema.optionalKey(Schema.Int),
});

const DiagramSchema = Schema.Struct({
  kind: Schema.Literal('diagram'),
  nodes: Schema.Array(DiagramNodeSchema),
  edges: Schema.Array(DiagramEdgeSchema),
  groups: Schema.optionalKey(Schema.Array(DiagramGroupSchema)),
});

const QuoteSchema = Schema.Struct({ kind: Schema.Literal('quote'), lines: Schema.Array(PhrasesSchema) });

const OverviewBlockSchema = Schema.Union([
  ParagraphSchema,
  BulletListSchema,
  NumberedListSchema,
  FieldTableSchema,
  DiagramSchema,
  QuoteSchema,
]);

const OverviewSectionSchema = Schema.Struct({ heading: Schema.String, blocks: Schema.Array(OverviewBlockSchema) });

const OverviewSchema = Schema.Struct({
  title: Schema.String,
  opening: PhrasesSchema,
  body: Schema.Array(OverviewBlockSchema),
  sections: Schema.Array(OverviewSectionSchema),
  appendix: Schema.Array(OverviewSectionSchema),
});

export type PhrasedDefinition = typeof PhrasedDefinitionSchema.Type;

export type Phrase = typeof PhraseSchema.Type;

export type Phrases = typeof PhrasesSchema.Type;

export type Paragraph = typeof ParagraphSchema.Type;

export type BulletList = typeof BulletListSchema.Type;

export type NumberedList = typeof NumberedListSchema.Type;

export type FieldRow = typeof FieldRowSchema.Type;

export type FieldTable = typeof FieldTableSchema.Type;

export type NodeShape = typeof NodeShapeSchema.Type;

export type DiagramNode = typeof DiagramNodeSchema.Type;

export type DiagramEdge = typeof DiagramEdgeSchema.Type;

export type DiagramGroup = typeof DiagramGroupSchema.Type;

export type Diagram = typeof DiagramSchema.Type;

export type Quote = typeof QuoteSchema.Type;

export type OverviewBlock = typeof OverviewBlockSchema.Type;

export type OverviewSection = typeof OverviewSectionSchema.Type;

export type Overview = typeof OverviewSchema.Type;

export const encodedOverview = Schema.encodeSync(OverviewSchema);

export const decodedOverview = Schema.decodeUnknownSync(OverviewSchema);

export const mostTableRows = 50;

const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const disjunction = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' });

export function named(name: string): typeof NameSchema.Type {
  return { name };
}

export function definitionPhrase({ type, name, title }: PhrasedDefinition): typeof DefinitionPhraseSchema.Type {
  return { definition: title === undefined ? { type, name } : { type, name, title } };
}

export function paragraph(...phrases: Phrases): Paragraph {
  return { kind: 'paragraph', phrases };
}

export function bulletList(items: readonly Phrases[]): BulletList {
  return { kind: 'list', items };
}

export function numberedList(items: readonly Phrases[]): NumberedList {
  return { kind: 'numbered', items };
}

type Joiner = 'and' | 'or';

type Separation = 'as-listed' | 'serial-when-items-hold-commas';

function holdsAComma(item: Phrases): boolean {
  return item.some((phrase) => typeof phrase === 'string' && phrase.includes(','));
}

function separatorOf(value: string, joiner: Joiner, serial: boolean): string {
  return serial && value === ` ${joiner} ` ? `, ${joiner} ` : value;
}

export function listedPhrases(
  items: readonly Phrases[],
  joiner: Joiner,
  separation: Separation = 'as-listed',
): Phrases {
  const format = joiner === 'and' ? conjunction : disjunction;
  const serial = separation === 'serial-when-items-hold-commas' && items.some((item) => holdsAComma(item));
  return format
    .formatToParts(items.map((_, index) => String(index)))
    .flatMap(({ type, value }: { readonly type: string; readonly value: string }) =>
      type === 'element'
        ? items.filter((_, index) => String(index) === value).flat()
        : [separatorOf(value, joiner, serial)],
    );
}

export function fieldTable(rows: readonly FieldRow[]): FieldTable {
  const more = rows.length - mostTableRows;
  return more > 0 ? { kind: 'fields', rows: rows.slice(0, mostTableRows), more } : { kind: 'fields', rows };
}

export function sectionOf(heading: string, ...blocks: readonly OverviewBlock[]): OverviewSection {
  return { heading, blocks };
}
