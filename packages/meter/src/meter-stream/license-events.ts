import { Schema } from 'effect';

import {
  FallbackSchema,
  LicenseCreditsSchema,
  SignedSchema,
  StandingSchema,
  type Fallback,
  type Standing,
} from '../licensing/signed-answers.ts';

const LicenseInvalidBecauseSchema = Schema.Literals([
  'key_rotated',
  'installation_revoked',
  'org_deleted',
  'org_purged',
]);

export const isLicenseInvalidBecause = Schema.is(LicenseInvalidBecauseSchema);

type LicenseInvalidBecause = typeof LicenseInvalidBecauseSchema.Type;

const signedFields = {
  installation: Schema.String,
  org: Schema.String,
  org_name: Schema.optionalKey(Schema.String),
  plan: Schema.String,
  policy: Schema.String,
  issued_at: Schema.String,
  warn_at: Schema.String,
  limit_at: Schema.String,
  charged_through: Schema.Int,
  admits_through: Schema.Finite,
  standing: StandingSchema,
  credits: LicenseCreditsSchema,
  fallback: FallbackSchema,
};

const keptFields = {
  licensed_reported: Schema.Int,
  key_sha256: Schema.String,
  license: SignedSchema,
};

export const LicenseRecordWithoutFeaturesSchema = Schema.Struct({ ...signedFields, ...keptFields });

export const LicenseRecordSchema = Schema.Struct({
  ...signedFields,
  features: Schema.Array(Schema.String),
  ...keptFields,
});

export type LicenseRecord = typeof LicenseRecordSchema.Type;

export function withNoFeatures<Fact extends { readonly data: typeof LicenseRecordWithoutFeaturesSchema.Type }>({
  data,
  ...fact
}: Fact): Omit<Fact, 'data'> & { readonly data: LicenseRecord } {
  return { ...fact, data: { ...data, features: [] } };
}

export const InvalidatedSchema = Schema.Struct({
  key_sha256: Schema.String,
  detail: Schema.String,
  because: Schema.optionalKey(LicenseInvalidBecauseSchema),
});

export interface Invalidity {
  readonly detail: string;
  readonly because?: LicenseInvalidBecause;
}

export interface KeyRefused extends Invalidity {
  readonly key_sha256: string;
}

export interface HeldLicense {
  readonly installation: string;
  readonly org: string;
  readonly org_name: string | null;
  readonly plan: string;
  readonly policy: string;
  readonly issued_at: string;
  readonly warn_at: string;
  readonly limit_at: string;
  readonly charged_through: number;
  readonly admits_through: number;
  readonly standing: Standing;
  readonly credits: { readonly available: number; readonly owed: number; readonly overage_cap: number };
  readonly fallback: Fallback;
  readonly features: readonly string[];
  readonly licensed_reported: number;
  readonly key_sha256: string;
  readonly taken_at: string;
}

export function heldLicenseOf(record: LicenseRecord, takenAt: string): HeldLicense {
  const { license: _signed, org_name: orgName, ...fields } = record;
  return { ...fields, org_name: orgName ?? null, taken_at: takenAt };
}

export function keyRefusedOf({ key_sha256: sha256, detail, because }: typeof InvalidatedSchema.Type): KeyRefused {
  return because === undefined ? { key_sha256: sha256, detail } : { key_sha256: sha256, detail, because };
}
