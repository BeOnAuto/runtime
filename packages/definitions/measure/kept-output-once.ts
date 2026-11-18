import { argv, exit } from 'node:process';

import { textToKeep } from '@on.auto/content';
import { AssetKeeper, PlaybookContext, playbookLedgerOf, type ValueKeeping } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Exit, type Schema } from 'effect';

import { keptOutputOf } from '../src/kept-outputs/kept-output.ts';

const [, , mebibytesGiven = '0', shape = 'text', keeping = 'kept'] = argv;

const bytes = Math.round(Number(mebibytesGiven) * 1_048_576);

const row = { row: 1_234_567, city: 'Lyon', note: 'a line of text in a row of rows' };

const rowBytes = JSON.stringify(row).length + 1;

function outputOf(): Schema.Json {
  if (shape === 'rows') {
    return { title: 'The export', rows: Array.from({ length: Math.ceil(bytes / rowBytes) }, () => ({ ...row })) };
  }
  return { title: 'The export', page: 'a'.repeat(bytes) };
}

async function drained(stream: ReadableStream<Uint8Array>): Promise<number> {
  let taken = 0;
  for await (const piece of stream) {
    taken += piece.byteLength;
  }
  return taken;
}

const intoNowhere: ValueKeeping = {
  kept: (_run, value) =>
    Effect.map(
      Effect.promise(() => drained(textToKeep(value.text, value.mediaType).stream)),
      (taken) => ({
        id: '019a8f2e-6b1c-7d4a-9e3f-2a1b0c9d8e7f',
        media_type: value.mediaType,
        bytes: taken,
        sha256: 'e'.repeat(64),
        address: null,
        address_until: null,
      }),
    ),
};

const run = {
  context: {
    by: 'acme-admin',
    runId: '019a8f2e-6b1c-7d4a-9e3f-2a1b0c9d8e7f',
    definitionType: 'computation',
    definitionName: 'the-export',
    definitionVersion: 1,
  },
  lineage: { causationId: null, correlationId: null },
};

const playbook = { org: 'acme', playbook: 'alpha' };

const output = outputOf();

const kept =
  keeping === 'kept'
    ? await Effect.runPromiseExit(
        keptOutputOf(
          { output, record: {} },
          { run, schema: {}, calledAToolThatMayChangeSomething: Effect.succeed(false) },
        ).pipe(
          Effect.provide(playbookLedgerOf(memoryLedger().service, playbook)),
          Effect.provideService(PlaybookContext, playbook),
          Effect.provideService(AssetKeeper, intoNowhere),
        ),
      )
    : Exit.succeed(output);

exit(Exit.isSuccess(kept) ? 0 : 1);
