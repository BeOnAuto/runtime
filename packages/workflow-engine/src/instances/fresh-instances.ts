import { Function } from 'effect';

import { instantiated } from './compiled-module.ts';
import type { InstanceSourceOf } from './instance-source.ts';

export const freshInstances: InstanceSourceOf = (sandboxModule) => async (memoryBytes) => ({
  ...(await instantiated(sandboxModule, memoryBytes)),
  release: Function.constVoid,
});
