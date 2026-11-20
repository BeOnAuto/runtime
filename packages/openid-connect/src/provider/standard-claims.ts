export interface StandardClaims {
  readonly name?: string;
  readonly email?: string;
}

export function textClaim(claims: unknown, name: keyof StandardClaims): StandardClaims {
  const value: unknown = Reflect.get(new Object(claims), name);
  return typeof value === 'string' ? { [name]: value } : {};
}

export function standardClaimsIn(claims: unknown): StandardClaims {
  return { ...textClaim(claims, 'name'), ...textClaim(claims, 'email') };
}
