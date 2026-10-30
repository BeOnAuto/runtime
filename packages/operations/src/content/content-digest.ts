import { createHash, hash } from 'node:crypto';

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

export function sha256Of(content: string | Readonly<Uint8Array>): string {
  return hash('sha256', content, 'hex');
}
