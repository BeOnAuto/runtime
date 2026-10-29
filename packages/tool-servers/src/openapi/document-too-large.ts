import { documentBounds } from '@on.auto/documents';

export class DocumentTooLarge extends Error {
  constructor() {
    super(
      `The tool server answered a file of more than the ${documentBounds.bytes / 1_048_576} MiB the runtime reads of a document, so none of it was read`,
    );
  }
}
