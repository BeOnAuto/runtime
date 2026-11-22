export interface StandardClaims {
  readonly name?: string;
  readonly email?: string;
  readonly email_verified?: true;
}

type TextClaim = 'name' | 'email';

function claimIn(claims: unknown, name: keyof StandardClaims): unknown {
  return Reflect.get(new Object(claims), name);
}

export function textClaim(claims: unknown, name: TextClaim): StandardClaims {
  const value = claimIn(claims, name);
  return typeof value === 'string' ? { [name]: value } : {};
}

export function carriesTheVerification(claims: unknown): boolean {
  return Object.hasOwn(new Object(claims), 'email_verified');
}

export function verifiedClaim(claims: unknown): Pick<StandardClaims, 'email_verified'> {
  return claimIn(claims, 'email_verified') === true ? { email_verified: true } : {};
}

export function standardClaimsIn(claims: unknown): StandardClaims {
  return { ...textClaim(claims, 'name'), ...textClaim(claims, 'email'), ...verifiedClaim(claims) };
}
