import type { OperationKind } from '../caller/operation-scope.ts';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface MethodsByKind {
  readonly query: 'GET' | 'POST';
  readonly command: 'POST' | 'PUT' | 'DELETE';
}

export type MethodOf<K extends OperationKind> = MethodsByKind[K];

const methodsWithoutABody: ReadonlySet<Method> = new Set(['GET', 'DELETE']);

export function takesNoBody({ method }: Pick<Route, 'method'>): boolean {
  return methodsWithoutABody.has(method);
}

export interface Route<
  K extends OperationKind = OperationKind,
  P extends string = string,
  M extends MethodOf<K> = MethodOf<K>,
> {
  readonly method: M;
  readonly path: P;
}

export type PathParameters<P extends string> = P extends `${string}{${infer Parameter}}${infer Rest}`
  ? Parameter | PathParameters<Rest>
  : never;

const pathGrammar = /^(?:\/(?:[a-z0-9][a-z0-9_-]*|\{[A-Za-z][A-Za-z0-9_]*\}))+$/u;

export function pathParametersOf(path: string): readonly string[] {
  const parameters = path
    .split('/')
    .filter((segment) => segment.startsWith('{'))
    .map((segment) => segment.slice(1, -1));
  if (!pathGrammar.test(path) || new Set(parameters).size !== parameters.length) {
    throw new Error(`The route path ${path} is malformed`);
  }
  return parameters;
}
