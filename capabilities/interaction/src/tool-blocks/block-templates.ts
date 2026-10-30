import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import {
  inputVariableIssues,
  parsedTemplate,
  type ParsedTemplate,
  type RenderClock,
} from '@on.auto/definitions/template';
import { Result, type Schema } from 'effect';

import { interactionEngine } from '../document/request-templates.ts';
import { renderedText } from '../run/text-rendering.ts';
import { isLoneExpression } from '../run/value-rendering.ts';
import { childrenOf, isJsonParent, type JsonParent } from './json-children.ts';
import { notTextRemedy, type Templates } from './rendered-arguments.ts';
import { nameOf, reads, type TemplateSet } from './template-sets.ts';

export interface TemplatePlace {
  readonly lines: SourceLines;
  readonly pointer: string;
  readonly inputSchema: Schema.JsonObject | undefined;
  readonly clock: RenderClock;
}

const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' });

const theInputAndItsMoments: ReadonlySet<string> = new Set(['input', 'today', 'now']);

function readsTheInput(parsed: ParsedTemplate): boolean {
  return parsed.variables.some(({ path }) => String(path[0]) === 'input');
}

function unreadNames(set: TemplateSet, parsed: ParsedTemplate): readonly string[] {
  return [...new Set(parsed.variables.filter(({ path }) => !reads(set, path)).map(({ path }) => nameOf(set, path)))];
}

function variableDetails(set: TemplateSet, parsed: ParsedTemplate, inputSchema: Schema.JsonObject | undefined) {
  const ofTheInput = parsed.variables.filter(({ path }) => theInputAndItsMoments.has(String(path[0])));
  return [
    ...unreadNames(set, parsed).map(
      (name) => `Reads ${name}, which ${set.what} does not have; it reads ${listed.format(set.names)}`,
    ),
    ...inputVariableIssues(ofTheInput, inputSchema, set.what).map(({ detail }) => detail),
  ];
}

function rendersText(set: TemplateSet, parsed: ParsedTemplate, clock: RenderClock): boolean {
  const rendered = renderedText(parsed, set.sample, Number.POSITIVE_INFINITY, clock);
  return Result.isSuccess(rendered) || rendered.failure.reason !== 'not_text';
}

type Rendering = 'text' | 'argument';

const notTextWords: Readonly<Record<Rendering, (structured: string) => string>> = {
  text: (structured) => `Renders a value that is not text; write | json after a structured value such as ${structured}`,
  argument: () => `Renders a value that is not text among text; ${notTextRemedy}`,
};

function templateDetails(set: TemplateSet, text: string, place: TemplatePlace, rendering: Rendering) {
  if (text.includes('${')) {
    return ['Expected no ${ in a template, which never holds a secret'];
  }
  const parsed = parsedTemplate(interactionEngine, text, 1);
  if (Result.isFailure(parsed)) {
    return parsed.failure.map(({ detail }) => detail);
  }
  const details = [
    ...parsed.success.issues.map(({ detail }) => detail),
    ...variableDetails(set, parsed.success, place.inputSchema),
  ];
  const sentAsItIs = rendering === 'argument' && isLoneExpression(text);
  if (
    details.length > 0 ||
    sentAsItIs ||
    readsTheInput(parsed.success) ||
    rendersText(set, parsed.success, place.clock)
  ) {
    return details;
  }
  return [notTextWords[rendering](set.structured)];
}

function issuesOf(set: TemplateSet, text: string, place: TemplatePlace, rendering: Rendering) {
  return templateDetails(set, text, place, rendering).map((detail) => issueAt(place.lines, place.pointer, detail));
}

export function templateIssues(set: TemplateSet, text: string, place: TemplatePlace): readonly DocumentIssue[] {
  return issuesOf(set, text, place, 'text');
}

function within(place: TemplatePlace, key: string): TemplatePlace {
  return { ...place, pointer: `${place.pointer}/${key}` };
}

function valueIssues(set: TemplateSet, value: Schema.Json, place: TemplatePlace): readonly DocumentIssue[] {
  if (typeof value === 'string') {
    return issuesOf(set, value, place, 'argument');
  }
  return isJsonParent(value) ? childrenIssues(set, value, place) : [];
}

function childrenIssues(set: TemplateSet, parent: JsonParent, place: TemplatePlace): readonly DocumentIssue[] {
  return childrenOf(parent).flatMap(([key, item]) => valueIssues(set, item, within(place, key)));
}

export function templatesIssues(
  set: TemplateSet,
  templates: Templates,
  place: TemplatePlace,
): readonly DocumentIssue[] {
  return childrenIssues(set, templates, place);
}
