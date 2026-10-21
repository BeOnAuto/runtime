export interface StartedRuntime {
  readonly instance: string;
  readonly pid: number | undefined;
  readonly startedAt: number;
  readonly endedAt: () => number | undefined;
  readonly signal: (name: NodeJS.Signals) => boolean;
  readonly ended: Promise<void>;
}

const endedSoonAfterTheirStartMs = 60_000;

const endingsBeforeAPause = 3;

const pauseAfterTheEndingsMs = 600_000;

export function pausedWords(logFile: string): string {
  return `Auto Runtime stopped soon after each of the last ${endingsBeforeAPause} times this connection started it, within ${pauseAfterTheEndingsMs / 60_000} minutes, so it starts it no more until those minutes have passed. Ask the person to read ${logFile}, which says why, and to fix what it says.`;
}

export class StartedRuntimes {
  readonly #started: StartedRuntime[] = [];
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  remember(runtime: StartedRuntime): void {
    this.#started.push(runtime);
  }

  living(instance?: string): StartedRuntime | undefined {
    return this.#started.find((runtime) => runtime.instance === instance && runtime.endedAt() === undefined);
  }

  ended(instance: string): boolean {
    return this.#started.some((runtime) => runtime.instance === instance && runtime.endedAt() !== undefined);
  }

  pausing(): boolean {
    const now = this.#now();
    const endedSoon = this.#started.filter((runtime) => {
      const endedAt = runtime.endedAt() ?? Number.POSITIVE_INFINITY;
      return endedAt - runtime.startedAt <= endedSoonAfterTheirStartMs && now - endedAt <= pauseAfterTheEndingsMs;
    });
    return endedSoon.length >= endingsBeforeAPause;
  }
}
