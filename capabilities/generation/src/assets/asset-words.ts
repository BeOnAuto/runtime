import type { AssetKeptData } from './asset-facts.ts';

const kibibyte = 1024;

const mebibyte = 1_048_576;

const whole = new Intl.NumberFormat('en');

const tenths = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

export function sizeInWords(bytes: number): string {
  if (bytes < kibibyte) {
    return bytes === 1 ? '1 byte' : `${whole.format(bytes)} bytes`;
  }
  return bytes < mebibyte ? `${tenths.format(bytes / kibibyte)} KiB` : `${tenths.format(bytes / mebibyte)} MiB`;
}

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
