import type { AssetKeptData } from './asset-facts.ts';

export const kindInWords: Readonly<Record<AssetKeptData['kind'], string>> = {
  image: 'an image',
  audio: 'audio',
  video: 'a video',
  text: 'a file',
  file: 'a file',
};

export function dayOf(at: string): string {
  return at.slice(0, 10);
}
