import { jsonOfText } from '../dsl/json.ts';
import type { DslError } from '../machine/dsl-error.ts';
import { heldContentOf, type HeldContents } from '../machine/held-contents.ts';
import type { AppliedInput, RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import { inputsBound, lostContentBound, lostKeptBound } from './run-bounds.ts';

export type Applying = { readonly applied: AppliedInput } | { readonly ending: DslError };

type GivenInput = { readonly input: AppliedInput } | { readonly lost: DslError };

function givenInputOf(input: RunInput, contents: HeldContents): GivenInput {
  if (input.kind !== 'call_answered') {
    return { input };
  }
  const { result } = input;
  if (!('output_sha256' in result)) {
    return { input: { ...input, result } };
  }
  const sha256 = result.output_sha256;
  const content = heldContentOf(contents, sha256);
  return content.kind === 'read'
    ? { input: { ...input, result: { status: 'succeeded', output: jsonOfText(content.text) } } }
    : { lost: lostKeptBound('The output a call answered', { sha256, kind: content.kind }) };
}

export function applyingOf(state: RunState, contents: HeldContents, input: RunInput): Applying {
  const lost = lostContentBound(state, contents);
  if (lost !== undefined) {
    return { ending: lost };
  }
  const given = givenInputOf(input, contents);
  if ('lost' in given) {
    return { ending: given.lost };
  }
  const bound = inputsBound(state);
  return bound === undefined ? { applied: given.input } : { ending: bound };
}
