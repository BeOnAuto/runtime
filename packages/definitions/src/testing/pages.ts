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

export const documentedPage = String(fencedIn(pageFormat, '````', 'markdown')[0]);

export const documentedLately = String(fencedIn(pageFormat, '````', 'markdown')[1]);

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
  readonly of?: string;
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

export function pageOf({
  of = 'workflow/morning-social-content',
  front = '',
  data,
  body = resultOfTheDate,
}: PageParts = {}): string {
  const lines = [`of: ${of}`, ...(front === '' ? [] : [front]), ...(data === undefined ? [] : [data])];
  return `---\n${lines.join('\n')}\n---\n${body}\n`;
}

interface DataParts extends PageParts {
  readonly module?: string;
  readonly views?: string;
}

export function pageWithData({ module, views, ...parts }: DataParts = {}): string {
  return pageOf({ body: `${resultOfTheDate}\n\n${latelyOfTheDays}`, ...parts, data: pageData(module, views) });
}
