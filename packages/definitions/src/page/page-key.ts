import { Option, Result, Schema } from 'effect';

import { issueAt, reportedIssues, type DocumentIssue } from '../document/document-issue.ts';
import { keysChecked, type FrontMatterSection } from '../document/front-matter-keys.ts';
import { sizeIssues } from './page-blocks.ts';
import { blockIndicator, pageDataOf } from './page-data.ts';
import type { PageBlock, PageBlocks, PageData, PageDefinitionDocument } from './page-document.ts';
import { PageDataSchema, PageSourceSchema } from './page-front-matter.ts';
import { pageTemplatesOf } from './page-templates.ts';
import { pageMappingIn, type PageMappingRead, type PageReadAs } from './page-yaml.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export type PageRead = Checked<Option.Option<PageDefinitionDocument | null>>;

const PageMappingSchema = Schema.Struct({
  data: Schema.optionalKey(PageDataSchema),
  result: Schema.optionalKey(Schema.String),
  lately: Schema.optionalKey(Schema.String),
});

type PageMapping = typeof PageMappingSchema.Type;

function sectionsOf(writtenIn: PageReadAs): readonly FrontMatterSection[] {
  const page = writtenIn === 'function' ? 'the page in the front matter' : 'the page';
  return [
    { name: undefined, keys: Object.keys(PageMappingSchema.fields), said: page },
    { name: 'data', keys: Object.keys(PageDataSchema.fields), said: "the page's data" },
    { name: 'data.source', keys: Object.keys(PageSourceSchema.fields), said: "the page's data.source" },
  ];
}

const isJsonObject = Schema.is(Schema.JsonObject);

const decodeMapping = Schema.decodeUnknownResult(PageMappingSchema, { errors: 'all' });

const notAMapping = 'page is a mapping of data, result and lately';

const latelyNeedsData =
  'lately renders the views that data keeps, so a page with lately has data, and a page with data has lately';

const playbookHasNoRuns = 'The playbook has no runs of its own, so its page has no result';

interface Reading extends PageMappingRead {
  readonly documentLines: readonly string[];
  readonly writtenIn: PageReadAs;
}

function blockAt(text: string, pointer: string, { lines, documentLines }: Reading): PageBlock {
  const line = issueAt(lines, pointer, '').line;
  return { text, line: blockIndicator.test(String(documentLines[line - 1])) ? line + 1 : line };
}

function blocksOf({ result, lately }: PageMapping, reading: Reading): PageBlocks {
  return {
    ...(result === undefined ? {} : { result: blockAt(result, '/result', reading) }),
    ...(lately === undefined ? {} : { lately: blockAt(lately, '/lately', reading) }),
  };
}

function pairingIssues({ data, result, lately }: PageMapping, { lines, writtenIn }: Reading): readonly DocumentIssue[] {
  const unpaired =
    (data === undefined) === (lately === undefined)
      ? []
      : [issueAt(lines, data === undefined ? '/lately' : '/data', latelyNeedsData)];
  const ofThePlaybook =
    writtenIn === 'playbook' && result !== undefined ? [issueAt(lines, '/result', playbookHasNoRuns)] : [];
  return [...unpaired, ...ofThePlaybook];
}

function dataOf({ data }: PageMapping, { lines, documentLines }: Reading): Checked<Option.Option<PageData>> {
  return data === undefined
    ? Result.succeedNone
    : Result.map(pageDataOf(data, { lines, textLineOf: (line) => String(documentLines[line - 1]) }), Option.some);
}

function issuesOf<A>(check: () => Checked<A>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function documentOf(mapping: PageMapping, reading: Reading): Checked<PageDefinitionDocument> {
  const blocks = blocksOf(mapping, reading);
  const data = dataOf(mapping, reading);
  const firstLine = issueAt(reading.lines, '', '').line;
  const issues = [...pairingIssues(mapping, reading), ...issuesOf(() => data), ...sizeIssues(blocks, firstLine)];
  if (issues.length > 0 || Result.isFailure(data)) {
    return Result.fail(issues);
  }
  const read = Option.getOrUndefined(data.success);
  return Result.map(pageTemplatesOf(blocks, read?.views), (templates) => ({
    ...(read === undefined ? {} : { data: read }),
    blocks,
    templates,
  }));
}

function mappingRead(reading: Reading): Checked<PageDefinitionDocument | null> {
  const { mapping, lines } = reading;
  if (!isJsonObject(mapping)) {
    return Result.fail([issueAt(lines, '', notAMapping)]);
  }
  if (Object.keys(mapping).length === 0) {
    return Result.succeed(null);
  }
  const checked = keysChecked(mapping, lines, { sections: sectionsOf(reading.writtenIn), decode: decodeMapping });
  const decoded = decodeMapping(mapping);
  if (checked.issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail(checked.issues);
  }
  return documentOf(decoded.success, reading);
}

export function pageIn(source: string, writtenIn: PageReadAs): PageRead {
  return Result.flatMap(Result.map(pageMappingIn(source, writtenIn), Option.getOrUndefined), (read) =>
    read === undefined
      ? Result.succeedNone
      : Result.mapBoth(mappingRead({ ...read, documentLines: source.split('\n'), writtenIn }), {
          onFailure: reportedIssues,
          onSuccess: Option.some,
        }),
  );
}
