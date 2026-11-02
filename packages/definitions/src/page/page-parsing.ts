import { Result } from 'effect';

import { issueAt, reportedIssues, type DocumentIssue, type SourceLines } from '../document/document-issue.ts';
import { splitDocument, type DocumentParts } from '../document/document-split.ts';
import { frontMatterIn, type ReadFrontMatter } from '../document/front-matter-keys.ts';
import { pageBlocksIn } from './page-blocks.ts';
import { pageDataOf } from './page-data.ts';
import type { PageBlocks, PageData, PageDefinitionDocument, PageTemplates } from './page-document.ts';
import { decodePageFrontMatter, pageFrontMatter, type PageFrontMatter } from './page-front-matter.ts';
import { playbookSubject, subjectIn } from './page-subjects.ts';
import { pageTemplatesOf } from './page-templates.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

const latelyNeedsData =
  'lately renders the views that data keeps, so a page with {% lately %} has data, and a page with data has {% lately %}';

const playbookHasNoRuns = 'The playbook has no runs of its own, so its page has no {% result %}';

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function subjectIssues(of: string, lines: SourceLines): readonly DocumentIssue[] {
  const reading = subjectIn(of);
  return 'refused' in reading ? [issueAt(lines, '/of', reading.refused)] : [];
}

function unpairedIssues(front: PageFrontMatter, blocks: PageBlocks, lines: SourceLines): readonly DocumentIssue[] {
  if (front.data !== undefined && blocks.lately === undefined) {
    return [issueAt(lines, '/data', latelyNeedsData)];
  }
  return front.data === undefined && blocks.lately !== undefined
    ? [{ line: blocks.lately.line, pointer: '', detail: latelyNeedsData }]
    : [];
}

function pairingIssues(front: PageFrontMatter, blocks: PageBlocks, lines: SourceLines): readonly DocumentIssue[] {
  const playbookResult =
    front.of === playbookSubject && blocks.result !== undefined
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

function assembled(front: PageFrontMatter, lines: SourceLines, { data: { data }, blocks, templates }: Written) {
  const document: PageDefinitionDocument = {
    ...(front.description === undefined ? {} : { description: front.description }),
    of: front.of,
    ofLine: issueAt(lines, '/of', '').line,
    ...(data === undefined ? {} : { data }),
    blocks,
    templates,
  };
  return document;
}

function documentFrom(read: ReadFrontMatter, parts: DocumentParts): Checked<PageDefinitionDocument> {
  const blocks = pageBlocksIn(parts.body, parts.bodyLine);
  const decoded = decodePageFrontMatter(read.root);
  if (read.issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...read.issues, ...issuesOf(() => blocks)]);
  }
  const front = decoded.success;
  const data = dataOf(front, read, parts);
  const issues = [
    ...subjectIssues(front.of, read.lines),
    ...issuesOf(() => data),
    ...issuesOf(() => blocks),
    ...(Result.isSuccess(blocks) ? pairingIssues(front, blocks.success, read.lines) : []),
  ];
  if (issues.length > 0 || Result.isFailure(data) || Result.isFailure(blocks)) {
    return Result.fail(issues);
  }
  return Result.map(pageTemplatesOf(blocks.success, data.success.data?.views), (templates) =>
    assembled(front, read.lines, { data: data.success, blocks: blocks.success, templates }),
  );
}

function documentOf(parts: DocumentParts): Checked<PageDefinitionDocument> {
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, pageFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...issuesOf(() => pageBlocksIn(parts.body, parts.bodyLine))])
    : documentFrom(reading.success, parts);
}

export function parsePageDocument(source: string): Checked<PageDefinitionDocument> {
  return Result.mapError(Result.flatMap(splitDocument(source, 'A page'), documentOf), reportedIssues);
}
