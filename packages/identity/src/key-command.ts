import { runKeyCommand } from './key-command/run-key-command.ts';

process.exitCode = runKeyCommand(process.argv.slice(2), {
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
  error: (line) => {
    process.stderr.write(`${line}\n`);
  },
});
