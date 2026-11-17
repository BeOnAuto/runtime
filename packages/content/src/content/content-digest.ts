import { createHash, hash } from 'node:crypto';

import { textPieceCodeUnits, textPieces } from './text-pieces.ts';

export interface Sha256Digest {
  readonly update: (content: string | Readonly<Uint8Array>) => void;
  readonly hex: () => string;
}

export function sha256Digest(): Sha256Digest {
  const digest = createHash('sha256');
  return {
    update: (content) => {
      digest.update(content);
    },
    hex: () => digest.digest('hex'),
  };
}

function sha256OfText(text: string): string {
  const digest = sha256Digest();
  for (const piece of textPieces(text)) {
    digest.update(piece);
  }
  return digest.hex();
}

export function sha256Of(content: string | Readonly<Uint8Array>): string {
  return typeof content === 'string' && content.length > textPieceCodeUnits
    ? sha256OfText(content)
    : hash('sha256', content, 'hex');
}
