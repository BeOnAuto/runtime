import { serveProcessJobs } from '@on.auto/workflow-engine/process-loop';

import { documentJobs } from './document-jobs.ts';

serveProcessJobs(documentJobs(), process);
