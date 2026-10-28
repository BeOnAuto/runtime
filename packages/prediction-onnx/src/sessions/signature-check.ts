import type { FedShape } from '@on.auto/prediction-contract';
import { Array } from 'effect';

export interface TensorSignature {
  readonly name: string;
  readonly type: string;
  readonly shape: readonly (number | string)[];
}

type Axis =
  | { readonly fixed: number }
  | { readonly dynamic: string }
  | { readonly either: number; readonly as: string };

interface Expected {
  readonly name: string;
  readonly type: string;
  readonly axes: readonly Axis[];
}

const leastOpset = 13;

function axisFits(axis: Axis, found: number | string | undefined): boolean {
  if ('fixed' in axis) {
    return found === axis.fixed;
  }
  if ('dynamic' in axis) {
    return typeof found === 'string' || (typeof found === 'number' && found > 0);
  }
  return typeof found === 'string' || found === axis.either;
}

function axisWords(axis: Axis): string {
  if ('fixed' in axis) {
    return String(axis.fixed);
  }
  return 'dynamic' in axis ? axis.dynamic : axis.as;
}

function expectedOf(fed: FedShape): {
  readonly inputs: readonly Expected[];
  readonly output: Expected;
} {
  const one: Axis = { either: 1, as: '1' };
  const periods: Axis = { dynamic: 'L' };
  const summed = fed.totals;
  const ahead: Axis = summed ? { dynamic: 'H' } : { either: fed.horizon, as: 'H' };
  const { features, given } = fed;
  return {
    inputs: [
      { name: 'y', type: 'float32', axes: [one, periods] },
      ...(features === 0 ? [] : [{ name: 'x', type: 'float32', axes: [one, periods, { fixed: features }] }]),
      ...(given === 0 ? [] : [{ name: 'given', type: 'float32', axes: [one, ahead, { fixed: given }] }]),
      ...(summed ? [{ name: 'h', type: 'int64', axes: [one] }] : []),
    ],
    output: { name: 'q', type: 'float32', axes: [one, summed ? one : ahead, { fixed: 3 }] },
  };
}

function names(tensors: readonly { readonly name: string }[]): string {
  return `[${tensors.map(({ name }) => name).join(', ')}]`;
}

function tensorIssue(found: TensorSignature, expected: Expected, what: string): string | undefined {
  const fits =
    found.type === expected.type &&
    found.shape.length === expected.axes.length &&
    expected.axes.every((axis, at) => axisFits(axis, found.shape[at]));
  return fits
    ? undefined
    : `The model's ${what} ${found.name} is ${found.type} [${found.shape.join(', ')}], where the playbook feeds ${expected.type} [${expected.axes.map((axis) => axisWords(axis)).join(', ')}]; export to the published signature`;
}

function sortedNames(tensors: readonly { readonly name: string }[]): string {
  return tensors
    .map(({ name }) => name)
    .toSorted()
    .join(',');
}

function namesIssue(
  found: readonly TensorSignature[],
  expected: readonly Expected[],
  what: string,
): string | undefined {
  return sortedNames(found) === sortedNames(expected)
    ? undefined
    : `The model's ${what} are ${names(found)} and the playbook feeds ${names(expected)}; export to the published signature`;
}

function byName(one: { readonly name: string }, other: { readonly name: string }): number {
  return one.name < other.name ? -1 : 1;
}

function shapeIssues(
  found: readonly TensorSignature[],
  expected: readonly Expected[],
  what: string,
): readonly (string | undefined)[] {
  return Array.zipWith(found.toSorted(byName), expected.toSorted(byName), (tensor, wanted) =>
    tensorIssue(tensor, wanted, what),
  );
}

export interface FoundSignature {
  readonly inputs: readonly TensorSignature[];
  readonly outputs: readonly TensorSignature[];
  readonly opset: number;
}

export function signatureIssue(fed: FedShape, { inputs, outputs, opset }: FoundSignature): string | undefined {
  const expected = expectedOf(fed);
  const named = namesIssue(inputs, expected.inputs, 'inputs') ?? namesIssue(outputs, [expected.output], 'outputs');
  if (named !== undefined) {
    return named;
  }
  const shaped = [
    ...shapeIssues(inputs, expected.inputs, 'input'),
    ...shapeIssues(outputs, [expected.output], 'output'),
  ].find((issue) => issue !== undefined);
  if (shaped !== undefined) {
    return shaped;
  }
  return opset >= leastOpset
    ? undefined
    : `The model's opset is ${opset}, and the playbook takes ${leastOpset} or later`;
}
