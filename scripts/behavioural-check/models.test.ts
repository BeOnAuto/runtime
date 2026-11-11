import assert from 'node:assert/strict';
import { test } from 'node:test';

import { askingThroughItsCommand, versionOf, type Model } from './models.ts';

function nodeRunning(script: string, prompt: Model['prompt']): Model {
  return {
    name: 'echo',
    command: [process.execPath, '-e', script],
    prompt,
    version: [process.execPath, '-e', 'process.stdout.write("echo 1.2.3\\nbuilt today\\n")'],
  };
}

const echoingStdin = 'process.stdin.pipe(process.stdout)';

const echoingTheLastArgument = 'process.stdout.write(process.argv.at(-1))';

await test('a model that reads its prompt on standard input is given it there, in an empty folder of its own', async () => {
  const answer = await askingThroughItsCommand()(nodeRunning(echoingStdin, 'stdin'), 'Which definitions?');

  assert.equal(answer.exit, 0);
  assert.equal(answer.stdout, 'Which definitions?');
  assert.equal(typeof answer.seconds, 'number');
});

await test('a model that takes its prompt as an argument is given it last', async () => {
  const answer = await askingThroughItsCommand()(nodeRunning(echoingTheLastArgument, 'argument'), 'Which types?');

  assert.equal(answer.stdout, 'Which types?');
});

await test('a command that fails keeps its exit code and the end of what it wrote to standard error', async () => {
  const failing = nodeRunning('process.stderr.write("x".repeat(5000) + "signed out"); process.exit(3)', 'stdin');
  const answer = await askingThroughItsCommand()(failing, 'Hello');

  assert.equal(answer.exit, 3);
  assert.equal(answer.stderr.length, 4000);
  assert.ok(answer.stderr.endsWith('signed out'));
});

await test('a command that takes longer than an answer may is stopped, and its answer says so', async () => {
  const answer = await askingThroughItsCommand(200)(nodeRunning('setTimeout(() => {}, 60_000)', 'stdin'), 'Wait');

  assert.equal(answer.exit, 'timeout');
});

await test('a command stopped by a signal, and one that cannot start, are told apart from an answer', async () => {
  const stopped = await askingThroughItsCommand()(nodeRunning('process.kill(process.pid, "SIGKILL")', 'stdin'), '');
  const missing = await askingThroughItsCommand()(
    { ...nodeRunning('', 'stdin'), command: ['no-such-command-here'] },
    '',
  );

  assert.equal(stopped.exit, 'stopped');
  assert.equal(missing.exit, 'not started');
  assert.match(missing.stderr, /ENOENT/u);
});

await test('the version of a model is the first line its version command prints', () => {
  assert.equal(versionOf(nodeRunning('', 'stdin')), 'echo 1.2.3');
});
