import { pointerOf } from '@on.auto/json-schema';
import { Predicate, Result, SchemaIssue, type Schema, type StandardSchema } from 'effect';

import { issueAt, type DocumentIssue, type SourceLines } from './document-issue.ts';
import { readFrontMatter } from './front-matter-reading.ts';
import { describingPointers, frontMatterTextIssues } from './written-texts.ts';

export interface FrontMatterSection {
  readonly name: string | undefined;
  readonly keys: readonly string[];
}

export interface FrontMatterShape {
  readonly sections: readonly FrontMatterSection[];
  readonly decode: (root: unknown) => Result.Result<unknown, Schema.SchemaError>;
  readonly required: string;
}

export interface ReadFrontMatter {
  readonly root: Schema.JsonObject;
  readonly lines: SourceLines;
  readonly issues: readonly DocumentIssue[];
}

type IssueSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function isPropertyKey(segment: IssueSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function sectionAt(root: Schema.JsonObject, path: readonly string[]): unknown {
  return path.reduce<unknown>((value, key) => (Predicate.isObject(value) ? Reflect.get(value, key) : undefined), root);
}

function unknownKeyIssues(
  root: Schema.JsonObject,
  lines: SourceLines,
  sections: readonly FrontMatterSection[],
): readonly DocumentIssue[] {
  return sections.flatMap(({ name, keys }) => {
    const path = name === undefined ? [] : name.split('.');
    const section = sectionAt(root, path);
    const unknown = Predicate.isObject(section) && !Array.isArray(section) ? Object.keys(section) : [];
    return unknown
      .filter((key) => !keys.includes(key))
      .map((key) =>
        issueAt(
          lines,
          pointerOf([...path, key]),
          `${key} is not a key of ${name ?? 'the front matter'}; it takes ${keys.join(', ')}`,
        ),
      );
  });
}

function detailOf(message: string, path: readonly PropertyKey[]): string {
  return message === 'Missing key' ? `${String(path.at(-1))} is required` : message;
}

function typeIssues(root: Schema.JsonObject, lines: SourceLines, shape: FrontMatterShape): readonly DocumentIssue[] {
  return Result.match(shape.decode(root), {
    onSuccess: () => [],
    onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatIssues(issue).issues.map(({ message, path = [] }) => {
        const keys = path.filter((segment) => isPropertyKey(segment));
        return issueAt(lines, pointerOf(keys), detailOf(message, keys));
      }),
  });
}

export function frontMatterIn(
  text: string,
  firstLine: number,
  shape: FrontMatterShape,
): Result.Result<ReadFrontMatter, readonly DocumentIssue[]> {
  return Result.map(
    readFrontMatter(text, firstLine, shape.required, new Set(describingPointers)),
    ({ value, lines, positions }) => ({
      root: value,
      lines,
      issues: [
        ...unknownKeyIssues(value, lines, shape.sections),
        ...typeIssues(value, lines, shape),
        ...frontMatterTextIssues({ root: value, positions }, { lines: text.split('\n'), firstLine }),
      ],
    }),
  );
}
