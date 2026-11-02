import { outputInWords } from '@on.auto/definitions';
import { counted } from '@on.auto/phrasing';
import { Option, Schema } from 'effect';

import { MemoryScopeSchema } from '../facts/memory-facts.ts';
import { scopeInWords } from '../facts/memory-streams.ts';

const RememberedSchema = Schema.Struct({ id: Schema.String, version: Schema.Int, scope: MemoryScopeSchema });

const RecalledSchema = Schema.Struct({ memories: Schema.Array(Schema.Unknown) });

const decodeRemembered = Schema.decodeUnknownOption(RememberedSchema);

const decodeRecalled = Schema.decodeUnknownOption(RecalledSchema);

export const memoryNoun = { one: 'memory', other: 'memories' };

const inWords = outputInWords('result');

function recalledInWords(output: Schema.Json): string | undefined {
  return Option.getOrUndefined(
    Option.map(decodeRecalled(output), ({ memories }) =>
      memories.length === 0 ? 'It recalled no memory.' : `It recalled ${counted(memories.length, memoryNoun)}.`,
    ),
  );
}

function rememberedInWords(output: Schema.Json): string | undefined {
  return Option.getOrUndefined(
    Option.map(
      decodeRemembered(output),
      ({ id, version, scope }) => `It kept version ${version} of the memory ${id} among ${scopeInWords(scope)}.`,
    ),
  );
}

export function describeMemoryOutput(output: Schema.Json): string {
  return recalledInWords(output) ?? rememberedInWords(output) ?? inWords(output);
}
