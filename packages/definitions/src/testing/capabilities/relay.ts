import { Effect, Predicate } from 'effect';

import { defineCapability, type FinishesLater, type Capability } from '../../index.ts';

export interface Relay {
  readonly capability: Capability;
  readonly runs: () => number;
  readonly started: Promise<void>;
  readonly free: () => void;
}

export function relay(): Relay {
  let runs = 0;
  const starting = Promise.withResolvers<void>();
  const freed = Promise.withResolvers<void>();
  const capability = defineCapability({
    type: 'relay',
    title: 'Relay',
    guide: { name: 'relay' },
    noun: { one: 'relay', other: 'relays' },
    describeOutput: () => 'It handed its input on.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    run: (_document, input, run) =>
      Effect.promise(() => {
        starting.resolve();
        return isHeld(input) ? freed.promise : Promise.resolve();
      }).pipe(
        Effect.map((): FinishesLater => {
          runs += 1;
          const padding = Predicate.isNumber(input) ? { padding: 'x'.repeat(input) } : {};
          return { finishesLater: true, record: { handed_on: run.id, ...padding } };
        }),
      ),
    whenCancelled: 'finish',
  });
  return { capability, runs: () => runs, started: starting.promise, free: freed.resolve };
}

function isHeld(input: unknown): boolean {
  return Predicate.hasProperty(input, 'held') && input.held === true;
}
