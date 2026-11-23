import { JsonPointer } from 'effect';

import type { ApiDocument, DocumentProblem, Parameter } from './api-document.ts';
import type { Placed } from './api-parameters.ts';
import { keepsItsSegments } from './api-requests.ts';

export type PathValues = ReadonlyMap<string, string>;

export const noPathValues: PathValues = new Map();

const notBelowTheBase =
  'Expected a path that begins with /, since a path written otherwise joins the host or the port of base_url and a call would go elsewhere';

const leavesItself =
  'A path a call cannot keep as written: a . or .. segment, or a ? or #, would move the call out of it';

export function pathProblemsOf(document: ApiDocument): readonly DocumentProblem[] {
  return Object.keys(document.paths ?? {}).flatMap((path) => {
    const pointer = `/paths/${JsonPointer.escapeToken(path)}`;
    if (!path.startsWith('/')) {
      return [{ pointer, detail: notBelowTheBase }];
    }
    return keepsItsSegments(path) && !/[?#]/u.test(path) ? [] : [{ pointer, detail: leavesItself }];
  });
}

export function writtenPathOf(path: string, pathValues: PathValues): string {
  return [...pathValues].reduce(
    (written, [name, value]: readonly [string, string]) => written.replaceAll(`{${name}}`, encodeURIComponent(value)),
    path,
  );
}

export function argumentsOf(
  parameters: readonly Placed<Parameter>[],
  pathValues: PathValues,
): readonly Placed<Parameter>[] {
  return parameters.filter(({ value }) => value.in !== 'path' || !pathValues.has(value.name));
}

export function pathValueProblemsOf(document: ApiDocument, pathValues: PathValues): readonly DocumentProblem[] {
  const paths = Object.keys(document.paths ?? {});
  return [...pathValues.keys()]
    .filter((parameter) => !paths.some((path) => path.includes(`{${parameter}}`)))
    .map((parameter) => ({
      pointer: '/paths',
      detail: `No path holds {${parameter}}, the parameter path_values gives a value for`,
    }));
}
