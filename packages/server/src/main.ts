import { homedir } from 'node:os';

import { stopInsistedBy, stopRequestedBy } from './lifecycle/stop-request.ts';

const stopRequested = stopRequestedBy(process);
const stopInsisted = stopInsistedBy(process);
const { compositionRoot } = await import('./composition/composition-root.ts');
const { runServer, exitOnStartupFailure } = await import('./lifecycle/run-server.ts');
const { runtimeHomeIn } = await import('./local-runtime/local-control.ts');
const { usagePingOf } = await import('./usage-ping/usage-ping.ts');
const usagePing = usagePingOf({ fetch, runtimeHome: runtimeHomeIn(homedir()), running: process });
await runServer(process, { ...compositionRoot, usagePing }, stopRequested, stopInsisted).catch(
  exitOnStartupFailure(process),
);
