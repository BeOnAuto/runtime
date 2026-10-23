import { Option } from 'effect';

export interface ModelReference {
  readonly provider: string;
  readonly model: string;
}

const separator = '/';

export const mostModelIdCharacters = 256;

const visibleCharacters = /^[^\s\p{Cc}]+$/u;

const arn = /(?:^|\/)arn:/u;

export function parseModelReference(reference: string): Option.Option<ModelReference> {
  const split = reference.indexOf(separator);
  if (split < 1 || split === reference.length - 1) {
    return Option.none();
  }
  return Option.some({ provider: reference.slice(0, split), model: reference.slice(split + 1) });
}

export function providerOf(reference: string): string {
  return Option.match(parseModelReference(reference), { onNone: () => reference, onSome: ({ provider }) => provider });
}

export function hasOnlyVisibleCharacters(text: string): boolean {
  return visibleCharacters.test(text);
}

export function isModelId(id: string): boolean {
  return id.length <= mostModelIdCharacters && hasOnlyVisibleCharacters(id);
}

export function namesAnArn(reference: string): boolean {
  return arn.test(reference);
}
