import { runOf, type Metered } from './metered.ts';

type Step =
  | { readonly kind: 'started'; readonly run: string; readonly playbook: string }
  | { readonly kind: 'admitted'; readonly run: string; readonly playbook: string }
  | { readonly kind: 'noted'; readonly stream: string; readonly count: number };

export type Random = () => number;

const MODULUS = 2_147_483_647;

export function seeded(seed: number): Random {
  const state = { value: seed };
  const next = () => {
    state.value = (state.value * 48_271) % MODULUS;
    return (state.value - 1) / (MODULUS - 1);
  };
  Array.from({ length: 12 }, next);
  return next;
}

export function pickOf(random: Random): <Item>(first: Item, ...rest: readonly Item[]) => Item {
  return (first, ...rest) => {
    const chosen = Math.floor(random() * (rest.length + 1));
    return rest.reduce((kept, item, place) => (place + 1 === chosen ? item : kept), first);
  };
}

export function randomSteps(random: Random, count: number): readonly Step[] {
  const pick = pickOf(random);
  const runs = Array.from({ length: Math.ceil(count / 3) }, (_, index) => `run-${index}`);
  return Array.from({ length: count }, (): Step => {
    const kind = pick<Step['kind']>('started', 'admitted', 'noted');
    const run = pick('run-x', ...runs);
    const playbook = pick('alpha', 'beta');
    return kind === 'noted'
      ? {
          kind,
          stream: pick('org/acme/notes', 'org/globex/notes', 'playbook/acme/alpha/runs/run-0'),
          count: pick(1, 2, 5),
        }
      : { kind, run, playbook };
  });
}

export async function played(metered: Metered, step: Step): Promise<void> {
  if (step.kind === 'noted') {
    await metered.noted(step.stream, step.count);
  } else {
    if (step.kind === 'admitted') await metered.admitted(runOf(step.run, step.playbook));
    await metered.started(step.run, step.playbook);
  }
}

export function distinctRunsIn(steps: readonly Step[]): number {
  return new Set(steps.flatMap((step) => (step.kind === 'noted' ? [] : [`${step.playbook}/${step.run}`]))).size;
}
