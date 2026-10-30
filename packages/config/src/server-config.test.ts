import { describe, expect, it } from 'vitest';

import { InvalidPortError, readServerConfig } from './index.ts';

describe('readServerConfig', () => {
  it('listens on every interface at port 5555 when nothing is configured', () => {
    expect(readServerConfig({})).toEqual({ host: '0.0.0.0', port: 5555 });
  });

  it('uses the configured host and port', () => {
    expect(readServerConfig({ HOST: '127.0.0.1', PORT: '3000' })).toEqual({ host: '127.0.0.1', port: 3000 });
  });

  it('accepts port 0 so the operating system can choose a free port', () => {
    expect(readServerConfig({ PORT: '0' })).toEqual({ host: '0.0.0.0', port: 0 });
  });

  it.each(['', 'eighty', '80.5', '-1', '65536'])('rejects the port "%s"', (port) => {
    expect(() => readServerConfig({ PORT: port })).toThrow(new InvalidPortError(port));
  });

  it('names the error so logs identify it', () => {
    expect(new InvalidPortError('x')).toMatchObject({
      name: 'InvalidPortError',
      message: 'PORT must be an integer from 0 to 65535, received "x"',
    });
  });
});
