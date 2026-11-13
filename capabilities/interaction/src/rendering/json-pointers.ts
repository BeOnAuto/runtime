export function pointerTo(base: string, segment: string | number | symbol): string {
  const escaped = String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
  return `${base}/${escaped}`;
}
