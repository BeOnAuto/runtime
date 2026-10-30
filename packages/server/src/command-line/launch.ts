import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Execve = (file: string, args?: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => never;

export interface LaunchingProcess {
  readonly versions: { readonly node: string };
  readonly argv: readonly string[];
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly execPath: string;
  readonly execve?: Execve | undefined;
  readonly stderr: { write(text: string): unknown };
}

interface Ready {
  readonly execve: Execve;
  readonly cacheRoot: string;
}

const requiredNode = '26.10.0';

const installedMarker = '.installed';

const workspaceGroups: readonly string[] = ['packages', 'capabilities'];

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function isAtLeast(version: string, required: string): boolean {
  return version.localeCompare(required, 'en', { numeric: true }) >= 0;
}

function cacheRootOf(env: Readonly<NodeJS.ProcessEnv>): string | undefined {
  const cacheHome = env['XDG_CACHE_HOME'];
  const home = env['HOME'];
  if (isSet(cacheHome)) {
    return cacheHome;
  }
  return isSet(home) ? join(home, '.cache') : undefined;
}

function readinessOf({ versions, execve, env }: Readonly<LaunchingProcess>): Ready | string {
  const cacheRoot = cacheRootOf(env);
  if (!isAtLeast(versions.node, requiredNode)) {
    return `Auto Runtime needs Node.js ${requiredNode} or later, and this is Node.js ${versions.node}.`;
  }
  if (execve === undefined) {
    return 'Auto Runtime runs on macOS and Linux. On Windows, run the docker.on.auto/onauto/runtime image with Docker.';
  }
  if (cacheRoot === undefined) {
    return 'Auto Runtime keeps its files under XDG_CACHE_HOME or HOME, and neither is set.';
  }
  return { execve, cacheRoot };
}

function modulesFolders(directory: string): readonly string[] {
  const parent = dirname(directory);
  const own = basename(directory) === 'node_modules' ? [] : [join(directory, 'node_modules')];
  return parent === directory ? own : [...own, ...modulesFolders(parent)];
}

function packagesIn(folder: string): readonly string[] {
  const names = existsSync(folder) ? readdirSync(folder).filter((name) => !name.startsWith('.')) : [];
  return names.flatMap((name) =>
    name.startsWith('@') ? readdirSync(join(folder, name)).map((inner) => `${name}/${inner}`) : [name],
  );
}

function workspacePackages(release: string): ReadonlyMap<string, string> {
  return new Map(
    workspaceGroups.flatMap((group) =>
      readdirSync(join(release, group)).map((name): [string, string] => [
        `@on.auto/${name}`,
        join(release, group, name),
      ]),
    ),
  );
}

function jsonIn(file: string): object {
  return new Object(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined);
}

function manifestIn(directory: string): object {
  return jsonIn(join(directory, 'package.json'));
}

function runtimeNameOf(packageRoot: string): string {
  return String(Reflect.get(manifestIn(packageRoot), 'name'));
}

function packagesOfTheRelease(packageRoot: string): ReadonlySet<string> {
  return new Set([...workspacePackages(packageRoot).keys(), runtimeNameOf(packageRoot)]);
}

function visibleDependencies(packageRoot: string): ReadonlyMap<string, string> {
  const farthestFirst = modulesFolders(packageRoot).toReversed();
  const ofTheRelease = packagesOfTheRelease(packageRoot);
  return new Map(
    farthestFirst.flatMap((folder) =>
      packagesIn(folder)
        .filter((name) => !ofTheRelease.has(name))
        .map((name): [string, string] => [name, join(folder, name)]),
    ),
  );
}

function pointsTo(link: string, target: string): boolean {
  return lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true && readlinkSync(link) === target;
}

export function linked(release: string, links: ReadonlyMap<string, string>): void {
  for (const [name, target] of links) {
    const link = join(release, 'node_modules', name);
    if (!pointsTo(link, target)) {
      mkdirSync(dirname(link), { recursive: true });
      const fresh = `${link}.${randomUUID()}`;
      symlinkSync(target, fresh);
      renameSync(fresh, link);
    }
  }
}

function npmIntegrityOf(installed: string, name: string): unknown {
  const modulesFolder = resolve(installed, ...name.split('/').map(() => '..'));
  const packages: unknown = Reflect.get(jsonIn(join(modulesFolder, '.package-lock.json')), 'packages');
  return Reflect.get(new Object(Reflect.get(new Object(packages), `node_modules/${name}`)), 'integrity');
}

function filesDigestOf(installed: string): string {
  const digest = createHash('sha256');
  for (const path of readdirSync(installed, { recursive: true, encoding: 'utf8' }).toSorted()) {
    const file = join(installed, path);
    if (lstatSync(file).isFile()) {
      digest.update(path).update('\0').update(readFileSync(file));
    }
  }
  return digest.digest('hex');
}

function installedAs(installed: string, name: string): string {
  const integrity = npmIntegrityOf(installed, name);
  return typeof integrity === 'string' ? integrity : filesDigestOf(installed);
}

export function movedIntoPlace(copy: string, place: string): void {
  try {
    renameSync(copy, place);
  } catch (refused) {
    rmSync(copy, { recursive: true, force: true });
    if (!existsSync(place)) {
      throw refused;
    }
  }
}

function placedIn(release: string, name: string, installed: string): string {
  const identity = createHash('sha256').update(name).update('\0').update(installedAs(installed, name)).digest('hex');
  const place = join(release, 'extensions', identity.slice(0, 16));
  if (!existsSync(place)) {
    const copy = `${place}.${randomUUID()}`;
    cpSync(installed, join(copy, name), { recursive: true });
    movedIntoPlace(copy, place);
  }
  return join(place, name);
}

function extendsTheRuntime(directory: string, runtime: string): boolean {
  return Object.hasOwn(new Object(Reflect.get(manifestIn(directory), 'peerDependencies')), runtime);
}

function besideTheRelease(release: string, packageRoot: string): void {
  const runtime = runtimeNameOf(packageRoot);
  linked(
    release,
    new Map(
      [...visibleDependencies(packageRoot)].map(([name, installed]: readonly [string, string]): [string, string] => [
        name,
        extendsTheRuntime(installed, runtime) ? placedIn(release, name, installed) : installed,
      ]),
    ),
  );
}

function releaseDirectory(packageRoot: string, cacheRoot: string): string {
  const digest = createHash('sha256')
    .update(packageRoot)
    .update(readFileSync(join(packageRoot, 'package.json')))
    .digest('hex');
  return join(cacheRoot, 'auto-runtime', digest.slice(0, 16));
}

export function installedRelease(packageDirectory: string, cacheRoot: string): string {
  const packageRoot = resolve(packageDirectory);
  const release = releaseDirectory(packageRoot, cacheRoot);
  if (!existsSync(join(release, installedMarker))) {
    rmSync(release, { recursive: true, force: true });
    cpSync(packageRoot, release, {
      recursive: true,
      filter: (source) => source !== join(packageRoot, 'node_modules'),
    });
    linked(release, workspacePackages(release));
    writeFileSync(join(release, installedMarker), '');
  }
  besideTheRelease(release, packageRoot);
  return release;
}

export function launch(host: Readonly<LaunchingProcess>, packageRoot: Readonly<URL>): number {
  const readiness = readinessOf(host);
  if (typeof readiness === 'string') {
    host.stderr.write(`${readiness}\n`);
    return 1;
  }
  const release = installedRelease(fileURLToPath(packageRoot.href), readiness.cacheRoot);
  return readiness.execve(
    host.execPath,
    [host.execPath, join(release, 'packages', 'server', 'auto-runtime.ts'), ...host.argv.slice(2)],
    { ...host.env, RUNTIME_DISTRIBUTION: 'npx' },
  );
}
