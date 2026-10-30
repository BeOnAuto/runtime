import { foldAnswerOf } from '../folds/fold-answer.ts';
import { serveJobs } from '../program-pool/job-loop.ts';

serveJobs({ fold: foldAnswerOf });
