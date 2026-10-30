import { until } from '../waiting/until.ts';

export async function isAcceptingConnections(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`);
    return true;
  } catch {
    return false;
  }
}

export async function untilRefusingConnections(port: number): Promise<void> {
  await until(
    () => isAcceptingConnections(port),
    (accepting) => !accepting,
  );
}
