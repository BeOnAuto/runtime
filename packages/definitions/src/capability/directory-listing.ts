import type { Capability } from './capability.ts';

type Listed = Pick<Capability, 'outsideTheDirectoryListing'>;

function isInTheDirectoryListing({ outsideTheDirectoryListing }: Listed): boolean {
  return outsideTheDirectoryListing !== true;
}

export function inTheDirectoryListing<Kind extends Listed>(capabilities: readonly Kind[]): readonly Kind[] {
  return capabilities.filter((capability) => isInTheDirectoryListing(capability));
}

export interface CapabilityOperations<Operation> {
  readonly capability: Listed;
  readonly operations: readonly Operation[];
}

export function operationsOfCapabilities<Operation>(
  served: readonly CapabilityOperations<Operation>[],
): readonly Operation[] {
  return served.flatMap(({ operations }) => operations);
}

export function operationsInTheDirectoryListing<Operation>(
  served: readonly CapabilityOperations<Operation>[],
): readonly Operation[] {
  return operationsOfCapabilities(served.filter(({ capability }) => isInTheDirectoryListing(capability)));
}
