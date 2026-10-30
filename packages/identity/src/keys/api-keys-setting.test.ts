import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { InvalidApiKeysError, createApiKey, readApiKeys, type ApiKey } from '../index.ts';

const { entry } = createApiKey({
  id: 'ci-1',
  org: 'acme_Corp-1',
  permissions: ['playbook:read'],
  playbooks: ['alpha'],
});

const everything: ApiKey = { ...entry, id: 'ci-2', org: 'acme', permissions: [], playbooks: '*' };

function errorFrom(value: string): unknown {
  try {
    readApiKeys({ API_KEYS: value });
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('readApiKeys', () => {
  it.each([undefined, '', ' ', '\n\t '])('is not configured when API_KEYS is %j', (value) => {
    expect(readApiKeys({ API_KEYS: value })).toBeUndefined();
  });

  it('decodes a compact JSON array of keys', () => {
    expect(readApiKeys({ API_KEYS: JSON.stringify([entry, everything]) })).toEqual([entry, everything]);
  });

  it('is configured with no keys at all when API_KEYS is an empty array', () => {
    expect(readApiKeys({ API_KEYS: '[]' })).toEqual([]);
  });

  it.each([
    ['text that is not JSON', '[{id:a}]', 'API_KEYS: Expected a valid JSON string'],
    ['a value that is not an array', '{}', 'API_KEYS: Expected array'],
    ['a key with an unknown field', JSON.stringify([{ ...entry, note: 'x' }]), 'API_KEYS[0].note'],
    ['a duplicate id', JSON.stringify([entry, entry]), 'API_KEYS: Key ids must be unique'],
    ['a malformed digest', JSON.stringify([{ ...entry, sha256: 'abc' }]), 'API_KEYS[0].sha256'],
    ['an id that breaks the grammar', JSON.stringify([{ ...entry, id: 'CI_1' }]), 'API_KEYS[0].id'],
    ['an org that breaks the grammar', JSON.stringify([{ ...entry, org: 'a b' }]), 'API_KEYS[0].org'],
    ['an unknown permission', JSON.stringify([{ ...entry, permissions: ['admin'] }]), 'API_KEYS[0].permissions[0]'],
    ['a playbook that breaks the grammar', JSON.stringify([{ ...entry, playbooks: ['B'] }]), 'API_KEYS[0].playbooks'],
    ['a missing field', JSON.stringify([{ id: 'ci-1' }]), 'API_KEYS[0].org: Missing key'],
  ])('rejects %s with a named error that points at it', (_case, value, mention) => {
    const error = errorFrom(value);

    expect(error).toBeInstanceOf(InvalidApiKeysError);
    expect(error).toMatchObject({ name: 'InvalidApiKeysError' });
    expect(String(error)).toContain(mention);
  });

  it('reads an unquoted compact JSON line from an env file unchanged', () => {
    const directory = mkdtempSync(join(tmpdir(), 'api-keys-'));
    onTestFinished(() => {
      rmSync(directory, { recursive: true, force: true });
    });
    const line = JSON.stringify([entry, everything]);
    writeFileSync(join(directory, 'keys.env'), `API_KEYS=${line}\n`);

    const { stdout } = spawnSync(
      process.execPath,
      [`--env-file=${join(directory, 'keys.env')}`, '--eval', 'process.stdout.write(String(process.env.API_KEYS))'],
      { encoding: 'utf8', env: {} },
    );

    expect(stdout).toBe(line);
    expect(readApiKeys({ API_KEYS: stdout })).toEqual([entry, everything]);
  });
});

describe('the org reserved for local mode', () => {
  it('is refused in API_KEYS, naming the setting and not the value', () => {
    const error = errorFrom(JSON.stringify([{ ...entry, org: 'local' }]));

    expect(error).toBeInstanceOf(InvalidApiKeysError);
    expect(String(error)).toBe('InvalidApiKeysError: API_KEYS[0].org: This org id is reserved for local mode');
  });
});

describe('the key id the local developer is recorded under', () => {
  it('is refused in API_KEYS, so no key can act as the local developer on the facts', () => {
    const error = errorFrom(JSON.stringify([{ ...entry, id: 'local' }]));

    expect(error).toBeInstanceOf(InvalidApiKeysError);
    expect(String(error)).toBe('InvalidApiKeysError: API_KEYS[0].id: This key id is reserved for the local developer');
  });
});
