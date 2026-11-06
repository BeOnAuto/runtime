import type { Schema } from 'effect';

import type { EventFilter, FilterExpression } from '../document/event-filters.ts';
import type { OutputShapeName } from '../shapes/shape-names.ts';
import type { ParsedTemplate } from '../template/template-parsing.ts';

export const pageBlockNames = ['result', 'runs'] as const;

export type PageBlockName = (typeof pageBlockNames)[number];

export interface PageBlock {
  readonly text: string;
  readonly line: number;
}

export type PageBlocks = Readonly<Partial<Record<PageBlockName, PageBlock>>>;

export type PageViews = Readonly<Record<string, OutputShapeName>>;

export interface PageData {
  readonly views: PageViews;
  readonly filters: readonly EventFilter[];
  readonly filterExpressions: readonly FilterExpression[];
  readonly fold: string;
  readonly foldLine: number;
}

export type PageTemplates = Readonly<Partial<Record<PageBlockName, ParsedTemplate>>>;

export type ParsedGlance =
  | { readonly kind: 'text'; readonly template: ParsedTemplate; readonly whole: boolean }
  | { readonly kind: 'value'; readonly value: Schema.Json }
  | { readonly kind: 'list'; readonly items: readonly ParsedGlance[] }
  | { readonly kind: 'mapping'; readonly entries: readonly (readonly [string, ParsedGlance])[] };

export interface PageDefinitionDocument {
  readonly description?: string;
  readonly data?: PageData;
  readonly glance?: ParsedGlance;
  readonly blocks: PageBlocks;
  readonly templates: PageTemplates;
}
