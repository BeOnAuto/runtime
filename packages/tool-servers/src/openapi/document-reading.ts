import { readFile, stat } from 'node:fs/promises';

import type { FetchLike } from '@modelcontextprotocol/client';
import { problem, readYaml, type SettingProblem, type YamlKind } from '@on.auto/config';
import { nestedDeeperThan } from '@on.auto/json-schema';
import { boundedAnswerOf } from '@on.auto/outbound';
import { Data, Result } from 'effect';

import { at } from '../settings/checked.ts';
import { toolServersSetting } from '../settings/server-entries.ts';
import type { ApiDocumentSource, ShippedDocument } from '../settings/server-settings.ts';
import { DocumentRefused } from './described-api.ts';

export const documentBounds = { bytes: 4_194_304, operations: 500, readMs: 10_000, nesting: 128 } as const;

type Problems = readonly SettingProblem[];

export class DocumentUnread extends Data.TaggedError('document_unread')<{ readonly problems: Problems }> {}

export interface DocumentReading {
  readonly entry: string;
  readonly fetch: FetchLike;
  readonly readMs: number;
}

type Read = Result.Result<unknown, DocumentUnread | DocumentRefused>;

type Text = Result.Result<string, DocumentUnread | DocumentRefused>;

const yamlDocument: YamlKind = {
  noun: 'an OpenAPI document',
  mapping: 'An OpenAPI document is a mapping of its fields',
  mostDepth: documentBounds.nesting,
  emptyIsMapping: false,
};

const tooLarge = `The document takes more than the ${documentBounds.bytes} bytes a document of a tool server may take`;

function problemsAt(entry: string, detail: string): Problems {
  return [problem(toolServersSetting, at(entry, 'document'), detail)];
}

function refused(entry: string, detail: string): DocumentRefused {
  return new DocumentRefused({ problems: problemsAt(entry, detail) });
}

function unread(entry: string, detail: string): DocumentUnread {
  return new DocumentUnread({ problems: problemsAt(entry, detail) });
}

const accepted = 'application/json, application/yaml;q=0.9, text/yaml;q=0.9, */*;q=0.1';

const mostProblemsNamed = 3;

function unreadAnswer(status: number): string {
  return status >= 300 && status < 400
    ? `The document could not be read: its URL answered a redirect, HTTP ${status}, which the runtime does not follow; give the address it redirects to`
    : `The document could not be read: its URL answered HTTP ${status}`;
}

export function documentInText(text: string): Result.Result<unknown, string> {
  try {
    const parsed: unknown = JSON.parse(text);
    return Result.succeed(parsed);
  } catch {
    const reading = readYaml(text, yamlDocument);
    if ('document' in reading) {
      return Result.succeed(reading.document.value);
    }
    const located = reading.problems
      .slice(0, mostProblemsNamed)
      .map(({ position, detail }) => `line ${position.line}, column ${position.column}: ${detail}`);
    return Result.fail(located.join('; '));
  }
}

function parsedText(text: string, entry: string): Read {
  return Result.mapError(documentInText(text), (located) =>
    unread(entry, `The document is neither JSON nor YAML: ${located}`),
  );
}

function boundedParse(text: string, entry: string): Read {
  return Result.flatMap(parsedText(text, entry), (value) =>
    nestedDeeperThan(value, documentBounds.nesting)
      ? Result.fail(refused(entry, `The document nests values more than ${documentBounds.nesting} levels deep`))
      : Result.succeed(value),
  );
}

async function textAt(url: string, { entry, fetch, readMs }: DocumentReading): Promise<Text> {
  const signal = AbortSignal.timeout(readMs);
  let overflowed = false;
  try {
    const response = await fetch(url, { headers: { accept: accepted }, redirect: 'manual', signal });
    if (!response.ok) {
      await response.body?.cancel();
      return Result.fail(unread(entry, unreadAnswer(response.status)));
    }
    const text = await boundedAnswerOf(response, documentBounds.bytes, () => {
      overflowed = true;
    }).text();
    return Result.succeed(text);
  } catch (failure) {
    if (overflowed) {
      return Result.fail(refused(entry, tooLarge));
    }
    return Result.fail(
      unread(
        entry,
        signal.aborted
          ? `The document was not read within ${readMs} ms`
          : `The document could not be read: ${failure instanceof Error ? failure.message : String(failure)}`,
      ),
    );
  }
}

async function textIn(path: string, entry: string): Promise<Text> {
  try {
    if ((await stat(path)).size > documentBounds.bytes) {
      return Result.fail(refused(entry, tooLarge));
    }
    return Result.succeed(await readFile(path, 'utf8'));
  } catch (failure) {
    const code = String(Reflect.get(new Object(failure), 'code'));
    return Result.fail(
      unread(entry, code === 'ENOENT' ? 'The document does not exist' : `The document could not be read (${code})`),
    );
  }
}

function shippedText({ text, bytes }: ShippedDocument, entry: string): Text {
  return bytes > documentBounds.bytes ? Result.fail(refused(entry, tooLarge)) : Result.succeed(text);
}

function textOf(source: ApiDocumentSource, reading: DocumentReading): Promise<Text> {
  if (source.kind === 'url') {
    return textAt(source.url, reading);
  }
  return source.kind === 'file'
    ? textIn(source.path, reading.entry)
    : Promise.resolve(shippedText(source.document, reading.entry));
}

export async function documentOf(source: ApiDocumentSource, reading: DocumentReading): Promise<Read> {
  const text = await textOf(source, reading);
  return Result.flatMap(text, (read) => boundedParse(read, reading.entry));
}
