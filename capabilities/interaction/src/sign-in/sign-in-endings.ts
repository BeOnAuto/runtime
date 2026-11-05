import type { CapabilityAnswer, RecordedAnswer, Settlement, SignInRecord } from '@on.auto/definitions';
import { Option, Schema } from 'effect';

import type { SignInSite } from '../document/interaction-document.ts';
import { signedIn } from './sign-in-schemas.ts';
import { declinedWords } from './sign-in-words.ts';

const SignedInRecordSchema = Schema.Struct({
  sign_in: Schema.Struct({ server: Schema.String, site: Schema.String }),
});

const decodeSignedInRecord = Schema.decodeUnknownOption(SignedInRecordSchema);

function signedInRecordOf({ server, site }: SignInSite): Schema.JsonObject {
  return { sign_in: { server, site } };
}

export function signedInAtOnce(site: SignInSite): CapabilityAnswer {
  return { output: signedIn, record: signedInRecordOf(site) };
}

export function signedInSiteOf(record: unknown): SignInSite | undefined {
  return Option.getOrUndefined(Option.map(decodeSignedInRecord(record), ({ sign_in: site }) => site));
}

const decodeSaid = Schema.decodeUnknownSync(
  Schema.Struct({ signed_in: Schema.Boolean, reason: Schema.optionalKey(Schema.String) }),
);

export function signInSettlement(
  { server, site }: SignInRecord,
  { answer, by }: Pick<RecordedAnswer, 'answer' | 'by'>,
): Settlement {
  const said = decodeSaid(answer);
  return said.signed_in
    ? { status: 'succeeded', output: signedIn, record: signedInRecordOf({ server, site }), by: by.id }
    : {
        status: 'rejected',
        reason: 'unanswered',
        kind: 'declined',
        detail: declinedWords({ site }, by, said.reason),
        by: by.id,
      };
}
