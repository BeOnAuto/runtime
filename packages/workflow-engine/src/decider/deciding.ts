import type { RunAtHand } from '../machine/held-contents.ts';
import type { DecidingOptions, MachineOptions } from '../runner/run-descriptors.ts';

export function deciding<Decided>(
  options: MachineOptions,
  atHand: RunAtHand,
  decide: (withUnit: DecidingOptions) => Decided,
): Decided {
  const unit = options.sandbox.unit();
  try {
    return decide({ ...options, unit, atHand });
  } finally {
    unit.close();
  }
}
