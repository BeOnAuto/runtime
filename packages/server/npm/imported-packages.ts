const statements: readonly RegExp[] = [
  /^(?:import|export)\b[^;'"`]*?\bfrom\s*'([^']*)'/gmu,
  /^import\s*'([^']*)'/gmu,
  /\bimport\(\s*'([^']*)'/gu,
  /\bimport\.meta\.resolve\(\s*'([^']*)'/gu,
];

function isBare(specifier: string): boolean {
  return specifier !== '' && !specifier.startsWith('.') && !specifier.startsWith('/');
}

export function bareSpecifiersIn(source: string): readonly string[] {
  return statements
    .flatMap((statement: Readonly<RegExp>) =>
      [...source.matchAll(statement)].map((found: readonly string[]) => found[1] ?? ''),
    )
    .filter((specifier) => isBare(specifier));
}
