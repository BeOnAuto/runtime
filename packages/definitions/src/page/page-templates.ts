import { capitalized } from '@on.auto/phrasing';
import { Result } from 'effect';

import { fencesIn } from '../charts/chart-fences.ts';
import { chartInfoOf } from '../charts/chart-info.ts';
import { rowRefusalsIn } from '../charts/row-refusals.ts';
import type { DocumentIssue } from '../document/document-issue.ts';
import { templateEngine } from '../template/template-engine.ts';
import { parsedTemplate, type ParsedTemplate, type VariableReference } from '../template/template-parsing.ts';
import {
  pageBlockNames,
  type PageBlock,
  type PageBlockName,
  type PageBlocks,
  type PageTemplates,
  type PageViews,
} from './page-document.ts';
import { pageTemplateWords } from './template-refusals.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export const pageEngine = templateEngine(() => ({ withoutTags: ['tablerow'] }));

interface Readable {
  readonly fields?: readonly string[];
  readonly words: string;
}

const moment = (words: string): Readable => ({ fields: [], words });

const subject: Readable = {
  fields: ['type', 'name', 'description', 'version'],
  words: 'the subject, with type, name, description and version',
};

type TemplateOf = PageBlockName | 'glance';

const readsOf: Readonly<Record<TemplateOf, Readonly<Record<string, Readable>>>> = {
  result: {
    output: { words: "the run's output" },
    run: {
      fields: ['status', 'started', 'ended', 'version'],
      words: 'the run, with status, started, ended and version',
    },
    subject,
    today: moment('the date, as YYYY-MM-DD'),
    now: moment('the time, in ISO 8601'),
  },
  runs: {
    views: { words: 'the views' },
    subject,
    today: moment('the date, as YYYY-MM-DD'),
    now: moment('the time, in ISO 8601'),
  },
  glance: {
    views: { words: 'the views' },
    output: { words: "the latest ended run's output" },
    run: {
      fields: ['status', 'started', 'ended', 'version'],
      words: 'the latest ended run, with status, started, ended and version',
    },
    subject,
    today: moment('the date, as YYYY-MM-DD'),
    now: moment('the time, in ISO 8601'),
  },
};

const namesInWords: Readonly<Record<TemplateOf, string>> = {
  result: 'output, run, subject, today and now',
  runs: 'views, subject, today and now',
  glance: 'views, output, run, subject, today and now',
};

const noViews: PageViews = {};

function fieldDetail(root: string, field: string, { fields, words }: Readable): string | undefined {
  if (fields === undefined || fields.includes(field)) {
    return undefined;
  }
  return fields.length === 0
    ? `${root} is ${words}, and has no fields`
    : `${root}.${field} is not a field of ${root}, which is ${words}`;
}

function viewDetail(field: string, views: PageViews): string | undefined {
  const declared = Object.keys(views);
  return declared.includes(field)
    ? undefined
    : `views.${field} is not a view that data.views declares; it declares ${declared.join(', ')}`;
}

function referenceDetail(block: TemplateOf, { path }: VariableReference, views: PageViews): string | undefined {
  const root = String(path[0]);
  const field = path[1];
  const readable = Object.hasOwn(readsOf[block], root) ? readsOf[block][root] : undefined;
  if (readable === undefined) {
    return `${root} is not a variable of ${block}, which reads ${namesInWords[block]}; assign it first`;
  }
  if (typeof field !== 'string') {
    return undefined;
  }
  return root === 'views' ? viewDetail(field, views) : fieldDetail(root, field, readable);
}

function variableIssues(block: TemplateOf, parsed: ParsedTemplate, views: PageViews): readonly DocumentIssue[] {
  return parsed.variables.flatMap((reference) => {
    const detail = referenceDetail(block, reference, views);
    return detail === undefined ? [] : [{ line: reference.line, pointer: '', detail }];
  });
}

function writtenOut(info: string): boolean {
  return !info.includes('{{') && !info.includes('{%');
}

function chartIssues({ text, line }: PageBlock): readonly DocumentIssue[] {
  return fencesIn(text.split('\n')).flatMap((fence) => {
    const reading = writtenOut(fence.info) ? chartInfoOf(fence.info) : { other: true };
    return 'refused' in reading
      ? [{ line: line + fence.first, pointer: '', detail: capitalized(reading.refused) }]
      : [];
  });
}

function rowIssues({ text, line }: PageBlock): readonly DocumentIssue[] {
  return rowRefusalsIn(text.split('\n')).map(({ at, detail }) => ({ line: line + at, pointer: '', detail }));
}

function templateOf(
  block: TemplateOf,
  written: PageBlock,
  views: PageViews,
  more: readonly DocumentIssue[] = [],
): Checked<ParsedTemplate> {
  const parsing = parsedTemplate(pageEngine, written.text, written.line);
  if (Result.isFailure(parsing)) {
    return Result.fail(
      parsing.failure.map(({ line, detail }) => ({ line, pointer: '', detail: pageTemplateWords(detail) })),
    );
  }
  const parsed = parsing.success;
  const issues = [
    ...parsed.issues.map(({ line, detail }) => ({ line, pointer: '', detail })),
    ...variableIssues(block, parsed, views),
    ...more,
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(parsed);
}

export function glanceTemplateOf(written: PageBlock, views: PageViews): Checked<ParsedTemplate> {
  return templateOf('glance', written, views);
}

export function pageTemplatesOf(blocks: PageBlocks, views: PageViews = noViews): Checked<PageTemplates> {
  const issues: DocumentIssue[] = [];
  const templates: Partial<Record<PageBlockName, ParsedTemplate>> = {};
  for (const block of pageBlockNames) {
    const written = blocks[block];
    const checked =
      written === undefined
        ? undefined
        : templateOf(block, written, views, [...chartIssues(written), ...rowIssues(written)]);
    if (checked !== undefined && Result.isFailure(checked)) {
      issues.push(...checked.failure);
    } else if (checked !== undefined) {
      templates[block] = checked.success;
    }
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(templates);
}
