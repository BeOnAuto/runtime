import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { providersShippedRoots, readProviders, type ProviderEntry } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const OperationSchema = Schema.Struct({
  operationId: Schema.String,
  parameters: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.optionalKey(Schema.String) }))),
  requestBody: Schema.optionalKey(Schema.Unknown),
});

type Operation = typeof OperationSchema.Type;

const decodePaths = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ paths: Schema.Record(Schema.String, Schema.Record(Schema.String, OperationSchema)) }),
  ),
);

const readingMethods: ReadonlySet<string> = new Set(['get', 'head']);

interface DocumentTool {
  readonly mark: 'reads' | 'acts';
  readonly takes: readonly string[];
}

function toolOf(method: string, { operationId, parameters = [], requestBody }: Operation, reads: ReadonlySet<string>) {
  const named = parameters.flatMap(({ name }) => (name === undefined ? [] : [name]));
  const takes = requestBody === undefined ? named : [...named, 'body'];
  const mark = readingMethods.has(method) || reads.has(operationId) ? 'reads' : 'acts';
  return [operationId, { mark, takes }] as const;
}

function toolsOfTheDocument({ document, marks }: ProviderEntry): ReadonlyMap<string, DocumentTool> {
  const { paths } = decodePaths(shipped.documents.get(document ?? '')?.text ?? '{"paths":{}}');
  const reads = new Set(marks?.reads ?? []);
  return new Map(
    Object.values(paths).flatMap((operations) =>
      Object.entries(operations).map(([method, operation]: readonly [string, Operation]) =>
        toolOf(method, operation, reads),
      ),
    ),
  );
}

function placeNamesDeclaredBy(entry: ProviderEntry) {
  const tools = toolsOfTheDocument(entry);
  return (entry.events?.types ?? []).flatMap(({ type, subject }) => {
    const name = subject?.name;
    const tool = name === undefined ? undefined : tools.get(name.tool);
    const untaken = Object.keys(name?.with ?? {}).filter((argument) => tool?.takes.includes(argument) !== true);
    return name === undefined ? [] : [[entry.name, type, name.tool, tool?.mark, untaken]];
  });
}

describe('the names of the places the shipped providers read', () => {
  it('are each read through a tool of the entry’s own document that is marked reads and takes each argument it writes, and declared by Slack Bot alone', () => {
    expect(shipped.providers.flatMap(({ entry }) => placeNamesDeclaredBy(entry))).toEqual([
      ['slack-bot', 'com.slack.message', 'conversations_info', 'reads', []],
    ]);
  });
});
