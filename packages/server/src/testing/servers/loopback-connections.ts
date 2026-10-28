export function connectionsAllowing(
  hosts: readonly string[],
  setting: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, string>> {
  return { CONNECTIONS: JSON.stringify({ ...setting, allowed_hosts: hosts }) };
}

export const connectionsOnLoopback = connectionsAllowing(['127.0.0.1']);
