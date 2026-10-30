import { Schema } from 'effect';

import { freshInstances } from './fresh-instances.ts';
import type { InstanceSourceOf } from './instance-source.ts';
import { keptInstances } from './kept-instances.ts';

export const InstanceSourceNameSchema = Schema.Literals(['fresh', 'kept']);

export type InstanceSourceName = typeof InstanceSourceNameSchema.Type;

export const instanceSources: Readonly<Record<InstanceSourceName, InstanceSourceOf>> = {
  fresh: freshInstances,
  kept: keptInstances,
};
