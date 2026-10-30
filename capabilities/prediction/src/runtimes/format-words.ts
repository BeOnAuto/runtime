export function listedFormats(formats: readonly string[]): string {
  const head = formats.slice(0, -1);
  const last = formats.at(-1) ?? '';
  return head.length === 0 ? last : `${head.join(', ')} or ${last}`;
}

export function candidateFilesOf(formats: readonly string[]): string {
  if (formats.length === 0) {
    return 'nothing: no model runtime this server has installed executes a candidate for this function';
  }
  return formats.length === 1
    ? `a file in the format ${listedFormats(formats)}`
    : `a file in one of the formats ${listedFormats(formats)}, naming its format with ?format=`;
}
