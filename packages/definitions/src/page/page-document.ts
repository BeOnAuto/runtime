import type { EventFilter, FilterExpression } from '../document/event-filters.ts';
import type { OutputShapeName } from '../shapes/shape-names.ts';
import type { ParsedTemplate } from '../template/template-parsing.ts';

export const pageBlockNames = ['result', 'lately'] as const;

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

export interface PageDefinitionDocument {
  readonly description?: string;
  readonly data?: PageData;
  readonly blocks: PageBlocks;
  readonly templates: PageTemplates;
}
