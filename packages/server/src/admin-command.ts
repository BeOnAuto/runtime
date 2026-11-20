import { adminHelp, whereTheAdminCommandsRun } from './admin-command/admin-words.ts';
import { runAdminCommand } from './admin-command/run-admin-command.ts';

process.exitCode = await runAdminCommand(process.argv.slice(2), {
  environment: process.env,
  console: {
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
    error: (line) => {
      process.stderr.write(`${line}\n`);
    },
  },
  usage: [...adminHelp, whereTheAdminCommandsRun].join('\n'),
});
