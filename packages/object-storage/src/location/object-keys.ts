import { streamPrefixOfPlaybook, type PlaybookAddress } from '@on.auto/operations';

import type { ContentLocation } from './content-location.ts';

export interface ObjectKeys {
  readonly kept: (playbook: PlaybookAddress, sha256: string) => string;
  readonly uploads: string;
  readonly upload: (uploadId: string) => string;
  readonly run: (playbook: PlaybookAddress, run: string) => string;
  readonly staged: (playbook: PlaybookAddress, run: string, sha256: string) => string;
  readonly ended: (playbook: PlaybookAddress, run: string) => string;
}

const endedMarker = '.ended';

export function objectKeysOf({ prefix }: ContentLocation): ObjectKeys {
  const under = (key: string) => (prefix === '' ? key : `${prefix}/${key}`);
  const run = (playbook: PlaybookAddress, id: string) =>
    under(`staging/${streamPrefixOfPlaybook(playbook)}${encodeURIComponent(id)}/`);
  return {
    kept: (playbook, sha256) => under(`${streamPrefixOfPlaybook(playbook)}${sha256}`),
    uploads: under('uploads/'),
    upload: (uploadId) => under(`uploads/${uploadId}`),
    run,
    staged: (playbook, id, sha256) => `${run(playbook, id)}${sha256}`,
    ended: (playbook, id) => `${run(playbook, id)}${endedMarker}`,
  };
}
