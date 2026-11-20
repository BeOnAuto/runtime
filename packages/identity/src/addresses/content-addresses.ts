import { createHmac, timingSafeEqual } from 'node:crypto';

import type { PlaybookAddress } from '@on.auto/operations';
import { Redacted } from 'effect';

import { isHttpsOrLoopback } from '../access/loopback-names.ts';

export type ContentAddressKey = Redacted.Redacted<Uint8Array>;

export interface ContentSignature {
  readonly until: string | undefined;
  readonly sig: string | undefined;
}

export type ContentAddressCheck = 'signed' | 'expired' | 'not_for_this_content';

export type SignedContentAddress = (
  ownOrigin: string,
  playbook: PlaybookAddress,
  sha256: string,
  until?: number,
) => string | undefined;

export interface ContentAddresses {
  readonly signedContentAddress: SignedContentAddress;
  readonly checkedAddress: (
    playbook: PlaybookAddress,
    sha256: string,
    presented: ContentSignature,
  ) => ContentAddressCheck;
}

const untilText = /^\d{1,15}$/u;

const sha256Text = /^[0-9a-f]{64}$/u;

function signatureOf(
  key: ContentAddressKey,
  { org, playbook }: PlaybookAddress,
  sha256: string,
  until: string | undefined,
): Buffer {
  const signed = until === undefined ? [org, playbook, sha256] : [org, playbook, sha256, until];
  return createHmac('sha256', Redacted.value(key)).update(JSON.stringify(signed)).digest();
}

function secondsAt(milliseconds: number): number {
  return Math.floor(milliseconds / 1000);
}

function searchOf(until: string | undefined, sig: string): Record<string, string> {
  return until === undefined ? { sig } : { until, sig };
}

export function contentPathOf({ org, playbook }: PlaybookAddress, sha256: string): string {
  return ['', 'v1', 'orgs', org, 'playbooks', playbook, 'content', sha256]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function contentAddressesUnder(key: ContentAddressKey, now: () => number = Date.now): ContentAddresses {
  const signedFor = (playbook: PlaybookAddress, sha256: string, { until, sig = '' }: ContentSignature) =>
    sha256Text.test(sha256) &&
    (until === undefined || untilText.test(until)) &&
    sha256Text.test(sig) &&
    timingSafeEqual(signatureOf(key, playbook, sha256, until), Buffer.from(sig, 'hex'));
  const addressOf: SignedContentAddress = (ownOrigin, playbook, sha256, until) => {
    const signedUntil = until === undefined ? undefined : String(Math.floor(until));
    const address = new URL(contentPathOf(playbook, sha256), ownOrigin);
    const sig = signatureOf(key, playbook, sha256, signedUntil).toString('hex');
    address.search = new URLSearchParams(searchOf(signedUntil, sig)).toString();
    return address.href;
  };
  return {
    signedContentAddress: (ownOrigin, playbook, sha256, until) =>
      isHttpsOrLoopback(ownOrigin) ? addressOf(ownOrigin, playbook, sha256, until) : undefined,
    checkedAddress: (playbook, sha256, presented) => {
      if (!signedFor(playbook, sha256, presented)) {
        return 'not_for_this_content';
      }
      return presented.until !== undefined && Number(presented.until) < secondsAt(now()) ? 'expired' : 'signed';
    },
  };
}
