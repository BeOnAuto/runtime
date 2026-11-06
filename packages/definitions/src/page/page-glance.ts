import { Buffer } from 'node:buffer';

import { pointerOf } from '@on.auto/json-schema';
import { Option, Result, Schema } from 'effect';
import { toValue } from 'liquidjs';

import type { DocumentIssue } from '../document/document-issue.ts';
import { outputText } from '../template/output-text.ts';
import type { RenderClock } from '../template/render-clock.ts';
import { renderedTemplate } from '../template/template-rendering.ts';
import type { PageViews, ParsedGlance } from './page-document.ts';
import { glanceTemplateOf, pageEngine } from './page-templates.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export const mostGlanceBytes = 16_384;

const isJsonObject = Schema.is(Schema.JsonObject);

const isJsonArray = Schema.is(Schema.Array(Schema.Json));

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const wholeOutput = /^\s*\{\{[^{}]*\}\}\s*$/u;

type LineAt = (pointer: string) => number;

function itemsOf(values: readonly Schema.Json[], at: readonly string[], context: GlanceContext): Checked<ParsedGlance> {
  const issues: DocumentIssue[] = [];
  const items: ParsedGlance[] = [];
  for (const [index, value] of values.entries()) {
    const read = glanceAt(value, [...at, String(index)], context);
    if (Result.isFailure(read)) {
      issues.push(...read.failure);
    } else {
      items.push(read.success);
    }
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed({ kind: 'list', items });
}

function entriesOf(value: Schema.JsonObject, at: readonly string[], context: GlanceContext): Checked<ParsedGlance> {
  const issues: DocumentIssue[] = [];
  const entries: (readonly [string, ParsedGlance])[] = [];
  for (const [key, each] of Object.entries(value)) {
    const read = glanceAt(each, [...at, key], context);
    if (Result.isFailure(read)) {
      issues.push(...read.failure);
    } else {
      entries.push([key, read.success]);
    }
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed({ kind: 'mapping', entries });
}

interface GlanceContext {
  readonly lineAt: LineAt;
  readonly views: PageViews;
}

function glanceAt(value: Schema.Json, at: readonly string[], context: GlanceContext): Checked<ParsedGlance> {
  if (typeof value === 'string') {
    const pointer = pointerOf(['glance', ...at]);
    return Result.mapBoth(glanceTemplateOf({ text: value, line: context.lineAt(pointer) }, context.views), {
      onFailure: (issues) => issues.map((issue) => ({ ...issue, pointer })),
      onSuccess: (template): ParsedGlance => ({ kind: 'text', template, whole: wholeOutput.test(value) }),
    });
  }
  if (isJsonArray(value)) {
    return itemsOf(value, at, context);
  }
  return isJsonObject(value) ? entriesOf(value, at, context) : Result.succeed({ kind: 'value', value });
}

/**
 * A page's glance as written: a mapping whose strings are templates over the views, the latest ended run's output and
 * that run, each checked as a page's templates are, and at most 16 KiB as JSON.
 */
export function glanceOf(value: Schema.JsonObject, context: GlanceContext): Checked<ParsedGlance> {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > mostGlanceBytes) {
    return Result.fail([
      {
        line: context.lineAt('/glance'),
        pointer: '/glance',
        detail: `The glance takes ${bytes} bytes as JSON, more than the ${mostGlanceBytes} it may take`,
      },
    ]);
  }
  return entriesOf(value, [], context);
}

export interface GlanceShowing {
  readonly variables: Readonly<Record<string, Schema.Json>>;
  readonly clock: RenderClock;
}

function textOf(parsed: Extract<ParsedGlance, { kind: 'text' }>, showing: GlanceShowing): Schema.Json | undefined {
  const emitter = {
    buffer: '',
    write: (html: unknown) => {
      emitter.buffer += outputText(toValue(html));
    },
  };
  const rendered = renderedTemplate(pageEngine, parsed.template, { ...showing, emitter, refusalOf: () => {} });
  if (Result.isFailure(rendered)) {
    return undefined;
  }
  const text = emitter.buffer.trim();
  return parsed.whole ? Option.getOrElse(decodeJson(text), () => text) : text;
}

function shownAll<A>(parsed: readonly A[], show: (each: A) => Schema.Json | undefined): Schema.Json[] | undefined {
  const shown: Schema.Json[] = [];
  for (const each of parsed) {
    const value = show(each);
    if (value === undefined) {
      return undefined;
    }
    shown.push(value);
  }
  return shown;
}

function shownAt(parsed: ParsedGlance, showing: GlanceShowing): Schema.Json | undefined {
  if (parsed.kind === 'value') {
    return parsed.value;
  }
  if (parsed.kind === 'text') {
    return textOf(parsed, showing);
  }
  if (parsed.kind === 'list') {
    return shownAll(parsed.items, (each) => shownAt(each, showing));
  }
  const entries: (readonly [string, Schema.Json])[] = [];
  for (const [key, each] of parsed.entries) {
    const value = shownAt(each, showing);
    if (value === undefined) {
      return undefined;
    }
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

/**
 * A glance rendered: each template's text, and where a string was one output alone, as `{{ views.done | size }}`, the
 * JSON value its text reads as, so a number stays a number and a list a list. None where any template stops.
 */
export function glanceShown(parsed: ParsedGlance, showing: GlanceShowing): Schema.JsonObject | undefined {
  const shown = shownAt(parsed, showing);
  return isJsonObject(shown) ? shown : undefined;
}
