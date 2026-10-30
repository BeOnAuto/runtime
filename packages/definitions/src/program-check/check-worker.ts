import { serveJobsWith } from '@on.auto/workflow-engine/job-loop';

import { handedChecks } from './handed-checks.ts';

serveJobsWith(handedChecks);
