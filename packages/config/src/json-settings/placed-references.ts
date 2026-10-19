import { JsonPointer, Redacted } from 'effect';

import type { Reference } from '../config-file/references.ts';
import { problem, type SettingProblem } from './json-setting.ts';

export interface ReferencePlacement {
  readonly setting: string;
  readonly entry: string;
  readonly fields: readonly string[];
  readonly misplaced: string;
}

function holdsSecrets({ entry, fields }: ReferencePlacement, { pointer }: Reference): boolean {
  const base = `/${JsonPointer.escapeToken(entry)}`;
  return fields.some((field) => pointer.startsWith(`${base}/${field}/`) || pointer === `${base}/${field}`);
}

export function misplacedReferences(
  placement: ReferencePlacement,
  references: readonly Reference[],
): readonly SettingProblem[] {
  return references
    .filter((reference) => !holdsSecrets(placement, reference))
    .map(({ pointer }) => problem(placement.setting, pointer, placement.misplaced));
}

export function secretsReferencedIn(
  placement: ReferencePlacement,
  references: readonly Reference[],
): readonly Redacted.Redacted[] {
  return references
    .filter((reference) => holdsSecrets(placement, reference))
    .flatMap(({ value }) => (value === null ? [] : [Redacted.make(value)]));
}
