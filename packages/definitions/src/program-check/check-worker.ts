import { serveJobsWith } from '@on.auto/workflow-engine/job-loop';

import { handedChecks } from './kept-lib.ts';

serveJobsWith(handedChecks);
