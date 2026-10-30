import { documentBounds, tooManyPages } from '../reading/document-bounds.ts';
import { notRead, refusedUnlessOutOfMemory, textRead, viewOf, type DocumentRead } from '../reading/document-text.ts';

const holdsNoText = 'It holds no text, as a PDF of scanned pages holds none: the runtime reads no text in an image';

function inTurn<A>(count: number, step: (index: number) => Promise<A>): Promise<readonly A[]> {
  return Array.from({ length: count }, (_, index) => index).reduce<Promise<readonly A[]>>(
    async (done, index) => [...(await done), await step(index)],
    Promise.resolve([]),
  );
}

export async function pdfTextOf(bytes: Readonly<Uint8Array>): Promise<DocumentRead> {
  const { getResolvedPDFJS } = await import('unpdf');
  const { getDocument } = await getResolvedPDFJS();
  const loading = getDocument({
    data: viewOf(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: 0,
  });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > documentBounds.pdfPages) {
      return notRead(tooManyPages(pdf.numPages));
    }
    const pages = await inTurn(pdf.numPages, async (index) => {
      const page = await pdf.getPage(index + 1);
      const { items } = await page.getTextContent();
      page.cleanup();
      let text = '';
      for (const item of items) {
        const { str, hasEOL } = { str: '', hasEOL: false, ...item };
        text += hasEOL ? `${str}\n` : str;
      }
      return text.trim();
    });
    const text = pages.filter((page) => page !== '').join('\n\n');
    return text === '' ? notRead(holdsNoText) : textRead(text);
  } catch (error) {
    return refusedUnlessOutOfMemory(error, 'It is not a PDF the runtime can read');
  } finally {
    await loading.destroy();
  }
}
