import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

function visibleDependencies(packageRoot: string): ReadonlyMap<string, string> {
  const farthestFirst = modulesFolders(packageRoot).toReversed();
  return new Map(
    farthestFirst.flatMap((folder) =>
      packagesIn(folder)
        .filter((name) => !name.startsWith('@on.auto/'))
        .map((name): [string, string] => [name, join(folder, name)]),
    ),
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

export function linked(release: string, links: ReadonlyMap<string, string>): void {
  for (const [name, target] of links) {
    const link = join(release, 'node_modules', name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
  }
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
    linked(release, visibleDependencies(packageRoot));
    linked(release, workspacePackages(release));
    writeFileSync(join(release, installedMarker), '');
  }
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
