import type { NamedDefinition } from '../used-by/user-relations.ts';

interface Name {
  readonly name: string;
}

interface Emphasis {
  readonly emphasis: string;
}

interface Code {
  readonly code: string;
}

interface TitledDefinition extends NamedDefinition {
  readonly title?: string;
}

interface DefinitionPhrase {
  readonly definition: TitledDefinition;
}

interface ServerPhrase {
  readonly server: string;
}

export type Phrase = string | Name | Emphasis | Code | DefinitionPhrase | ServerPhrase;

export type Phrases = readonly Phrase[];

export interface Paragraph {
  readonly kind: 'paragraph';
  readonly phrases: Phrases;
}

export interface BulletList {
  readonly kind: 'list';
  readonly items: readonly Phrases[];
}

export interface NumberedList {
  readonly kind: 'numbered';
  readonly items: readonly Phrases[];
}

export interface FieldRow {
  readonly name: string;
  readonly required: boolean;
  readonly words: Phrases;
}

export interface FieldTable {
  readonly kind: 'fields';
  readonly rows: readonly FieldRow[];
}

export type NodeShape = 'step' | 'decision' | 'terminal' | 'cylinder';

export interface DiagramNode {
  readonly label: string;
  readonly shape?: NodeShape;
}

export interface DiagramEdge {
  readonly from: number;
  readonly to: number;
  readonly label?: string;
  readonly dashed?: boolean;
}

export interface DiagramGroup {
  readonly label: string;
  readonly nodes: readonly number[];
  readonly within?: number;
}

export interface Diagram {
  readonly kind: 'diagram';
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly groups?: readonly DiagramGroup[];
}

export interface Quote {
  readonly kind: 'quote';
  readonly lines: readonly Phrases[];
}

export type OverviewBlock = Paragraph | BulletList | NumberedList | FieldTable | Diagram | Quote;

export interface OverviewSection {
  readonly heading: string;
  readonly blocks: readonly OverviewBlock[];
}

export interface Overview {
  readonly title: string;
  readonly opening: Phrases;
  readonly body: readonly OverviewBlock[];
  readonly sections: readonly OverviewSection[];
  readonly appendix: readonly OverviewSection[];
}

const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const disjunction = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' });

export function named(name: string): Name {
  return { name };
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

export function listedPhrases(items: readonly Phrases[], joiner: 'and' | 'or'): Phrases {
  const format = joiner === 'and' ? conjunction : disjunction;
  return format
    .formatToParts(items.map((_, index) => String(index)))
    .flatMap(({ type, value }: { readonly type: string; readonly value: string }) =>
      type === 'element' ? items.filter((_, index) => String(index) === value).flat() : [value],
    );
}

export function sectionOf(heading: string, ...blocks: readonly OverviewBlock[]): OverviewSection {
  return { heading, blocks };
}
