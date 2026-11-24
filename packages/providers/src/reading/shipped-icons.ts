import { shippedFileIn, type ShippedFile, type ShippedFiles } from '@on.auto/shipped-files';
import { Result } from 'effect';

import { iconTypeOf, listedIconOf, mostIconBytes, type EntryIcon, type ListedIcon } from '../entry/entry-icons.ts';

interface Problem {
  readonly pointer: string;
  readonly detail: string;
}

interface Folder {
  readonly shippedFiles: ShippedFiles;
  readonly folder: ShippedFile;
}

const anIcon = `a PNG, JPEG, WebP or paths-only SVG image of at most ${String(mostIconBytes)} bytes`;

async function iconBesideTheEntries(
  { shippedFiles, folder }: Folder,
  icon: EntryIcon,
  index: number,
): Promise<Result.Result<ListedIcon, Problem>> {
  const bytes = await shippedFiles.bytes(shippedFileIn(folder, icon.src)).catch(() => new Uint8Array());
  const type = iconTypeOf(bytes);
  if (type === undefined) {
    return Result.fail({
      pointer: `/icons/${String(index)}/src`,
      detail: `Expected ${icon.src} beside the entries: ${anIcon}`,
    });
  }
  return icon.mimeType === undefined || icon.mimeType === type
    ? Result.succeed(listedIconOf(icon, type, bytes))
    : Result.fail({
        pointer: `/icons/${String(index)}/mimeType`,
        detail: `Expected ${type}, the type of ${icon.src}`,
      });
}

export async function iconsBesideTheEntries(
  entries: Folder,
  declared: readonly EntryIcon[] | undefined,
): Promise<Result.Result<readonly ListedIcon[], readonly Problem[]>> {
  const read = await Promise.all((declared ?? []).map((icon, index) => iconBesideTheEntries(entries, icon, index)));
  const icons: ListedIcon[] = [];
  const problems: Problem[] = [];
  for (const each of read) {
    Result.match(each, { onSuccess: (icon) => icons.push(icon), onFailure: (problem) => problems.push(problem) });
  }
  return problems.length > 0 ? Result.fail(problems) : Result.succeed(icons);
}
