import type { RenderClock } from '@on.auto/definitions/template';

export interface CallRendering {
  readonly clock: RenderClock;
  readonly mostBytes: number;
}
