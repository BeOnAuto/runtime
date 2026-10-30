import { createPublicKey, verify } from 'node:crypto';

import { Option, Schema } from 'effect';

import { shownOrgName } from './org-name.ts';

export const SignedSchema = Schema.Struct({ payload: Schema.String, signature: Schema.String, kid: Schema.String });

export type Signed = typeof SignedSchema.Type;

export type Signers = ReadonlyMap<string, string>;

export const autoSigners: Signers = new Map([['auto-2026-10', 'fHkCk7CbSg4IZQQXqQj_SVl86CvA_O8eT7xo12JkVaY']]);

export const StandingSchema = Schema.Literals(['ok', 'low', 'empty', 'overage', 'near_cap', 'capped']);

export type Standing = typeof StandingSchema.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const FeatureSchema = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u));

const Credits = Schema.Finite;

export const LicenseCreditsSchema = Schema.Struct({ available: Credits, owed: Credits, overage_cap: Credits });

export const FallbackSchema = Schema.Struct({ per_day: Count, per_month: Count });

export type Fallback = typeof FallbackSchema.Type;

const LicenseSchema = Schema.Struct({
  v: Schema.Literal(2),
  kind: Schema.Literal('license'),
  installation: Schema.String,
  org: Schema.String,
  org_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  plan: Schema.String,
  policy: Schema.String,
  issued_at: Schema.String,
  warn_at: Schema.String,
  limit_at: Schema.String,
  charged_through: Count,
  admits_through: Credits,
  standing: StandingSchema,
  credits: LicenseCreditsSchema,
  fallback: FallbackSchema,
  features: Schema.optionalKey(Schema.Array(Schema.String)),
});

const AllocationSchema = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal('allocation'),
  installation: Schema.String,
  id: Schema.String,
  credits: Schema.Int.check(Schema.isGreaterThan(0)),
  issued_at: Schema.String,
  refresh_by: Schema.String,
});

export type License = Omit<typeof LicenseSchema.Type, 'org_name' | 'features'> & {
  readonly org_name: string | null;
  readonly features: readonly string[];
};

export type AllocationPayload = typeof AllocationSchema.Type;

function isSignedBy(signers: Signers, { payload, signature, kid }: Signed): boolean {
  const x = signers.get(kid);
  if (x === undefined) {
    return false;
  }
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
  return verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signature, 'base64url'));
}

function payloadOf<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
): (signed: Signed, signers: Signers) => Option.Option<S['Type']> {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(schema));
  return (signed, signers) =>
    isSignedBy(signers, signed) ? decoded(Buffer.from(signed.payload, 'base64url').toString('utf8')) : Option.none();
}

const isFeatureName = Schema.is(FeatureSchema);

const licensePayloadIn = payloadOf(LicenseSchema);

export function licenseIn(signed: Signed, signers: Signers): Option.Option<License> {
  return Option.map(licensePayloadIn(signed, signers), (license) => ({
    ...license,
    org_name: shownOrgName(license.org_name),
    features: (license.features ?? []).filter((name) => isFeatureName(name)),
  }));
}

export const allocationIn = payloadOf(AllocationSchema);
