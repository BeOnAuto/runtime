import { Result } from 'effect';

import { issueAt, reportedIssues, type DocumentIssue, type SourceLines } from '../document/document-issue.ts';
import { splitDocument, type DocumentParts } from '../document/document-split.ts';
import { frontMatterIn, type ReadFrontMatter } from '../document/front-matter-keys.ts';
import { pageBlocksIn } from './page-blocks.ts';
import { pageDataOf } from './page-data.ts';
import type { PageBlocks, PageData, PageDefinitionDocument, PageTemplates } from './page-document.ts';
import { decodePageFrontMatter, pageFrontMatter, type PageFrontMatter } from './page-front-matter.ts';
import { pageTemplatesOf } from './page-templates.ts';
import type { PageOf } from './subject-pages-port.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

const runsNeedsData =
  '{% lately %} renders the views that data keeps, so a page with {% lately %} has data, and a page with data has {% lately %}';

const playbookHasNoRuns = 'The playbook has no runs of its own, so its page has no {% result %}';

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function unpairedIssues(front: PageFrontMatter, blocks: PageBlocks, lines: SourceLines): readonly DocumentIssue[] {
  if (front.data !== undefined && blocks.runs === undefined) {
    return [issueAt(lines, '/data', runsNeedsData)];
  }
  return front.data === undefined && blocks.runs !== undefined
    ? [{ line: blocks.runs.line, pointer: '', detail: runsNeedsData }]
    : [];
}

interface Reading {
  readonly lines: SourceLines;
  readonly of: PageOf;
}

function pairingIssues(front: PageFrontMatter, blocks: PageBlocks, { lines, of }: Reading): readonly DocumentIssue[] {
  const playbookResult =
    of === 'playbook' && blocks.result !== undefined
      ? [{ line: blocks.result.line, pointer: '', detail: playbookHasNoRuns }]
      : [];
  return [...unpairedIssues(front, blocks, lines), ...playbookResult];
}

interface DataPart {
  readonly data?: PageData;
}

function dataOf(front: PageFrontMatter, read: ReadFrontMatter, parts: DocumentParts): Checked<DataPart> {
  if (front.data === undefined) {
    return Result.succeed({});
  }
  const frontLines = parts.frontMatter.split('\n');
  return Result.map(
    pageDataOf(front.data, {
      lines: read.lines,
      textLineOf: (line) => String(frontLines[line - parts.frontMatterLine]),
    }),
    (data) => ({ data }),
  );
}

interface Written {
  readonly data: DataPart;
  readonly blocks: PageBlocks;
  readonly templates: PageTemplates;
}

function assembled(front: PageFrontMatter, { data: { data }, blocks, templates }: Written) {
  const document: PageDefinitionDocument = {
    ...(front.description === undefined ? {} : { description: front.description }),
    ...(data === undefined ? {} : { data }),
    blocks,
    templates,
  };
  return document;
}

function documentFrom(read: ReadFrontMatter, parts: DocumentParts, of: PageOf): Checked<PageDefinitionDocument> {
  const blocks = pageBlocksIn(parts.body, parts.bodyLine);
  const decoded = decodePageFrontMatter(read.root);
  if (read.issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...read.issues, ...issuesOf(() => blocks)]);
  }
  const front = decoded.success;
  const data = dataOf(front, read, parts);
  const issues = [
    ...issuesOf(() => data),
    ...issuesOf(() => blocks),
    ...(Result.isSuccess(blocks) ? pairingIssues(front, blocks.success, { lines: read.lines, of }) : []),
  ];
  if (issues.length > 0 || Result.isFailure(data) || Result.isFailure(blocks)) {
    return Result.fail(issues);
  }
  return Result.map(pageTemplatesOf(blocks.success, data.success.data?.views), (templates) =>
    assembled(front, { data: data.success, blocks: blocks.success, templates }),
  );
}

function documentOf(parts: DocumentParts, of: PageOf): Checked<PageDefinitionDocument> {
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, pageFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...issuesOf(() => pageBlocksIn(parts.body, parts.bodyLine))])
    : documentFrom(reading.success, parts, of);
}

export function parsePageDocument(source: string, of: PageOf = 'definition'): Checked<PageDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A page'), (parts) => documentOf(parts, of)),
    reportedIssues,
  );
}
