import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { DecidingOptions } from '../runner/run-descriptors.ts';
import { runner } from '../runner/runner.ts';
import { sessionOf, type SessionResult } from '../runner/session.ts';
import { applied } from './run-inputs.ts';

export function resultOf(state: RunState, at: number, options: DecidingOptions, input: RunInput): SessionResult {
  const session = sessionOf(state, at, options);
  applied({ session, runner }, input);
  return session.result();
}
