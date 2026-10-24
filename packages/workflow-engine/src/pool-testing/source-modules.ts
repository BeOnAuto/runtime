import type { ModuleAddress } from '../jobs/pool-contract.ts';

export function moduleOfSource(source: string): ModuleAddress {
  const module = new URL(`data:text/javascript,${encodeURIComponent(source)}`);
  return () => module;
}
