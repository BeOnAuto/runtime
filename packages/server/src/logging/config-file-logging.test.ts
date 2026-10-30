import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logConfigFile } from './logging.ts';

describe('logConfigFile', () => {
  it('says nothing without a configuration file', async () => {
    await expect(linesLoggedBy(logConfigFile())).resolves.toEqual([]);
  });

  it('says none when the environment sets everything the file sets, naming only settings', async () => {
    const lines = await linesLoggedBy(
      logConfigFile({ path: '/etc/auto-runtime.yaml', fromFile: [], overridden: ['MODEL_GATEWAYS'] }),
    );

    expect(lines.map((line) => /"message":"((?:[^"\\]|\\.)*)"/u.exec(line)?.[1])).toEqual([
      'Settings read from the configuration file /etc/auto-runtime.yaml: none',
      "Set both in the environment and in the configuration file, so the environment's value is used: MODEL_GATEWAYS",
    ]);
    expect(lines[1]).toContain('"annotations":{"config_file":"/etc/auto-runtime.yaml","settings":["MODEL_GATEWAYS"]}');
  });
});
