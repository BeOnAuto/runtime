import { keptArmOf, keptIn } from '@on.auto/definitions/testing';
import { Unavailable } from '@on.auto/operations';
import { PayloadMissing, payloadReaderOf } from '@on.auto/operations/payloads';
import { Effect, Function } from 'effect';
import { onTestFinished } from 'vitest';

import { someFolder } from '../projector/folder.ts';
import { projectorWakeUp } from '../projector/projector.ts';
import { recordingReports } from '../testing/recording-reports.ts';
import { projectedFolders, type ProjectedFolders } from './projected-folders.ts';
import { talliesOf, tallyFolderOf, tallyType, type TallyDetails } from './tally-folder.ts';

export type FoldingSettingsOf = () => Promise<Parameters<typeof projectedFolders>[0]>;

const alpha = 'playbook/acme/alpha/';

const owner = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const savedAt = '2026-10-06T09:00:00.000Z';

const output = { report: 'r'.repeat(40_000) };

const folders = [someFolder(tallyFolderOf(1))];

export const successes: TallyDetails = { counts: 'run_succeeded' };

interface Defined {
  readonly name: string;
  readonly details: TallyDetails;
  readonly version: number;
}

async function tallyDefined(store: ProjectedFolders, { name, details, version }: Defined): Promise<void> {
  await store.append(
    `${alpha}definitions/${tallyType}`,
    [
      {
        type: 'definition_created',
        data: { content: { source: name, details }, created_by: { id: 'acme-admin', name: 'acme-admin' } },
      },
    ],
    { by: 'acme-admin', at: savedAt, definitionType: tallyType, definitionName: name, definitionVersion: version },
  );
}

async function talliedSuccess(store: ProjectedFolders, keeps: boolean, details: TallyDetails): Promise<void> {
  const { sha256, bytes } = keeps
    ? await Effect.runPromise(keptIn(store.database.content, owner, output))
    : keptArmOf(output);
  await tallyDefined(store, { name: 'runs', details, version: 1 });
  await store.append(
    `${alpha}runs/${runId}`,
    [
      { type: 'run_started', data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} } },
      { type: 'run_succeeded', data: { output_sha256: sha256, output_bytes: bytes, record: {} } },
    ],
    { by: 'acme-admin', at: savedAt, definitionType: 'reasoning', definitionName: 'runs', definitionVersion: 1, runId },
  );
}

type Reports = ReturnType<typeof recordingReports>;

interface ContentAnswers {
  readonly down: boolean;
  readonly lost: boolean;
}

function lostAnswerOf(sha256: string): PayloadMissing {
  return new PayloadMissing({ ...owner, sha256, because: 'not_held', message: 'The test lost this output' });
}

function viewsOver(store: ProjectedFolders, reports: Reports, answers: Readonly<ContentAnswers>) {
  const reader = payloadReaderOf({ owner, content: store.database.content });
  const projector = projectorWakeUp(
    {
      database: store.database,
      factPayloadsOf: () => ({
        ...reader,
        json: (digested) => {
          if (answers.down) {
            return Effect.fail(new Unavailable({ detail: 'The content store did not answer' }));
          }
          return answers.lost ? Effect.fail(lostAnswerOf(digested.sha256)) : reader.json(digested);
        },
      }),
      settings: { folders, playbooksAtOnce: 4, pagesPerWake: 10 },
      reports: reports.reports,
    },
    { raised: Function.constVoid, renewed: Function.constVoid },
  );
  onTestFinished(() => Effect.runPromise(projector.stop()));
  return () => Effect.runPromise(projector.wakeUp({ now: Date.now(), sweep: true }));
}

export async function keptAndTallied(settingsOf: FoldingSettingsOf, keeps: boolean, details: TallyDetails) {
  const store = await projectedFolders(await settingsOf(), folders);
  onTestFinished(store.close);
  await talliedSuccess(store, keeps, details);
  const answers = { down: true, lost: false };
  const reports = recordingReports();
  return {
    wakeUp: viewsOver(store, reports, answers),
    restarted: () => viewsOver(store, reports, answers),
    defined: (name: string, more: TallyDetails, version = 1) => tallyDefined(store, { name, details: more, version }),
    tallied: async () => (await Effect.runPromise(talliesOf(store.database, alpha))).map(({ counted }) => counted),
    up: () => {
      answers.down = false;
    },
    lost: () => {
      answers.lost = true;
    },
    troubles: reports.troubles,
    missing: () => reports.notes().filter(({ kind }) => kind === 'record_content_missing'),
  };
}
