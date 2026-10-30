import { runDevelopment } from './src/development/development.ts';
import { localDevelopment } from './src/development/local-development.ts';

process.exitCode = await runDevelopment(process, localDevelopment());
