export type OutboundFailureReason = 'credential_lookup_failed' | 'untrusted_certificate';

export const credentialLookupMarker = 'credential lookup failed';

const messages: Readonly<Record<OutboundFailureReason, string>> = {
  credential_lookup_failed: credentialLookupMarker,
  untrusted_certificate: 'untrusted certificate',
};

export class OutboundFailure extends Error {
  readonly reason: OutboundFailureReason;

  constructor(reason: OutboundFailureReason) {
    super(messages[reason]);
    this.name = 'OutboundFailure';
    this.reason = reason;
  }
}
