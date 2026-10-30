import { serveProcessJobs } from '@on.auto/workflow-engine/process-loop';

import { modelJobs } from './model-jobs.ts';

serveProcessJobs(modelJobs(), process);
