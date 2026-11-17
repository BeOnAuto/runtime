import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const releaseReads = fileURLToPath(new URL('release-reads.ts', import.meta.url));

describe('the reads a release makes of the files its packages ship', () => {
  it('pass on the sources, the guide shelf among them with each value its pages name declared', () => {
    expect(execFileSync(process.execPath, [releaseReads], { encoding: 'utf8', stdio: 'pipe' })).toContain(
      'the guide shelf of a server of workflows and pages, start, terminology, workflow, templates',
    );
  });
});
