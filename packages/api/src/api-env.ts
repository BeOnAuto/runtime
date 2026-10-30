import type { Principal } from '@on.auto/identity';

import type { TraceParent } from './tracing/trace-parent.ts';

export interface ApiBindings {
  readonly abortConnection: () => void;
}

export interface ApiEnv {
  readonly Bindings: ApiBindings;
  readonly Variables: {
    readonly requestId: string;
    readonly principal: Principal;
    readonly traceParent: TraceParent | undefined;
  };
}
