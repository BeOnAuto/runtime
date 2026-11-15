import { homedir } from 'node:os';

import { stopInsistedBy, stopRequestedBy } from '../../packages/server/src/lifecycle/stop-request.ts';

const stopRequested = stopRequestedBy(process);
const stopInsisted = stopInsistedBy(process);
const { compositionRootWith } = await import('../../packages/server/src/composition/composition-root.ts');
const { loggedModelAccess } = await import('../../packages/server/src/composition/served-reasoning.ts');
const { runServer, exitOnStartupFailure } = await import('../../packages/server/src/lifecycle/run-server.ts');
const { runtimeHomeIn } = await import('../../packages/server/src/local-runtime/local-control.ts');
const { usagePingOf } = await import('../../packages/server/src/usage-ping/usage-ping.ts');
const { systemClock } = await import('../../packages/workflow-host/src/loop/host-clock.ts');

const workflowClockAheadOfTheLedgerMs = 55_000;
const clock = { ...systemClock, now: () => Date.now() + workflowClockAheadOfTheLedgerMs };
const composition = compositionRootWith(loggedModelAccess, { goals: true, goalsResults: true, clock });
const usagePing = usagePingOf({ fetch, runtimeHome: runtimeHomeIn(homedir()), running: process });
await runServer(process, { ...composition, usagePing }, stopRequested, stopInsisted).catch(
  exitOnStartupFailure(process),
);
