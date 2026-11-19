export interface SocketKeyed {
  readonly provider: string;
  readonly at: number;
  readonly digest: string;
}

export interface SocketSets {
  readonly wanted: ReadonlyMap<string, readonly string[]>;
  readonly running: ReadonlyMap<string, readonly string[]>;
  readonly refused: ReadonlySet<string>;
}

export interface SocketSteps {
  readonly open: readonly string[];
  readonly close: readonly string[];
  readonly regroup: readonly string[];
}

export function socketKeyOf({ provider, at, digest }: SocketKeyed): string {
  return JSON.stringify([provider, at, digest]);
}

function sameMembers(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((member, index) => member === other[index]);
}

export function socketStepsOf({ wanted, running, refused }: SocketSets): SocketSteps {
  const wantedKeys = [...wanted.keys()];
  return {
    open: wantedKeys.filter((key) => !running.has(key) && !refused.has(key)),
    close: [...running.keys()].filter((key) => !wanted.has(key)),
    regroup: [...wanted]
      .filter(([key, members]: readonly [string, readonly string[]]) => {
        const runningMembers = running.get(key);
        return runningMembers !== undefined && !sameMembers(runningMembers, members);
      })
      .map(([key]: readonly [string, readonly string[]]) => key),
  };
}

export function stillRefused(refused: ReadonlySet<string>, wanted: ReadonlyMap<string, unknown>): ReadonlySet<string> {
  return new Set([...refused].filter((key) => wanted.has(key)));
}
