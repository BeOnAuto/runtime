export type Environment = Readonly<Record<string, string | undefined>>;

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
}

const defaultHost = '0.0.0.0';
const defaultPort = 5555;
const highestPort = 65_535;
const digitsOnly = /^\d+$/u;

export class InvalidPortError extends Error {
  constructor(received: string) {
    super(`PORT must be an integer from 0 to ${highestPort}, received "${received}"`);
    this.name = 'InvalidPortError';
  }
}

export const serverConfigVariables: readonly string[] = ['HOST', 'PORT'];

export function readServerConfig(environment: Environment): ServerConfig {
  return {
    host: environment['HOST'] ?? defaultHost,
    port: parsePort(environment['PORT']),
  };
}

function parsePort(received: string | undefined): number {
  if (received === undefined) {
    return defaultPort;
  }
  const port = Number(received);
  if (!digitsOnly.test(received) || port > highestPort) {
    throw new InvalidPortError(received);
  }
  return port;
}
