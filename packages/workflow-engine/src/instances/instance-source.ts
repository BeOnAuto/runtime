import type { SandboxInstance } from '../programs/sandbox-session.ts';

export type InstanceSource = (memoryBytes: number) => Promise<SandboxInstance>;

export interface SandboxFiles {
  readonly bytes: (file: Readonly<URL>) => Promise<Readonly<Uint8Array>>;
}

export type InstanceSourceOf = (files: SandboxFiles) => InstanceSource;

export function instanceStock(source: InstanceSource): InstanceSource {
  const ready = new Map<number, Promise<SandboxInstance>>();
  return (memoryBytes) => {
    const next = ready.get(memoryBytes) ?? source(memoryBytes);
    ready.set(memoryBytes, source(memoryBytes));
    return next;
  };
}
