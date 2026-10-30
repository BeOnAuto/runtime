import type { Layer } from 'effect';

export interface SignalTelemetry {
  readonly layer: Layer.Layer<never>;
  readonly flushed: () => Promise<void>;
  readonly released: () => void;
}
