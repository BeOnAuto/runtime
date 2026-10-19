import type { Schema } from 'effect';
import {
  Context,
  Liquid,
  Tokenizer,
  TypeGuards,
  toValueSync,
  type Emitter,
  type StaticAnalysis,
  type Template,
} from 'liquidjs';

import { renderDeadlineOn, type RenderClock } from './render-clock.ts';

export const templateLimits = {
  characters: 65_536,
  names: 1000,
  renderMilliseconds: 200,
  memory: 5_000_000,
  renderedCharacters: 200_000,
} as const;

const keptFilters: ReadonlySet<string> = new Set([
  'abs',
  'append',
  'array_to_sentence_string',
  'at_least',
  'at_most',
  'base64_decode',
  'base64_encode',
  'capitalize',
  'ceil',
  'compact',
  'concat',
  'default',
  'divided_by',
  'downcase',
  'escape',
  'escape_once',
  'find',
  'find_index',
  'first',
  'floor',
  'group_by',
  'has',
  'join',
  'json',
  'last',
  'lstrip',
  'map',
  'minus',
  'modulo',
  'newline_to_br',
  'normalize_whitespace',
  'number_of_words',
  'plus',
  'pop',
  'prepend',
  'push',
  'raw',
  'reject',
  'remove',
  'remove_first',
  'remove_last',
  'replace',
  'replace_first',
  'replace_last',
  'reverse',
  'round',
  'rstrip',
  'shift',
  'size',
  'slice',
  'slugify',
  'sort',
  'sort_natural',
  'split',
  'squish',
  'strip',
  'strip_newlines',
  'sum',
  'times',
  'to_integer',
  'truncate',
  'truncatewords',
  'uniq',
  'unshift',
  'upcase',
  'where',
  'xml_escape',
]);

const removedTags = ['include', 'render', 'layout', 'block', 'capture'] as const;

export type TagDefinition = Parameters<Liquid['registerTag']>[1];

export type FilterDefinition = Parameters<Liquid['registerFilter']>[1];

export interface EngineRegistrations {
  readonly filters?: Readonly<Record<string, FilterDefinition>>;
  readonly tags?: Readonly<Record<string, TagDefinition>>;
}

export interface TemplateEngine {
  readonly parse: (body: string) => Template[];
  readonly namesIn: (body: string) => number;
  readonly analyze: (templates: () => Template[]) => StaticAnalysis;
  readonly render: (
    templates: () => Template[],
    variables: Readonly<Record<string, Schema.Json>>,
    emitter: Readonly<Emitter>,
    clock: RenderClock,
  ) => void;
}

const namePattern = /[A-Za-z_][\w-]*/gu;

function noRegistrations(): EngineRegistrations {
  return {};
}

function namesOf(liquid: () => Liquid, body: string): number {
  let names = 0;
  for (const token of new Tokenizer(body).readTopLevelTokens(liquid().options)) {
    if (TypeGuards.isTagToken(token) || TypeGuards.isOutputToken(token)) {
      names += token.content.match(namePattern)?.length ?? 0;
    }
  }
  return names;
}

function tagsRemovedFrom(liquid: () => Liquid): void {
  for (const name of removedTags) {
    Reflect.deleteProperty(liquid().tags, name);
  }
}

function contextLimitedBy(
  clock: RenderClock,
  liquid: () => Liquid,
  variables: Readonly<Record<string, Schema.Json>>,
): Context {
  const context = new Context({ ...variables }, liquid().options, { sync: true }, { liquid: liquid() });
  Reflect.set(context, 'renderLimit', renderDeadlineOn(clock, templateLimits.renderMilliseconds));
  return context;
}

function engineOver(liquid: () => Liquid): TemplateEngine {
  return {
    parse: (body) => liquid().parse(body),
    namesIn: (body) => namesOf(liquid, body),
    analyze: (templates) => liquid().analyzeSync(templates(), { partials: false }),
    render: (templates, variables, emitter, clock) => {
      toValueSync(liquid().renderer.renderTemplates(templates(), contextLimitedBy(clock, liquid, variables), emitter));
    },
  };
}

export function templateEngine(registrations: () => EngineRegistrations = noRegistrations): TemplateEngine {
  const { filters = {}, tags = {} } = registrations();
  const liquid = new Liquid({
    templates: {},
    strictFilters: true,
    strictVariables: true,
    lenientIf: true,
    ownPropertyOnly: true,
    parseLimit: templateLimits.characters,
    memoryLimit: templateLimits.memory,
  });
  for (const name of Object.keys(liquid.filters).filter((filter) => !keptFilters.has(filter))) {
    liquid.unregisterFilter(name);
  }
  tagsRemovedFrom(() => liquid);
  for (const [name, filter] of Object.entries(filters)) {
    liquid.registerFilter(name, filter);
  }
  for (const [name, tag] of Object.entries(tags)) {
    liquid.registerTag(name, tag);
  }
  return engineOver(() => liquid);
}
