import type { DatasetRow } from '../dataset/dataset-rows.ts';

export type Holds = (row: DatasetRow) => boolean;

export function liveFolded(events: number): Holds {
  return ({ phase, eventsFolded }) => phase === 'live' && eventsFolded === events;
}

export function folded(events: number): Holds {
  return ({ eventsFolded }) => eventsFolded === events;
}

export function handled(events: number): Holds {
  return ({ eventsFolded, passedOver }) => eventsFolded + passedOver === events;
}

export const isLive: Holds = ({ phase }) => phase === 'live';

export const anyRow: Holds = () => true;
