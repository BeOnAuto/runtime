import { Function } from 'effect';

import { instantiated } from './compiled-module.ts';
import type { InstanceSourceOf } from './instance-source.ts';

export const freshInstances: InstanceSourceOf = (files) => async (memoryBytes) => ({
  ...(await instantiated(files, memoryBytes)),
  release: Function.constVoid,
});
