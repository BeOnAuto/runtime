import type { SandboxInstance } from '../programs/sandbox-session.ts';

export type Instances = (memoryBytes: number) => Promise<SandboxInstance>;

export function instanceStock(fresh: Instances): Instances {
  const ready = new Map<number, Promise<SandboxInstance>>();
  return (memoryBytes) => {
    const next = ready.get(memoryBytes) ?? fresh(memoryBytes);
    ready.set(memoryBytes, fresh(memoryBytes));
    return next;
  };
}
