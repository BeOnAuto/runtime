export interface RecordedKeys {
  readonly org: string;
  readonly keys: readonly [string, ...string[]];
}

const theOrgOfAKey = /^[^/]*\/([^/]*)\//u;

export function keysOfOne(key: string): RecordedKeys {
  return { org: theOrgOfAKey.exec(key)?.[1] ?? '', keys: [key] };
}

function streamsOfTheRunUnder(key: string, run: string): readonly [string, string] {
  return [`${key}runs/${run}`, `${key}run-logs/${run}`];
}

export function streamsOfTheRun([only, ...more]: RecordedKeys['keys'], run: string): RecordedKeys['keys'] {
  return [...streamsOfTheRunUnder(only, run), ...more.flatMap((key) => streamsOfTheRunUnder(key, run))];
}
