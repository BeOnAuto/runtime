import type { DecidingOptions, MachineOptions } from '../runner/run-descriptors.ts';

export function deciding<Decided>(options: MachineOptions, decide: (withUnit: DecidingOptions) => Decided): Decided {
  const unit = options.sandbox.unit();
  try {
    return decide({ ...options, unit });
  } finally {
    unit.close();
  }
}
