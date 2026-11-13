import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { renderGuidePageOf, renderGuidePagePathOf, renderTargetNames } from '@on.auto/interaction';

interface RenderGuidePage {
  readonly path: string;
  readonly text: string;
}

export const renderGuidePages: readonly RenderGuidePage[] = renderTargetNames.map((name) => ({
  path: renderGuidePagePathOf(name),
  text: renderGuidePageOf(name),
}));

function staleIn(docs: string): readonly RenderGuidePage[] {
  return renderGuidePages.filter(
    ({ path, text }) => !existsSync(resolve(docs, path)) || readFileSync(resolve(docs, path), 'utf8') !== text,
  );
}

export function writeRenderGuides(docs: string): 'updated' | 'unchanged' {
  const stale = staleIn(docs);
  for (const { path, text } of stale) {
    mkdirSync(dirname(resolve(docs, path)), { recursive: true });
    writeFileSync(resolve(docs, path), text);
  }
  return stale.length === 0 ? 'unchanged' : 'updated';
}

export function checkRenderGuides(docs: string): void {
  const stale = staleIn(docs);
  if (stale.length > 0) {
    const paths = stale.map(({ path }) => path).join(', ');
    throw new Error(`The card guide pages are missing or stale: ${paths}. Run pnpm docs:render-guides.`);
  }
}

export function runRenderGuides(commandArguments: readonly string[], docs: string): void {
  if (commandArguments.length === 0) {
    writeRenderGuides(docs);
  } else if (commandArguments.length === 1 && commandArguments[0] === '--check') {
    checkRenderGuides(docs);
  } else {
    throw new Error('Usage: pnpm docs:render-guides [--check]');
  }
}

if (import.meta.main) {
  runRenderGuides(process.argv.slice(2), resolve(import.meta.dirname, '../docs'));
}
