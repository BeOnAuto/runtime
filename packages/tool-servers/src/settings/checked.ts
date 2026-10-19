import { problem, type SettingProblem } from '@on.auto/config';
import { namesTheLoopback } from '@on.auto/operations';
import { JsonPointer, Redacted } from 'effect';

import { toolServersSetting } from './server-entries.ts';

export type Checked<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly problems: readonly SettingProblem[] };

export const pinnedUrlShape = 'Expected an https URL, or an http URL on a loopback address';

export const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

export function at(name: string, ...path: readonly string[]): string {
  return [name, ...path].map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

export function accepted<A>(value: A): Checked<A> {
  return { ok: true, value };
}

export function rejected<A>(problems: readonly SettingProblem[]): Checked<A> {
  return { ok: false, problems };
}

export function refused<A>(name: string, path: readonly string[], detail: string): Checked<A> {
  return rejected([problem(toolServersSetting, at(name, ...path), detail)]);
}

export function problemsOf(...checked: readonly Checked<unknown>[]): readonly SettingProblem[] {
  return checked.flatMap((each) => (each.ok ? [] : each.problems));
}

export function redactedValuesOf(values: Readonly<Record<string, string>>): ReadonlyMap<string, Redacted.Redacted> {
  return new Map(Object.entries(values).map(([key, value]: readonly [string, string]) => [key, Redacted.make(value)]));
}

export function isPinnableUrl(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const { protocol, hostname } = new URL(url);
  return protocol === 'https:' || (protocol === 'http:' && namesTheLoopback(hostname));
}
