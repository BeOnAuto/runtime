const insufficientScope = 'insufficient_scope';

interface ScopeAnswer {
  readonly status: number;
  readonly body: unknown;
  readonly error?: string | undefined;
  readonly scope?: string | undefined;
}

export function scopeLackingWords(scope: string | undefined): string {
  const lacking = scope === undefined ? 'a scope' : `the scope ${scope}`;
  return `The tool server answered HTTP 403: the credential lacks ${lacking} this request needs; a credential granted that scope would allow it`;
}

function namesInsufficientScope({ body, error }: ScopeAnswer): boolean {
  return error === insufficientScope || (typeof body === 'string' && body.includes(insufficientScope));
}

export function scopeLackingIn(answer: ScopeAnswer): string | undefined {
  return answer.status === 403 && namesInsufficientScope(answer) ? scopeLackingWords(answer.scope) : undefined;
}

export class ScopeLacking extends Error {}
