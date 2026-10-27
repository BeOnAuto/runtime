import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { runCommandLine } from '../command-line/command-line.ts';
import { controlledLicensedServer } from '../testing/accounts/controlled-server.ts';
import { installation } from '../testing/accounts/licensed-server.ts';
import { overTheNetwork } from './runtime-probe.ts';

describe('auto-runtime license activate, against the runtime running on this computer', () => {
  it('activates the license with the key, and says what the runtime is licensed to', async () => {
    const home = mkdtempSync(join(tmpdir(), 'auto-runtime-license-home-'));
    onTestFinished(() => {
      rmSync(home, { recursive: true, force: true });
    });
    const { port, accounts } = await controlledLicensedServer(home);
    const logged: string[] = [];
    const host = {
      environment: { PORT: String(port) },
      place: { directory: home, home },
      console: {
        log: (line: string) => {
          logged.push(line);
        },
        error: (line: string) => {
          logged.push(line);
        },
      },
      fetch: overTheNetwork,
      startServer: () => Promise.resolve(),
      relay: () => Promise.resolve(),
    };

    expect(await runCommandLine(['license', 'activate', accounts.key], host)).toBe(0);
    expect(logged[0]).toContain(
      `Auto Runtime is licensed to the org acme on the plan free, as the installation ${installation}`,
    );
    expect(accounts.account.activations()).toHaveLength(1);
  }, 60_000);
});
