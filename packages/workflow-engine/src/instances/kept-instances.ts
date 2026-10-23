import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { instantiated, type Instantiated } from './compiled-module.ts';
import type { InstanceSourceOf } from './instance-source.ts';

export const keptInstances: InstanceSourceOf = (files) => {
  const kept = new Map<number, Instantiated>();
  const lent = (instance: Instantiated): SandboxInstance => {
    const lending = { open: true };
    return {
      ...instance,
      release: (intact) => {
        const keeps = lending.open && intact && !instance.refusedGrowth() && !kept.has(instance.memoryBytes);
        lending.open = false;
        if (keeps) {
          kept.set(instance.memoryBytes, instance);
        }
      },
    };
  };
  return async (memoryBytes) => {
    const waiting = kept.get(memoryBytes);
    kept.delete(memoryBytes);
    return lent(waiting ?? (await instantiated(files, memoryBytes)));
  };
};
