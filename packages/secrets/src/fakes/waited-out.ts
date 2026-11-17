import { vi } from 'vitest';

const tickMs = 25;

function aTurnOfTheLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function advancedUntil(settled: () => boolean): Promise<void> {
  if (settled()) {
    return;
  }
  await aTurnOfTheLoop();
  await vi.advanceTimersByTimeAsync(tickMs);
  await advancedUntil(settled);
}

export async function waitedOut<A>(asked: () => Promise<A>): Promise<A> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    let settled = false;
    const answer = asked().finally(() => {
      settled = true;
    });
    await advancedUntil(() => settled);
    return await answer;
  } finally {
    vi.useRealTimers();
  }
}
