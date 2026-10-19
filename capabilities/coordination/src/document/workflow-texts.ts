import type { Position } from '@on.auto/config';
import { AboutSchema, writtenTextIssues } from '@on.auto/definitions/document';
import { field, objectField, rejection, textField, type JsonObject, type Rejection } from '@on.auto/workflow-engine';
import { Result, Schema, SchemaIssue } from 'effect';

interface WorkflowText {
  readonly key: string;
  readonly pointer: string;
  readonly text: string;
}

interface PlacedTextIssue {
  readonly pointer: string;
  readonly position: Position;
  readonly detail: string;
}

const aboutPointer = '/document/metadata/about';

const decodeAbout = Schema.decodeUnknownResult(AboutSchema);

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

export function headerOf(document: JsonObject): JsonObject {
  return objectField(document, 'document') ?? {};
}

function metadataOf(header: JsonObject): JsonObject {
  return objectField(header, 'metadata') ?? {};
}

function writtenAt(key: string, pointer: string, text: string | undefined): WorkflowText | undefined {
  return text === undefined ? undefined : { key, pointer, text };
}

export function descriptionOf(header: JsonObject): WorkflowText | undefined {
  const key = textField(header, 'summary') === undefined ? 'title' : 'summary';
  return writtenAt(key, `/document/${key}`, textField(header, key));
}

export function aboutOf(header: JsonObject): WorkflowText | undefined {
  return writtenAt('about', aboutPointer, textField(metadataOf(header), 'about'));
}

export function aboutRejections(header: JsonObject): readonly Rejection[] {
  const about = field(metadataOf(header), 'about');
  return about === undefined
    ? []
    : Result.match(decodeAbout(about), {
        onSuccess: () => [],
        onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
          formatIssues(issue).issues.map(({ message }) => rejection(aboutPointer, message)),
      });
}

export function textIssuesIn(
  header: JsonObject,
  source: string,
  locate: (pointer: string) => Position,
): readonly PlacedTextIssue[] {
  const lines = source.split('\n');
  return [descriptionOf(header), aboutOf(header)].flatMap((written) =>
    written === undefined
      ? []
      : writtenTextIssues(written.text, written.key, { lines, firstLine: 1 }, locate(written.pointer)).map(
          ({ line, column, detail }) => ({ pointer: written.pointer, position: { line, column }, detail }),
        ),
  );
}
