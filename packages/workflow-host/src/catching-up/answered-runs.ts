import { defineCapability, type Capability, type RunContext } from '@on.auto/definitions';
import { noCalledDefinitions, recordingJournal } from '@on.auto/definitions/testing';
import { allPermissions } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { SomeFolder } from '../projector/folder.ts';
import { foldedBeforeItRuns, type FoldWaitBounds } from './folded-before-runs.ts';

const askedRun: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { name: 'counted-runs', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

const decodeOutput = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Unknown }));

export function answeringCapability(answer: () => Promise<Schema.Json>): Capability {
  return defineCapability({
    type: 'counting',
    title: 'Counting',
    guide: { name: 'counting' },
    noun: { one: 'counting function', other: 'counting functions' },
    describeOutput: String,
    mediaType: 'text/plain',
    parse: (source) => Effect.succeed(source),
    summarize: () => ({}),
    run: () => Effect.map(Effect.promise(answer), (output) => ({ output, record: {} })),
  });
}

export interface AnsweredRun {
  readonly answer: () => Promise<Schema.Json>;
  readonly folders: readonly SomeFolder[];
  readonly database: HostDatabase;
  readonly bounds?: FoldWaitBounds;
}

export async function answeredOnceFolded({ answer, folders, database, bounds }: AnsweredRun): Promise<unknown> {
  const capability = foldedBeforeItRuns({
    capability: answeringCapability(answer),
    folders,
    database,
    ...(bounds === undefined ? {} : { bounds }),
  });
  const prepared = await Effect.runPromise(capability.prepare('count'));
  const answered = await Effect.runPromise(prepared.run({}, askedRun));
  return decodeOutput(answered).output;
}
