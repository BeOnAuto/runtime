import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { defaultRuntimePort } from './local-control.ts';
import { runtimePortOf } from './runtime-port.ts';

const home = mkdtempSync(join(tmpdir(), 'auto-runtime-port-'));

const elsewhere = mkdtempSync(join(tmpdir(), 'auto-runtime-port-'));

mkdirSync(join(home, '.auto-runtime'));
writeFileSync(join(home, '.auto-runtime', '.env'), 'PORT=6060\n');

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

describe('the port of the runtime on this computer', () => {
  it('is 5555 when nothing says otherwise', () => {
    expect(runtimePortOf({}, elsewhere)).toBe(defaultRuntimePort);
  });

  it('is the one in the .env of the home of the runtime', () => {
    expect(runtimePortOf({}, home)).toBe(6060);
  });

  it('is the one the shell sets, before the .env', () => {
    expect(runtimePortOf({ PORT: '7070' }, home)).toBe(7070);
  });

  it.each(['0', '65536', 'eighty', '80.5'])('is 5555 when the port set is %s, which is no port', (port) => {
    expect(runtimePortOf({ PORT: port }, elsewhere)).toBe(defaultRuntimePort);
  });
});
