import type { SandboxInstance } from '../programs/sandbox-session.ts';

export type InstanceSource = (memoryBytes: number) => Promise<SandboxInstance>;

export type SandboxModule = { readonly bytes: Readonly<Uint8Array> } | { readonly compiled: WebAssembly.Module };

export type InstanceSourceOf = (module: SandboxModule) => InstanceSource;

export function instanceStock(source: InstanceSource): InstanceSource {
  const ready = new Map<number, Promise<SandboxInstance>>();
  return (memoryBytes) => {
    const next = ready.get(memoryBytes) ?? source(memoryBytes);
    ready.set(memoryBytes, source(memoryBytes));
    return next;
  };
}
