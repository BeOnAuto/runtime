import { answerOf } from '../jobs/program-answer.ts';
import { serveJobs } from '../program-pool/job-loop.ts';

serveJobs({ program: answerOf });
