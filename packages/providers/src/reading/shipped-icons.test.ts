import { readdirSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { providersShippedRoots, readProviders } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const iconsFolder = new URL('../entries/icons/', import.meta.url);

const notice = 'NOTICE.md';

const iconFiles = readdirSync(iconsFolder).filter((file) => file !== notice);

/** The types of the files the folder holds, by their extension: an SVG of paths alone, or a brand's own PNG. */
const typeByExtension: Readonly<Record<string, string>> = { '.svg': 'image/svg+xml', '.png': 'image/png' };

function dataUriOf(file: string): string {
  return `data:${typeByExtension[extname(file)] ?? ''};base64,${readFileSync(new URL(file, iconsFolder)).toString('base64')}`;
}

const sources = new Set(shipped.providers.flatMap(({ icons = [] }) => icons.map(({ src }) => src)));

describe('the icons of the shipped providers', () => {
  it('are SVG or PNG files of the folder of icons, each read as the type its extension names, declared by an entry and named in the notice of their sources', () => {
    const named = readFileSync(new URL(notice, iconsFolder), 'utf8');

    expect(iconFiles.filter((file) => !Object.hasOwn(typeByExtension, extname(file)))).toEqual([]);
    expect(iconFiles.filter((file) => !sources.has(dataUriOf(file)))).toEqual([]);
    expect(iconFiles.filter((file) => !named.includes(`\`${file}\``))).toEqual([]);
  });

  it('give each provider that has any one icon for both backgrounds, or one for a light background and one for a dark', () => {
    const themes = shipped.providers
      .map(({ icons = [] }) => icons.map(({ theme = 'both' }) => theme).join(' '))
      .filter((said) => said !== '');

    expect(themes.filter((said) => !['both', 'light dark'].includes(said))).toEqual([]);
  });

  it('are missing only for the providers whose brand gives its mark only after an agreement, a sign-in or a request', () => {
    expect(shipped.providers.filter(({ icons = [] }) => icons.length === 0).map(({ entry }) => entry.name)).toEqual([
      'adobe-analytics',
      'amazon-ads',
      'amazon-ads-mcp',
      'microsoft-advertising',
      'slack-bot',
    ]);
  });
});
