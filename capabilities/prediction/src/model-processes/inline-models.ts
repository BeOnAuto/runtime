import { inlinePool, type InlinePool, type ProcessPool } from '@on.auto/workflow-engine/dsl';

import { modelJobs } from '../model-jobs/model-jobs.ts';

export function inlineModels({ processes, longJobs }: Pick<ProcessPool, 'processes' | 'longJobs'>): InlinePool {
  return inlinePool({ jobs: processes, longJobs, handlers: modelJobs() });
}
