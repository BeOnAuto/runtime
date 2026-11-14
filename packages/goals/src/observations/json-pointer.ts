export type Resolved = { readonly found: true; readonly value: unknown } | { readonly found: false };

const nothing: Resolved = { found: false };

const anIndex = /^(?:0|[1-9]\d*)$/u;

function tokensOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function stepped(resolved: Resolved, token: string): Resolved {
  if (!resolved.found) {
    return nothing;
  }
  const { value } = resolved;
  if (Array.isArray(value)) {
    return anIndex.test(token) && Number(token) < value.length ? { found: true, value: value[Number(token)] } : nothing;
  }
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, token)) {
    return { found: true, value: Reflect.get(value, token) };
  }
  return nothing;
}

export function resolvedAt(document: unknown, pointer: string): Resolved {
  if (pointer !== '' && !pointer.startsWith('/')) {
    return nothing;
  }
  const whole: Resolved = { found: true, value: document };
  return tokensOf(pointer).reduce<Resolved>((resolved, token) => stepped(resolved, token), whole);
}
