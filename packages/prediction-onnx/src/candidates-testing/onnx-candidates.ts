import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onTestFinished } from 'vitest';

export type CandidateName =
  | 'visits-last'
  | 'visits-mean'
  | 'visits-week'
  | 'visits-many-features'
  | 'visits-extra-input'
  | 'visits-opset-12'
  | 'visits-whole-numbers'
  | 'visits-allocating'
  | 'visits-hostile'
  | 'visits-sibling'
  | 'visits-cousin'
  | 'visits-sequence'
  | 'orders-last'
  | 'totals-run-rate'
  | 'not-a-model';

export function candidatePath(name: CandidateName): string {
  return fileURLToPath(new URL(`../../candidates/${name}.onnx`, import.meta.url));
}

export function candidateBytes(name: CandidateName): Readonly<Uint8Array> {
  return readFileSync(candidatePath(name));
}

export function candidateSha256(name: CandidateName): string {
  return createHash('sha256').update(candidateBytes(name)).digest('hex');
}

export function scratchFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-onnx-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}
