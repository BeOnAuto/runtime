import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { recordedFactsUnder } from './recorded-facts.ts';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function aRuntime(): string {
  const folder = mkdtempSync(join(tmpdir(), 'recorded-facts-'));
  folders.push(folder);
  mkdirSync(join(folder, 'packages', 'notes', 'fixtures'), { recursive: true });
  mkdirSync(join(folder, 'packages', 'plain'), { recursive: true });
  mkdirSync(join(folder, 'capabilities', 'shelves'), { recursive: true });
  return folder;
}

const context = { at: '2026-11-02T09:00:00.000Z', by: 'key_7f3a' };

describe('the facts the packages of a runtime recorded', () => {
  it('are the fixtures each package or capability names in its manifest of recorded facts, and none of a package with no manifest', () => {
    const runtime = aRuntime();
    const notes = join(runtime, 'packages', 'notes');
    writeFileSync(join(notes, 'recorded-facts.json'), JSON.stringify({ 'fixtures/note-added.json': 'note_added 1' }));
    writeFileSync(
      join(notes, 'fixtures', 'note-added.json'),
      JSON.stringify({ type: 'note_added', data: { text: 'hello' }, context }),
    );

    expect(recordedFactsUnder(runtime)).toEqual([{ type: 'note_added', data: { text: 'hello' }, context }]);
  });
});
