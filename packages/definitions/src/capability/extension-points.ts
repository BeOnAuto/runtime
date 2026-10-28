import type { Result } from 'effect';

export interface ExtensionPoint<Implementation = unknown> {
  readonly name: string;
  readonly contracts: { readonly least: number; readonly most: number };
  readonly implementationOf: (value: unknown) => Result.Result<Implementation, string>;
}

export type ImplementationsProvided = <Implementation>(
  point: ExtensionPoint<Implementation>,
) => readonly Implementation[];
