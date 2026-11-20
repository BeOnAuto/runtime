export const connectionSourcePrefix = '/connections/';

export function isConnectionSource(source: string): boolean {
  return source.startsWith(connectionSourcePrefix);
}

export function connectionNamedBy(source: string): string | undefined {
  return isConnectionSource(source) ? source.slice(connectionSourcePrefix.length) : undefined;
}
