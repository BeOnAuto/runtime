import type { Schema } from 'effect';

import type { RunWords } from '../capability/capability.ts';

export function deferralAccount(words: RunWords, { record }: { readonly record: Schema.JsonObject }) {
  const account = words.deferral(record);
  return account === undefined
    ? undefined
    : { type: words.deferralType, summary: account.summary, data: { record, ...account.data } };
}
