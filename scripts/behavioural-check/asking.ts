import { readFileSync } from 'node:fs';

import { planIn, toolsAskedIn } from './grading.ts';
import type { Ask, Model } from './models.ts';
import { promptOf, type Brief } from './prompts.ts';
import { answerPaths, askedOnce, modelRunPath, promptPath, written, type Run } from './run-folder.ts';

export interface Asking {
  readonly ask: Ask;
  readonly versionOf: (model: Model) => string;
  readonly briefOf: (id: string) => Brief;
  readonly print: (line: string) => void;
}

interface RunFolder {
  readonly folder: string;
  readonly run: Run;
}

async function askedAbout(asking: Asking, { folder, run }: RunFolder, model: Model, id: string): Promise<void> {
  const [first, loaded] = answerPaths(folder, model.name, id);
  const prompt = readFileSync(promptPath(folder, id), 'utf8');
  const answer = await askedOnce(first, () => asking.ask(model, prompt));
  const asked = toolsAskedIn(answer.stdout);
  if (run.profile === 'names' && asked.length > 0 && planIn(answer.stdout) === undefined) {
    const person = { serverName: run.server_name, starter: run.starter };
    const again = promptOf(run.shown, { profile: run.profile, loaded: asked }, asking.briefOf(id), person);
    await askedOnce(loaded, () => asking.ask(model, again));
  }
  asking.print(`${model.name} ${id}: answered`);
}

function askedInTurn(asking: Asking, runFolder: RunFolder, model: Model): Promise<void> {
  written(modelRunPath(runFolder.folder, model.name), { command: model.command, version: asking.versionOf(model) });
  return runFolder.run.briefs.reduce(async (before: Promise<void>, id) => {
    await before;
    await askedAbout(asking, runFolder, model, id);
  }, Promise.resolve());
}

export async function askedEachModel(asking: Asking, runFolder: RunFolder, models: readonly Model[]): Promise<void> {
  await Promise.all(models.map((model) => askedInTurn(asking, runFolder, model)));
}
