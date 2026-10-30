const mebibyte = 1_048_576;

export const documentBounds = {
  bytes: 20 * mebibyte,
  pdfPages: 500,
} as const;

export const documentTooLarge = `It takes more than the ${documentBounds.bytes / mebibyte} MiB the runtime reads of a document`;

export function tooManyPages(pages: number): string {
  return `It has ${pages} pages, more than the ${documentBounds.pdfPages} the runtime reads of a PDF`;
}
