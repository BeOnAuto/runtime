import { recordedRunIn } from '@on.auto/definitions';
import { textOfContent, type Outcome } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';
import { expect } from 'vitest';

import { candidateSha256, uploaded, type CandidateName } from '../runtime-testing/scripted-candidates.ts';
import { uploadedDailyVisits } from '../testing/daily-documents.ts';
import { dailyRows, steadyVisits, type DailyRows } from '../testing/daily-rows.ts';
import { uploadDataset } from '../upload/upload-dataset.ts';
import type { BuildPlaybook } from './build-playbook.ts';
import { performedUntilQuiet } from './due-driving.ts';

const StartedSchema = Schema.Struct({ output: Schema.Struct({ run_id: Schema.String }) });

export const visitsRows = dailyRows('visits', ['north', 'south'], 40, steadyVisits);

export interface Saving {
  readonly name?: string;
  readonly rows?: DailyRows;
  readonly source?: string;
}

export async function savedFunction(playbook: BuildPlaybook, saving: Saving = {}): Promise<void> {
  const { name = 'daily-visits', rows = visitsRows, source = uploadedDailyVisits(rows.sha256) } = saving;
  await playbook.send(uploadDataset(playbook.test.ports.ledger.content), { sha256: rows.sha256 }, rows.text);
  expect(await playbook.call(playbook.operations.create, { type: 'prediction', name, source })).toMatchObject({
    status: 'succeeded',
  });
}

export function buildAsked(playbook: BuildPlaybook, name = 'daily-visits'): Promise<Outcome> {
  return playbook.call(playbook.operations.run, { type: 'prediction', name, input: { build: {} } });
}

export async function askedBuild(playbook: BuildPlaybook, name = 'daily-visits'): Promise<string> {
  return Schema.decodeUnknownSync(StartedSchema)(await buildAsked(playbook, name)).output.run_id;
}

export function answered(playbook: BuildPlaybook, build: string, answer: object): Promise<Outcome> {
  return playbook.call(playbook.operations.answer, { run_id: build, answer });
}

export async function builtFrom(
  playbook: BuildPlaybook,
  names: readonly CandidateName[],
  functionName = 'daily-visits',
  format?: string,
): Promise<string> {
  const build = await askedBuild(playbook, functionName);
  await uploaded(playbook, build, names, format);
  expect(await answered(playbook, build, { candidates: names.map((name) => candidateSha256(name)) })).toMatchObject({
    status: 'succeeded',
  });
  await performedUntilQuiet(playbook);
  return build;
}

export async function activeVisitsOn(playbook: BuildPlaybook): Promise<BuildPlaybook> {
  await savedFunction(playbook);
  await builtFrom(playbook, ['visits-mean']);
  return playbook;
}

export function runOf(playbook: BuildPlaybook, id: string): Promise<Outcome> {
  return playbook.call(playbook.operations.getRun, { run_id: id });
}

export function standingOf(playbook: BuildPlaybook, name = 'daily-visits'): Promise<Outcome> {
  return playbook.call(playbook.operations.get, { type: 'prediction', name });
}

export interface Asking {
  readonly name?: string;
  readonly runId?: string;
}

export function asked(
  playbook: BuildPlaybook,
  input: object,
  { name = 'daily-visits', runId }: Asking = {},
): Promise<Outcome> {
  return playbook.call(playbook.operations.run, {
    type: 'prediction',
    name,
    input,
    ...(runId === undefined ? {} : { run_id: runId }),
  });
}

export async function readOf(
  playbook: BuildPlaybook,
  operation: Parameters<BuildPlaybook['send']>[0],
  build: string,
): Promise<unknown> {
  const read = await playbook.send(operation, { run_id: build });
  return 'streamed' in read ? Effect.runPromise(textOfContent(read.streamed)) : read;
}

export interface WorkDone {
  readonly type: string;
  readonly data: Schema.JsonObject;
}

export async function workOf(playbook: BuildPlaybook, id: string): Promise<readonly WorkDone[]> {
  const run = await Effect.runPromise(
    recordedRunIn(playbook.test.ports.ledger, { org: 'acme', playbook: 'alpha', id }),
  );
  return Option.getOrThrow(Option.fromNullishOr(run)).work.map(({ type, data }) => ({ type, data }));
}

export interface ModelFactSeen {
  readonly type: string;
  readonly data: unknown;
  readonly by: string;
}

export async function modelFactsOf(playbook: BuildPlaybook, name = 'daily-visits'): Promise<readonly ModelFactSeen[]> {
  const types = [
    'version_built',
    'shadow_predicted',
    'shadow_graded',
    'shadow_passed',
    'shadow_failed',
    'version_activated',
    'activation_refused',
  ];
  const page = await Effect.runPromise(
    playbook.test.ports.ledger.readRecorded(
      { org: 'acme', playbook: 'alpha' },
      { kind: 'everything' },
      { order: 'asc', limit: 1000, types, dataOf: types },
    ),
  );
  return page.records
    .filter(({ stream }) => stream.endsWith(`models/${name}`))
    .map(({ type, data, context }) => ({ type, data, by: context.by }));
}
