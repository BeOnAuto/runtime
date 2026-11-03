import { readFileSync } from 'node:fs';

import { Schema } from 'effect';

const pageFormat = readFileSync(new URL('../../../../docs/reference/page-format.md', import.meta.url), 'utf8');

function fencedIn(text: string, fence: string, language: string): readonly string[] {
  const opening = `\n${fence}${language}\n`;
  const closing = `\n${fence}\n`;
  const found: string[] = [];
  for (let at = text.indexOf(opening); at !== -1; at = text.indexOf(opening, at + 1)) {
    const start = at + opening.length;
    found.push(text.slice(start, text.indexOf(closing, start) + 1));
  }
  return found;
}

export const documentedPage = String(fencedIn(pageFormat, '````', 'yaml')[0]);

export const documentedLately = String(fencedIn(pageFormat, '````', 'markdown')[0]);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

export const documentedJson = fencedIn(pageFormat, '```', 'json').map((text) => decodeJson(text));

export const documentedMarkdown = fencedIn(pageFormat, '```', 'markdown');

const foldingNothing = 'export function fold(view: View, event: Event): View {\n  return view;\n}';

function indented(text: string, spaces: number): string {
  return text
    .split('\n')
    .map((line) => `${' '.repeat(spaces)}${line}`)
    .join('\n');
}

interface PageParts {
  readonly front?: string;
  readonly data?: string;
  readonly body?: string;
}

export const resultOfTheDate = '{% result %}\n{{ output.date }}\n{% endresult %}';

export const latelyOfTheDays = '{% lately %}\n```chart line\n{{ views.by_day | json }}\n```\n{% endlately %}';

export function pageData(module = foldingNothing, views = 'by_day: series'): string {
  return [
    'data:',
    '  language: typescript',
    '  source:',
    '    events:',
    '      - type: run_succeeded',
    '        subject: workflow/morning-social-content',
    '  views:',
    indented(views, 4),
    '  module: |',
    indented(module, 4),
  ].join('\n');
}

export function pageOf({ front = '', data, body = resultOfTheDate }: PageParts = {}): string {
  const lines = [...(front === '' ? [] : [front]), ...(data === undefined ? [] : [data])];
  return `---\n${lines.map((line) => `${line}\n`).join('')}---\n${body}\n`;
}

interface LegacyDataParts extends PageParts {
  readonly module?: string;
  readonly views?: string;
}

export function pageWithData({ module, views, ...parts }: LegacyDataParts = {}): string {
  return pageOf({ body: `${resultOfTheDate}\n\n${latelyOfTheDays}`, ...parts, data: pageData(module, views) });
}

export const resultOfTheDay = '{{ output.date }}';

export const latelyOfTheDayChart = '```chart line\n{{ views.by_day | json }}\n```';

interface PageKeyParts {
  readonly data?: string;
  readonly result?: string;
  readonly lately?: string;
  readonly more?: string;
}

function blockOf(key: string, text: string | undefined): readonly string[] {
  return text === undefined ? [] : [`${key}: |`, indented(text, 2)];
}

export function pageMappingOf({ data, result, lately, more }: PageKeyParts): string {
  return [
    ...(more === undefined ? [] : [more]),
    ...(data === undefined ? [] : [data]),
    ...blockOf('result', result),
    ...blockOf('lately', lately),
  ].join('\n');
}

const resultAlone: PageKeyParts = { result: resultOfTheDay };

export function workflowWithPage(parts: PageKeyParts = resultAlone): string {
  return `name: morning-social-content\npage:\n${indented(pageMappingOf(parts), 2)}\n`;
}

export function functionWithPage(parts: PageKeyParts = resultAlone): string {
  return `---\nmodel: openai/gpt-5\npage:\n${indented(pageMappingOf(parts), 2)}\n---\nSay good morning.\n`;
}

interface DataParts {
  readonly module?: string;
  readonly views?: string;
}

export function workflowWithData({ module, views }: DataParts = {}): string {
  return workflowWithPage({ data: pageData(module, views), result: resultOfTheDay, lately: latelyOfTheDayChart });
}
