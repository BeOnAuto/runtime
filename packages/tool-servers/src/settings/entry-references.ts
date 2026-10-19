import {
  misplacedReferences,
  secretsReferencedIn,
  type Reference,
  type ReferencePlacement,
  type SettingProblem,
} from '@on.auto/config';
import { JsonPointer, Redacted } from 'effect';

import { toolServersSetting, type ServerEntryFields } from './server-entries.ts';

const misplaced =
  'Holds a reference to an environment variable, which only headers, query_params, security, env and auth may hold: an argument shows in the listing of the processes of the machine, and the URL of a server or of a document is no place for a credential';

function placementOf(entry: string): ReferencePlacement {
  return {
    setting: toolServersSetting,
    entry,
    fields: ['headers', 'query_params', 'security', 'env', 'auth'],
    misplaced,
  };
}

export function misplacedReferencesOfEntry(entry: string, references: readonly Reference[]): readonly SettingProblem[] {
  return misplacedReferences(placementOf(entry), references);
}

export function unreferencedSecurity(
  entry: string,
  written: ServerEntryFields,
  references: readonly Reference[],
): readonly string[] {
  const pointers = new Set(references.map(({ pointer }) => pointer));
  return Object.keys(written.security ?? {})
    .map((scheme) => `/${JsonPointer.escapeToken(entry)}/security/${JsonPointer.escapeToken(scheme)}`)
    .filter((pointer) => !pointers.has(pointer));
}

const schemeAndCredential = /^[A-Za-z][\w!#$%&'*+.^`|~-]* +(\S.*)$/u;

function credentialAfterItsScheme(headers: string, { pointer, value }: Reference): readonly Redacted.Redacted[] {
  const [, credential] = value !== null && pointer.startsWith(headers) ? (schemeAndCredential.exec(value) ?? []) : [];
  return credential === undefined ? [] : [Redacted.make(credential)];
}

export function secretsOfEntry(
  entry: string,
  fields: ServerEntryFields,
  references: readonly Reference[],
): readonly Redacted.Redacted[] {
  const headers = `/${JsonPointer.escapeToken(entry)}/headers/`;
  const afterTheirScheme = references.flatMap((reference) => credentialAfterItsScheme(headers, reference));
  const wholeValues = Object.values(fields.security ?? {}).map((value) => Redacted.make(value));
  const values = [...secretsReferencedIn(placementOf(entry), references), ...afterTheirScheme, ...wholeValues].map(
    (secret) => Redacted.value(secret),
  );
  return [...new Set(values)].map((value) => Redacted.make(value));
}
