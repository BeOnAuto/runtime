import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { runCommandLine, type CommandLineHost } from '../command-line/command-line.ts';
import { controlledLicensedServer } from '../testing/accounts/controlled-server.ts';
import { installation } from '../testing/accounts/licensed-server.ts';
import { overTheNetwork } from './runtime-probe.ts';

function aHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'auto-runtime-license-home-'));
  onTestFinished(() => {
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

function hostOn(port: number, home: string, say: (line: string) => void): CommandLineHost {
  return {
    environment: { PORT: String(port) },
    place: { directory: home, home },
    console: { log: say, error: say },
    fetch: overTheNetwork,
    startServer: () => Promise.resolve(),
    relay: () => Promise.resolve(),
  };
}

describe('auto-runtime license, against the runtime running on this computer', () => {
  it('activates the license with the key, and says the name of the org the runtime is licensed to', async () => {
    const home = aHome();
    const { port, accounts } = await controlledLicensedServer(home);
    accounts.account.orgNamed('acme', 'Acme Corporation');
    const said: string[] = [];

    expect(
      await runCommandLine(
        ['license', 'activate', accounts.key],
        hostOn(port, home, (line) => {
          said.push(line);
        }),
      ),
    ).toBe(0);
    expect(said[0]).toBe(
      `Licensed to Acme Corporation on the free plan, with 1000 runs left. Runtime id ${installation}.`,
    );
    expect(accounts.account.activations().at(-1)).toEqual({ installation, actions: 0, licensed: 0 });
  }, 60_000);

  it('gives the runtime an allocation, and prints its next report, signed, for an owner to upload', async () => {
    const home = aHome();
    const { port, accounts } = await controlledLicensedServer(home);
    const said: string[] = [];
    const host = hostOn(port, home, (line) => {
      said.push(line);
    });
    const allocation = JSON.stringify(accounts.account.allocationFor(installation, 3));

    expect(await runCommandLine(['license', 'allocation', allocation], host)).toBe(0);
    expect(await runCommandLine(['license', 'report'], host)).toBe(1);
    expect(await runCommandLine(['license', 'activate', accounts.key], host)).toBe(0);
    expect(await runCommandLine(['license', 'report'], host)).toBe(0);
    expect(said[0]).toBe('This runtime uses offline credits: 0 of 3 used, usable until 2026-11-26.');
    expect(said[1]).toContain('Auto Runtime made no report: This runtime holds no license key to sign its report with');
    expect(said.at(-1)).toMatch(
      /^\{"report":\{"allocation":"[0-9a-f-]+","installation":"[0-9a-f-]+","sequence":1,"spent":0,/u,
    );
  }, 60_000);
});
