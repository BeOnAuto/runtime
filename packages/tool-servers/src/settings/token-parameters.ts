const setInEveryTokenRequest: ReadonlySet<string> = new Set([
  'client_id',
  'client_secret',
  'client_assertion',
  'client_assertion_type',
  'scope',
  'resource',
  'audience',
]);

export function parametersTheRuntimeSets(parameters: Readonly<Record<string, string>>): readonly string[] {
  return Object.keys(parameters).filter((name) => setInEveryTokenRequest.has(name));
}

export function setInEveryTokenRequestWords(name: string): string {
  return `Expected no ${name}, which the runtime sets in a token request itself`;
}
