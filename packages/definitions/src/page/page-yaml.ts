import { Option, Result, Schema } from 'effect';

import type { DocumentIssue, SourceLines } from '../document/document-issue.ts';
import { splitDocument } from '../document/document-split.ts';
import { readFrontMatter } from '../document/front-matter-reading.ts';
import type { DocumentWrittenIn } from './page-lines.ts';
import type { PageWrittenIn } from './subject-pages-port.ts';

export type PageReadAs = PageWrittenIn | 'mapping';

function isBare(readAs: PageReadAs): boolean {
  return readAs === 'playbook' || readAs === 'mapping';
}

export interface PageMappingRead {
  readonly mapping: unknown;
  readonly lines: SourceLines;
}

interface Place {
  readonly yaml: string;
  readonly firstLine: number;
}

const pageKey = '/page';

function placeOf(source: string, writtenIn: PageReadAs): Option.Option<Place> {
  if (writtenIn !== 'function') {
    return Option.some({ yaml: source, firstLine: 1 });
  }
  return Option.map(Result.getSuccess(splitDocument(source, 'A function')), ({ frontMatter, frontMatterLine }) => ({
    yaml: frontMatter,
    firstLine: frontMatterLine,
  }));
}

function linesOfThePage(lines: SourceLines): SourceLines {
  return new Map(
    [...lines].flatMap(([pointer, line]: readonly [string, number]): readonly (readonly [string, number])[] => {
      if (pointer === pageKey) {
        return [['', line]];
      }
      return pointer.startsWith(`${pageKey}/`) ? [[pointer.slice(pageKey.length), line]] : [];
    }),
  );
}

function mappingOf(root: Schema.JsonObject, lines: SourceLines, writtenIn: PageReadAs): Option.Option<PageMappingRead> {
  if (isBare(writtenIn)) {
    return Option.some({ mapping: root, lines });
  }
  return Object.hasOwn(root, 'page')
    ? Option.some({ mapping: root['page'], lines: linesOfThePage(lines) })
    : Option.none();
}

export function pageMappingIn(
  source: string,
  writtenIn: PageReadAs,
): Result.Result<Option.Option<PageMappingRead>, readonly DocumentIssue[]> {
  return Option.match(placeOf(source, writtenIn), {
    onNone: () => Result.succeedNone,
    onSome: ({ yaml, firstLine }) =>
      Result.match(readFrontMatter(yaml, firstLine), {
        onFailure: (issues) => (isBare(writtenIn) ? Result.fail(issues) : Result.succeedNone),
        onSuccess: ({ value, lines }) => Result.succeed(mappingOf(value, lines, writtenIn)),
      }),
  });
}

const isJsonObject = Schema.is(Schema.JsonObject);

export function carriesAPage(source: string, writtenIn: DocumentWrittenIn): boolean {
  const page = Option.getOrUndefined(Option.flatten(Result.getSuccess(pageMappingIn(source, writtenIn))))?.mapping;
  return isJsonObject(page) && Object.keys(page).length > 0;
}
