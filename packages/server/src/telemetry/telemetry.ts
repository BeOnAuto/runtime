import type { ApiEnv } from '@on.auto/api';
import type { AppendObserver } from '@on.auto/ledger';
import type { ModelTelemetry } from '@on.auto/reasoning';
import type { ToolAccessOptions } from '@on.auto/tool-servers';
import { Layer } from 'effect';
import type { MiddlewareHandler } from 'hono';

export interface OutboundTelemetry {
  readonly models: ModelTelemetry | undefined;
  readonly traceMeta: ToolAccessOptions['traceMeta'];
}

export interface Telemetry extends OutboundTelemetry {
  readonly layer: Layer.Layer<never>;
  readonly requests: MiddlewareHandler<ApiEnv> | undefined;
  readonly appended: AppendObserver | undefined;
  readonly shutdown: () => Promise<void>;
}

export const noTelemetry: Telemetry = {
  layer: Layer.empty,
  requests: undefined,
  appended: undefined,
  models: undefined,
  traceMeta: undefined,
  shutdown: () => Promise.resolve(),
};
