import { createPublicKey, verify } from 'node:crypto';

import { Option, Schema } from 'effect';

export const SignedSchema = Schema.Struct({ payload: Schema.String, signature: Schema.String, kid: Schema.String });

export type Signed = typeof SignedSchema.Type;

export type Signers = ReadonlyMap<string, string>;

export const autoSigners: Signers = new Map([['auto-2026-10', 'fHkCk7CbSg4IZQQXqQj_SVl86CvA_O8eT7xo12JkVaY']]);

const EntitlementSchema = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal('entitlement'),
  installation: Schema.String,
  org: Schema.String,
  plan: Schema.String,
  issued_at: Schema.String,
  expires_at: Schema.String,
});

const AdmissionSchema = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal('admission'),
  installation: Schema.String,
  action: Schema.String,
  admitted_at: Schema.String,
});

const RepairSchema = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal('repair'),
  installation: Schema.String,
  id: Schema.String,
  reason: Schema.String,
  issued_at: Schema.String,
});

export type Entitlement = typeof EntitlementSchema.Type;

export type Repair = typeof RepairSchema.Type;

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

export const entitlementIn = payloadOf(EntitlementSchema);

export const admissionIn = payloadOf(AdmissionSchema);

export const repairIn = payloadOf(RepairSchema);
