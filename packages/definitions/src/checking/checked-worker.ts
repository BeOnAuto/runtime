import { serveJobs } from '@on.auto/workflow-engine/job-loop';
import { answerOf, foldAnswerOf } from '@on.auto/workflow-engine/worker';

import { valueChecks } from './value-checks.ts';

serveJobs({ program: answerOf, fold: foldAnswerOf, checks: valueChecks });
