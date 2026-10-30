import type { Result } from 'effect';

export interface ExtensionPoint<Implementation = unknown> {
  readonly name: string;
  readonly contracts: { readonly least: number; readonly most: number };
  readonly implementationOf: (value: unknown) => Result.Result<Implementation, string>;
  reservedForTheRelease?(implementation: Implementation): string | undefined;
}

export interface ProvidedImplementation<Implementation> {
  readonly package: string;
  readonly implementation: Implementation;
}

export type ImplementationsProvided = <Implementation>(
  point: ExtensionPoint<Implementation>,
) => readonly ProvidedImplementation<Implementation>[];
