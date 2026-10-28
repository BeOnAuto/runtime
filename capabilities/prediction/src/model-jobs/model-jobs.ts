import { firstLineOf, type LoadedModel, type LoadModel } from '@on.auto/prediction-contract';
import type { ProcessHandlers, ProcessValue } from '@on.auto/workflow-engine/process-loop';
import { Schema } from 'effect';

import { seriesRowsIn } from '../files/series-rows.ts';
import { perfectBaselineIn } from './baselines-job.ts';
import {
  BaselinesJobSchema,
  CheckJobSchema,
  feedsOf,
  RunJobSchema,
  WalkJobSchema,
  WindowJobSchema,
} from './model-feeds.ts';
import { importedRuntime, type RuntimeLoaders } from './runtime-modules.ts';
import { walked } from './walk-job.ts';
import { seriesWindowIn } from './window-job.ts';

const decodeCheck = Schema.decodeUnknownSync(CheckJobSchema);

const decodeRun = Schema.decodeUnknownSync(RunJobSchema);

const decodeWalk = Schema.decodeUnknownSync(WalkJobSchema);

const decodeWindow = Schema.decodeUnknownSync(WindowJobSchema);

const decodeBaselines = Schema.decodeUnknownSync(BaselinesJobSchema);

interface ModelOfARuntime {
  readonly model: string;
  readonly threads: number;
}

interface Sessions {
  readonly loaderOf: RuntimeLoaders;
  readonly sessionOf: (runtime: string, load: LoadModel, asked: ModelOfARuntime) => Promise<LoadedModel>;
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

export function modelJobs(loaders: RuntimeLoaders = importedRuntime): ProcessHandlers {
  const sessions = sessionsOf(loaders);
  return {
    check: (payload) => checked(sessions, payload),
    run: (payload) => answered(sessions, payload),
    window: (payload) => seriesWindowIn(decodeWindow(payload)),
    baselines: async (payload) => ({ ...(await perfectBaselineIn(decodeBaselines(payload))) }),
    walk: async (payload) => {
      const job = decodeWalk(payload);
      return walked(await loadedFor(sessions, job), job, await seriesRowsIn(job.rows, { features: job.features }));
    },
  };
}
