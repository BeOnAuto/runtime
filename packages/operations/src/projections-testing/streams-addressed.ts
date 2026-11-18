import { addressedStreamOf, type AddressedStream } from '../projections/keyed-projection.ts';

export function streamAddressed(stream: string): AddressedStream {
  const addressed = addressedStreamOf(stream);
  if (addressed === undefined) {
    throw new Error(`The stream ${stream} lies under no key a projection folds`);
  }
  return addressed;
}
