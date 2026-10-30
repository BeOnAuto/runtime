import { streamPrefixOfPlaybook, type PlaybookAddress } from '@on.auto/operations';

import type { ContentLocation } from './content-location.ts';

export interface ObjectKeys {
  readonly kept: (playbook: PlaybookAddress, sha256: string) => string;
  readonly uploads: string;
  readonly upload: (uploadId: string) => string;
}

export function objectKeysOf({ prefix }: ContentLocation): ObjectKeys {
  const under = (key: string) => (prefix === '' ? key : `${prefix}/${key}`);
  return {
    kept: (playbook, sha256) => under(`${streamPrefixOfPlaybook(playbook)}${sha256}`),
    uploads: under('uploads/'),
    upload: (uploadId) => under(`uploads/${uploadId}`),
  };
}
