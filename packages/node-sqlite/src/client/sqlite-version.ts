function partsOf(version: string): readonly number[] {
  return version.split('.').map(Number);
}

export function isAtLeast(found: string, minimum: string): boolean {
  const [foundParts, minimumParts] = [partsOf(found), partsOf(minimum)];
  const firstDifference =
    Array.from(
      { length: Math.max(foundParts.length, minimumParts.length) },
      (_, place) => (foundParts[place] ?? 0) - (minimumParts[place] ?? 0),
    ).find((difference) => difference !== 0) ?? 0;
  return firstDifference >= 0;
}

export function sqliteVersionRefusal(found: string, minimum: string): Error {
  return new Error(
    `This Node.js carries SQLite ${found}, and SQLite ${minimum} or later is needed. Use a Node.js that carries SQLite ${minimum} or later.`,
  );
}
