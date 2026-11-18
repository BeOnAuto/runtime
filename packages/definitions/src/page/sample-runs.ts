import { InvalidInput } from '@on.auto/operations';
import { Clock, Effect, type Schema } from 'effect';

import { sampleIssuesOf } from '../operations/definition-fields.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import type { RunShown } from './page-rendering.ts';

const sampleRefused = 'The sample output does not match the output schema of the page’s subject';

export const sampleRunOf = Effect.fnUntraced(function* (subject: StoredDefinition, sample: Schema.Json) {
  const issues = sampleIssuesOf(subject)(sample);
  if (issues.length > 0) {
    return yield* new InvalidInput({
      detail: sampleRefused,
      issues: issues.map(({ pointer, detail }) => ({ pointer: `/sample_output${pointer}`, detail })),
    });
  }
  const now = new Date(yield* Clock.currentTimeMillis).toISOString();
  const run: RunShown = { status: 'succeeded', output: sample, started: now, ended: now, version: subject.version };
  return run;
});
