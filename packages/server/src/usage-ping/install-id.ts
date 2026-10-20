import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Install } from '../lifecycle/lifecycle.ts';
import { besideTheLedgerFile, type LedgerSettings } from '../settings/ledger-settings.ts';

const installIdFile = 'install-id';

const keptId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function installIdFileOf(ledger: LedgerSettings, runtimeHome: string): string {
  return besideTheLedgerFile(ledger, installIdFile) ?? join(runtimeHome, installIdFile);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function made(file: string): Install | undefined {
  const id = randomUUID();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${id}\n`, { flag: 'wx' });
    return { id, isNew: true };
  } catch {
    return undefined;
  }
}

export function installIn(file: string): Install | undefined {
  try {
    const id = readFileSync(file, 'utf8').trim();
    return keptId.test(id) ? { id, isNew: false } : undefined;
  } catch (error) {
    return isMissing(error) ? made(file) : undefined;
  }
}
