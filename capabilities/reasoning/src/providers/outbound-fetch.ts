import { isUntrustedCertificate } from '@on.auto/outbound';

import { OutboundFailure } from './outbound-failure.ts';

export function withCertificateFailures<Args extends readonly unknown[], Answer>(
  send: (...args: Args) => Promise<Answer>,
): (...args: Args) => Promise<Answer> {
  return async (...args) => {
    try {
      return await send(...args);
    } catch (error) {
      if (isUntrustedCertificate(error)) {
        throw new OutboundFailure('untrusted_certificate');
      }
      throw error;
    }
  };
}
