import type { AssetContent } from '@on.auto/operations';

import type { PlaceDeclared } from './schema-places.ts';

export type SentEncoding = 'text' | 'base64' | 'json';

const typesOfAValue = ['object', 'array'] as const;

function takes({ types }: PlaceDeclared, type: string): boolean {
  return types === 'any' || types.has(type);
}

export function encodingOf(content: AssetContent, declared: PlaceDeclared): SentEncoding | undefined {
  if (declared.base64) {
    return 'base64';
  }
  if (content === 'json' && typesOfAValue.some((type) => takes(declared, type))) {
    return 'json';
  }
  return content !== 'file' && takes(declared, 'string') ? 'text' : undefined;
}
