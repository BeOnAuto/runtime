import { lineageAttributeNames } from '@on.auto/operations';

export type RuntimeAttributeType = 'text' | 'whole number' | 'boolean';

type DeclaredAttribute = readonly [string, RuntimeAttributeType];

const lineageAttributes: readonly DeclaredAttribute[] = lineageAttributeNames.map((name): DeclaredAttribute => [
  name,
  'text',
]);

export const runtimeAttributeTypes: ReadonlyMap<string, RuntimeAttributeType> = new Map([
  ...lineageAttributes,
  ['caller', 'text'],
  ['definitionversion', 'whole number'],
  ['depth', 'whole number'],
  ['calldepth', 'whole number'],
  ['calledby', 'text'],
  ['triggerkind', 'text'],
  ['triggerreference', 'text'],
  ['automatic', 'boolean'],
]);

export function attributeTypeOf(name: string): RuntimeAttributeType {
  return runtimeAttributeTypes.get(name) ?? 'text';
}
