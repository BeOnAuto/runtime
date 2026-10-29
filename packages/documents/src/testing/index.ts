import type { DocumentReading } from '../process/pooled-documents.ts';
import { textWithin } from '../reading/text-within.ts';

export {
  pdfOfNestedDrawings,
  pdfOfPages,
  wordDocumentOf,
  wordDocumentRepeating,
  type NestedDrawings,
} from './written-documents.ts';

export const documentsReadInProcess: DocumentReading = (given, { textBytes }) => textWithin(given, textBytes);
