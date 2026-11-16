import type { GuideVariables } from '@on.auto/definitions';

type GuideVariable = GuideVariables[string];

import { isEdge, type Here, type PageRead } from './page-read.ts';
import type { Placed, Token } from './page-tokens.ts';
import { faultAt, undeclared, type Reading } from './reading.ts';
import { startsOfWholeValues, unknownNamesIn } from './variable-forms.ts';

interface Copy {
  readonly name: string;
  readonly written: string;
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

const shapes: readonly (readonly string[])[] = [
  ['space', 'fence', 'space', 'close'],
  ['space', 'comment', 'fence', 'space', 'close'],
];

const exampleForm =
  'declares a code example in a form a page may not use: <div data-variable="…"> alone on its line, a blank line, one fenced code example, a blank line and </div>, set apart by blank lines.';

function kindOf({ type, raw }: Token): string {
  if (type === 'code') {
    return /^ {0,3}(?:```|~~~)/u.test(raw) ? 'fence' : 'indented';
  }
  if (type !== 'html') {
    return type;
  }
  if (raw.trimEnd() === '</div>') {
    return 'close';
  }
  return raw.startsWith('<!--') ? 'comment' : 'html';
}

function shapeOf(following: readonly Placed[]): readonly string[] | undefined {
  return shapes.find((kinds) =>
    kinds.every((kind, at) => following.slice(at, at + 1).some(({ token }) => kindOf(token) === kind)),
  );
}

function copiesOf(name: string, declared: GuideVariable | undefined, fence: string): readonly Copy[] {
  return declared === undefined
    ? []
    : startsOfWholeValues(fence, declared.default).map((start) => ({
        name,
        written: declared.default,
        start,
        end: start + declared.default.length,
        value: declared.value,
      }));
}

function copiesIn(fence: string, names: readonly string[], variables: GuideVariables): readonly Copy[] {
  return names
    .flatMap((name) => copiesOf(name, variables[name], fence))
    .toSorted((one, other) => one.start - other.start);
}

function filled(fence: string, copies: readonly Copy[]): string {
  const replaced = copies.reduce<{ readonly kept: string; readonly from: number }>(
    ({ kept, from }, { start, end, value }) => ({ kept: `${kept}${fence.slice(from, start)}${value}`, from: end }),
    { kept: '', from: 0 },
  );
  return `${replaced.kept}${fence.slice(replaced.from)}`;
}

function faultsOfNames(
  names: readonly string[],
  copies: readonly Copy[],
  variables: GuideVariables,
): readonly string[] {
  return names.flatMap((name) => {
    const declared = variables[name];
    if (declared === undefined) {
      return [undeclared(name)];
    }
    return copies.some((copy) => copy.name === name)
      ? []
      : [`declares ${name} in a code example that does not hold its default, "${declared.default}", as a whole value.`];
  });
}

function faultsOfSharedWords(copies: readonly Copy[]): readonly string[] {
  const faults = copies.flatMap((one, index) =>
    copies
      .slice(index + 1)
      .filter((other) => other.name !== one.name && other.start < one.end)
      .map(
        (other) =>
          `declares ${one.name} and ${other.name} in a code example where their defaults, "${one.written}" and "${other.written}", share their words, so the example cannot tell the two apart.`,
      ),
  );
  return [...new Set(faults)];
}

function faultedExample(page: PageRead, here: Here, fault: string): Reading {
  return { edits: [], faults: [faultAt(page.text, here.placed.at, fault)], stale: [] };
}

export function exampleReading(page: PageRead, here: Here, value: string): Reading {
  const unknown = unknownNamesIn(value, true);
  if (unknown !== undefined) {
    return faultedExample(page, here, unknown);
  }
  const following = page.placed.slice(here.index + 1, here.index + 6);
  const shape = shapeOf(following);
  if (shape === undefined || !isEdge(page, here.index - 1) || !isEdge(page, here.index + shape.length + 1)) {
    return faultedExample(page, here, exampleForm);
  }
  const names = value.split(' ');
  const inner = following.slice(1, shape.length - 2);
  const fence = inner
    .filter(({ token }) => token.type === 'code')
    .map(({ token }) => token.raw)
    .join('');
  const end = following
    .slice(shape.length - 1, shape.length)
    .reduce((_end, { token, at }) => at + token.raw.length, here.placed.at);
  const copies = copiesIn(fence, names, page.variables);
  const words = inner.map(({ token }) => (token.type === 'code' ? filled(token.raw, copies) : token.raw)).join('');
  return {
    edits: [{ start: here.placed.at, end, words }],
    faults: [...faultsOfNames(names, copies, page.variables), ...faultsOfSharedWords(copies)].map((fault) =>
      faultAt(page.text, here.placed.at, fault),
    ),
    stale: [],
  };
}
