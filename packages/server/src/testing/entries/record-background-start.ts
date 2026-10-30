import { writeFileSync } from 'node:fs';

process.stdout.write('started in the background\n');
writeFileSync('started.json', JSON.stringify({ arguments: process.argv.slice(2), directory: process.cwd() }));
