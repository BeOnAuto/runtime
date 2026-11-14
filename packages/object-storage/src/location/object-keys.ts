import type { ContentLocation } from './content-location.ts';

export interface ObjectKeys {
  readonly kept: (place: string, sha256: string) => string;
  readonly uploads: string;
  readonly upload: (uploadId: string) => string;
}

export function objectKeysOf({ prefix }: ContentLocation): ObjectKeys {
  const under = (key: string) => (prefix === '' ? key : `${prefix}/${key}`);
  return {
    kept: (place, sha256) => under(`${place}${sha256}`),
    uploads: under('uploads/'),
    upload: (uploadId) => under(`uploads/${uploadId}`),
  };
}
