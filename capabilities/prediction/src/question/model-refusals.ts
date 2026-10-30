import { Unavailable } from '@on.auto/operations';

export const busy = new Unavailable({
  detail: 'Every model process is busy; try again shortly',
  kind: 'model_process_busy',
});

export const ended = new Unavailable({
  detail: 'The model process ended before it answered',
  kind: 'model_process_failed',
});

export function crashedAs(detail: string): Unavailable {
  return new Unavailable({ detail, kind: 'model_process_failed' });
}

export function noRuntimeAs(detail: string): Unavailable {
  return new Unavailable({ detail, kind: 'model_process_failed', because: 'no_model_runtime' });
}

export const notFinite = new Unavailable({
  detail: 'The model answered something other than finite numbers in the shape its signature gives',
  kind: 'model_process_failed',
  because: 'not_finite',
});
