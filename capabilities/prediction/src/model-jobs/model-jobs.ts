import { firstLineOf, type FittedModel, type LoadedModel, type LoadModel } from '@on.auto/prediction-contract';
import type { ProcessHandlers, ProcessValue } from '@on.auto/workflow-engine/process-loop';
import { Schema } from 'effect';

import { seriesRowsIn } from '../files/series-rows.ts';
import { periodOfForm } from '../periods/grains.ts';
import { perfectBaselineIn } from './baselines-job.ts';
import {
  BaselinesJobSchema,
  CheckJobSchema,
  DefaultJobSchema,
  feedsOf,
  FitJobSchema,
  RunJobSchema,
  WalkJobSchema,
  WindowJobSchema,
  type FitJob,
} from './model-feeds.ts';
import { importedFitters, importedRuntime, type RuntimeFitters, type RuntimeLoaders } from './runtime-modules.ts';
import { walked } from './walk-job.ts';
import { seriesWindowIn } from './window-job.ts';

const decodeCheck = Schema.decodeUnknownSync(CheckJobSchema);

const decodeRun = Schema.decodeUnknownSync(RunJobSchema);

const decodeWalk = Schema.decodeUnknownSync(WalkJobSchema);

const decodeWindow = Schema.decodeUnknownSync(WindowJobSchema);

const decodeBaselines = Schema.decodeUnknownSync(BaselinesJobSchema);

const decodeFit = Schema.decodeUnknownSync(FitJobSchema);

const decodeDefault = Schema.decodeUnknownSync(DefaultJobSchema);

interface ModelOfARuntime {
  readonly model: string;
  readonly threads: number;
}

interface Sessions {
  readonly loaderOf: RuntimeLoaders;
  readonly sessionOf: (runtime: string, load: LoadModel, asked: ModelOfARuntime) => Promise<LoadedModel>;
}

export interface RuntimeImports {
  readonly loaders: RuntimeLoaders;
  readonly fitters: RuntimeFitters;
}

class AnsweredNotFinite extends Error {
  override toString(): string {
    return this.message;
  }
}

function sessionsOf(loaderOf: RuntimeLoaders): Sessions {
  const loaded = new Map<string, Promise<LoadedModel>>();
  return {
    loaderOf,
    sessionOf: (runtime, load, { model, threads }) => {
      const key = JSON.stringify([runtime, model]);
      const known = loaded.get(key);
      if (known !== undefined) {
        return known;
      }
      const loading = load(model, threads);
      loaded.set(key, loading);
      loading.catch(() => loaded.delete(key));
      return loading;
    },
  };
}

async function loadedFor(
  sessions: Sessions,
  asked: ModelOfARuntime & { readonly runtime: string },
): Promise<LoadedModel> {
  return sessions.sessionOf(asked.runtime, await sessions.loaderOf(asked.runtime), asked);
}

async function checked(sessions: Sessions, payload: ProcessValue): Promise<ProcessValue> {
  const job = decodeCheck(payload);
  const load = await sessions.loaderOf(job.runtime);
  try {
    const { signature, issueFor } = await sessions.sessionOf(job.runtime, load, job);
    return { loaded: true, signature, issue: issueFor(job.fed) };
  } catch (error) {
    return { loaded: false, detail: firstLineOf(error) };
  }
}

async function answered(sessions: Sessions, payload: ProcessValue): Promise<ProcessValue> {
  const job = decodeRun(payload);
  const model = await loadedFor(sessions, job);
  const answer = await model.run(feedsOf(job, model.length));
  if ('badly' in answer) {
    return { badly: answer.badly };
  }
  if (!answer.q.every((value) => Number.isFinite(value))) {
    throw new AnsweredNotFinite('The model answered a number that is not finite');
  }
  return { q: answer.q, dims: answer.dims };
}

function sentModel({ format, bytes }: FittedModel): ProcessValue {
  return { format, bytes: Uint8Array.from(bytes) };
}

async function fitted(fitters: RuntimeFitters, job: FitJob): Promise<ProcessValue> {
  const { fitModels } = await fitters(job.runtime);
  const rows = await seriesRowsIn(job.rows, { features: 0 });
  const [firstRow] = rows;
  const training = {
    first: firstRow === undefined ? 0 : Number(periodOfForm(job.shape.grain, String(firstRow.periods[0]))),
    series: rows.map(({ values }) => values),
  };
  const models = await fitModels(job.shape, training);
  return { models: models.map((model) => sentModel(model)) };
}

export function modelJobs({
  loaders = importedRuntime,
  fitters = importedFitters,
}: Partial<RuntimeImports> = {}): ProcessHandlers {
  const sessions = sessionsOf(loaders);
  return {
    check: (payload) => checked(sessions, payload),
    run: (payload) => answered(sessions, payload),
    window: (payload) => seriesWindowIn(decodeWindow(payload)),
    baselines: async (payload) => ({ ...(await perfectBaselineIn(decodeBaselines(payload))) }),
    walk: async (payload, signal) => {
      const walk = decodeWalk(payload);
      const model = await loadedFor(sessions, walk);
      return walked({ model, walk, signal }, await seriesRowsIn(walk.rows, { features: walk.features }));
    },
    fit: (payload) => fitted(fitters, decodeFit(payload)),
    default: async (payload) => {
      const job = decodeDefault(payload);
      const { defaultModel } = await fitters(job.runtime);
      return sentModel(defaultModel(job.shape));
    },
  };
}
