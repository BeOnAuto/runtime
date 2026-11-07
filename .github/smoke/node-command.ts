import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [app, instance, data, port, ...settings] = process.argv.slice(2);
if (app === undefined || instance === undefined || data === undefined || port === undefined)
  throw new Error('A staged app, instance, data directory and port are required');
const image: unknown = JSON.parse(readFileSync(join(app, 'smoke-image.json'), 'utf8'));
if (!isImage(image)) throw new Error('The staged image manifest is invalid');
mkdirSync(instance, { recursive: true });
mkdirSync(data, { recursive: true });
// Only the staged production tree is visible from this instance. Each process
// has its own /app equivalent and a data link, as the image does with /data.
for (const entry of readdirSync(app)) {
  const target = join(instance, entry);
  if (!existsSync(target)) symlinkSync(join(app, entry), target);
}
if (!existsSync(join(instance, 'data'))) symlinkSync(resolve(data), join(instance, 'data'));
const environment: Record<string, string> = { PATH: process.env['PATH'] ?? '', ...image.environment, PORT: port };
let command = image.command;
for (let index = 0; index < settings.length; index++) {
  const setting = settings[index];
  if (setting === undefined) throw new Error('A runtime setting is missing');
  if (setting === '--') {
    command = settings.slice(index + 1);
    break;
  }
  const equals = setting.indexOf('=');
  if (equals < 1) throw new Error(`Expected NAME=value: ${setting}`);
  environment[setting.slice(0, equals)] = setting.slice(equals + 1);
}
if (command[0] !== 'node') throw new Error('The staged smoke only starts Node commands');
process.chdir(instance);
// exec preserves the PID: the shell owns and waits for the actual runtime.
if (process.execve === undefined) throw new Error('Node smokes require an operating system with execve');
process.execve(process.execPath, [process.execPath, ...command.slice(1)], environment);

function isImage(
  value: unknown,
): value is { environment: Readonly<Record<string, string>>; command: readonly string[] } {
  if (typeof value !== 'object' || value === null) return false;
  const imageEnvironment: unknown = Reflect.get(value, 'environment');
  const imageCommand: unknown = Reflect.get(value, 'command');
  return (
    typeof imageEnvironment === 'object' &&
    imageEnvironment !== null &&
    Object.values(imageEnvironment).every((item: unknown) => typeof item === 'string') &&
    Array.isArray(imageCommand) &&
    imageCommand.every((item: unknown) => typeof item === 'string')
  );
}
