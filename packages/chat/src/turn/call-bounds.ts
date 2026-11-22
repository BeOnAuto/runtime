export const MOST_TOOL_CALL_MS = 30_000;

export const MOST_OUTPUT_TOKENS = 16_000;

const FIRST_ANSWER_MS = 60_000;

const MS_AN_OUTPUT_TOKEN = 25;

export const modelCallMsFor = (outputTokens: number): number => FIRST_ANSWER_MS + MS_AN_OUTPUT_TOKEN * outputTokens;

export const MOST_MODEL_CALL_MS = modelCallMsFor(MOST_OUTPUT_TOKENS);

export interface Wait {
  readonly elapsed: Promise<void>;
  readonly stop: () => void;
}

export type Waits = (ms: number) => Wait;

export interface Racing {
  readonly waits: Waits;
  readonly signal: Readonly<AbortSignal>;
}

export type Raced<A> = { readonly settled: A } | { readonly stopped: 'timed_out' | 'closed' };

export async function racedWith<A>(work: Promise<A>, ms: number, { waits, signal }: Racing): Promise<Raced<A>> {
  const wait = waits(ms);
  const listening: { onClose: (() => void) | undefined } = { onClose: undefined };
  const closed = new Promise<Raced<A>>((resolve) => {
    if (signal.aborted) {
      resolve({ stopped: 'closed' });
      return;
    }
    listening.onClose = () => {
      resolve({ stopped: 'closed' });
    };
    signal.addEventListener('abort', listening.onClose, { once: true });
  });
  try {
    return await Promise.race([
      work.then((settled): Raced<A> => ({ settled })),
      wait.elapsed.then((): Raced<A> => ({ stopped: 'timed_out' })),
      closed,
    ]);
  } finally {
    wait.stop();
    if (listening.onClose !== undefined) {
      signal.removeEventListener('abort', listening.onClose);
    }
  }
}
