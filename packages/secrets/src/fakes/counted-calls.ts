export interface CountedCalls<Call> {
  readonly note: (call: Call) => void;
  readonly calls: () => readonly Call[];
  readonly asked: (count: number) => Promise<void>;
}

export function countedCalls<Call>(): CountedCalls<Call> {
  const calls: Call[] = [];
  const waiting = new Map<number, PromiseWithResolvers<void>>();
  const awaited = (count: number) => {
    const waited = waiting.get(count) ?? Promise.withResolvers<void>();
    waiting.set(count, waited);
    return waited;
  };
  return {
    note: (call) => {
      calls.push(call);
      awaited(calls.length).resolve();
    },
    calls: () => [...calls],
    asked: (count) => (count <= calls.length ? Promise.resolve() : awaited(count).promise),
  };
}
