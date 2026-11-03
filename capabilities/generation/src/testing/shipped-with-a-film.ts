import { shippedFileIn, type ShippedFile, type ShippedFiles } from '@on.auto/shipped-files';

import { fileNameOf } from '../catalog/catalog-entry.ts';
import { shippedCatalog } from '../catalog/catalog-reading.ts';
import { shortFilm } from './test-catalog.ts';

const filmFileName = fileNameOf(shortFilm.model);

const filmFile = shippedFileIn(shippedCatalog, filmFileName);

function isTheSame(file: ShippedFile, other: ShippedFile): boolean {
  return file.package === other.package && file.path === other.path;
}

export function shippedWithAFilm(files: ShippedFiles): ShippedFiles {
  return {
    text: (file) => (isTheSame(file, filmFile) ? Promise.resolve(JSON.stringify(shortFilm)) : files.text(file)),
    bytes: files.bytes,
    list: async (folder) =>
      isTheSame(folder, shippedCatalog) ? [...(await files.list(folder)), filmFileName] : files.list(folder),
  };
}
