import type { Principal } from '@on.auto/identity';

import type { TraceParent } from './tracing/trace-parent.ts';

export interface ApiEnv {
  readonly Variables: {
    readonly requestId: string;
    readonly principal: Principal;
    readonly traceParent: TraceParent | undefined;
  };
}
