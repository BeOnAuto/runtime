import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ContentOwner } from '@on.auto/content';
import { Redacted } from 'effect';

import { isHttpsOrLoopback } from '../access/loopback-names.ts';

export const contentAddressLastsSeconds = 15 * 60;

const clockAllowanceSeconds = 30;

export type ContentAddressKey = Redacted.Redacted<Uint8Array>;

export interface ContentSignature {
  readonly until: string | undefined;
  readonly sig: string | undefined;
}

export type ContentAddressCheck = 'signed' | 'expired' | 'not_for_this_content';

export type SignedContentAddress = (
  ownOrigin: string,
  playbook: ContentOwner,
  sha256: string,
  until: number,
) => string | undefined;

export interface ContentAddresses {
  readonly signedContentAddress: SignedContentAddress;
  readonly checkedAddress: (playbook: ContentOwner, sha256: string, presented: ContentSignature) => ContentAddressCheck;
}

const untilText = /^\d{1,15}$/u;

const sha256Text = /^[0-9a-f]{64}$/u;

function signatureOf(key: ContentAddressKey, { org, playbook }: ContentOwner, sha256: string, until: string): Buffer {
  return createHmac('sha256', Redacted.value(key))
    .update(JSON.stringify([org, playbook, sha256, until]))
    .digest();
}

function secondsAt(milliseconds: number): number {
  return Math.floor(milliseconds / 1000);
}

export function contentPathOf({ org, playbook }: ContentOwner, sha256: string): string {
  return ['', 'v1', 'orgs', org, 'playbooks', playbook, 'content', sha256]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function contentAddressesUnder(key: ContentAddressKey, now: () => number = Date.now): ContentAddresses {
  const lastPossibleUntil = () => secondsAt(now()) + contentAddressLastsSeconds;
  const withinTheMostItLasts = (until: string) =>
    untilText.test(until) && Number(until) <= lastPossibleUntil() + clockAllowanceSeconds;
  const signedFor = (playbook: ContentOwner, sha256: string, { until = '', sig = '' }: ContentSignature) =>
    sha256Text.test(sha256) &&
    withinTheMostItLasts(until) &&
    sha256Text.test(sig) &&
    timingSafeEqual(signatureOf(key, playbook, sha256, until), Buffer.from(sig, 'hex'));
  const addressOf: SignedContentAddress = (ownOrigin, playbook, sha256, until) => {
    const signedUntil = String(Math.min(Math.floor(until), lastPossibleUntil()));
    const address = new URL(contentPathOf(playbook, sha256), ownOrigin);
    address.search = new URLSearchParams({
      until: signedUntil,
      sig: signatureOf(key, playbook, sha256, signedUntil).toString('hex'),
    }).toString();
    return address.href;
  };
  return {
    signedContentAddress: (ownOrigin, playbook, sha256, until) =>
      isHttpsOrLoopback(ownOrigin) ? addressOf(ownOrigin, playbook, sha256, until) : undefined,
    checkedAddress: (playbook, sha256, presented) => {
      if (!signedFor(playbook, sha256, presented)) {
        return 'not_for_this_content';
      }
      return Number(presented.until) < secondsAt(now()) ? 'expired' : 'signed';
    },
  };
}
