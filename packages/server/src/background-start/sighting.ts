import type { StartedBy } from '@on.auto/api';

import type { Probe } from '../local-runtime/runtime-probe.ts';

export interface Sighted {
  readonly instance: string | undefined;
  readonly pid: number;
  readonly startedBy: StartedBy;
}

export class Sighting {
  readonly #endedHere: (instance: string) => boolean;
  #last: Sighted | undefined;

  constructor(endedHere: (instance: string) => boolean) {
    this.#endedHere = endedHere;
  }

  saw(probe: Probe): void {
    this.#last =
      probe.state === 'running'
        ? { instance: probe.status.instance, pid: probe.status.pid, startedBy: probe.status.started_by }
        : undefined;
  }

  last(): Sighted | undefined {
    const instance = this.#last?.instance;
    if (instance !== undefined && this.#endedHere(instance)) {
      this.#last = undefined;
    }
    return this.#last;
  }
}
