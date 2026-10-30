import { problem as problemAtPointer, withoutTrailingSlashes, type SettingProblem } from '@on.auto/config';
import { Config, ConfigProvider, Option, type Redacted } from 'effect';

export type { SettingProblem } from '@on.auto/config';

export type Environment = Readonly<Record<string, string | undefined>>;

interface Unconfigured {
  readonly configured: false;
  readonly missing: readonly string[];
  readonly partial?: true;
}

interface Configured<S> {
  readonly configured: true;
  readonly settings: S;
}

export type Availability<S> = Configured<S> | Unconfigured;

export interface Reading<S> {
  readonly problems: readonly SettingProblem[];
  readonly availability: Availability<S>;
}

export function settingsFrom(environment: Environment): ConfigProvider.ConfigProvider {
  return ConfigProvider.fromEnvRecord(environment);
}

export function optionalText(name: string): Config.Config<string | undefined> {
  return Config.option(Config.String(name)).pipe(Config.map(Option.getOrUndefined));
}

export function optionalSecret(name: string): Config.Config<Redacted.Redacted | undefined> {
  return Config.option(Config.Redacted(name)).pipe(Config.map(Option.getOrUndefined));
}

export function configured<S>(settings: S): Availability<S> {
  return { configured: true, settings };
}

export function unconfigured<S>(missing: readonly string[], partial: boolean): Availability<S> {
  return partial ? { configured: false, missing, partial } : { configured: false, missing };
}

export function anySet(...values: readonly unknown[]): boolean {
  return values.some((value) => value !== undefined);
}

export function problem(setting: string, detail: string): readonly SettingProblem[] {
  return [{ setting, detail }];
}

export function problemAt(setting: string, pointer: string, detail: string): readonly SettingProblem[] {
  return [problemAtPointer(setting, pointer, detail)];
}

function isWebUrl(url: string): boolean {
  return URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol);
}

export function baseUrlOf(url: string | undefined): string | null {
  return url === undefined ? null : withoutTrailingSlashes(url);
}

export function urlProblems(setting: string, url: string | undefined): readonly SettingProblem[] {
  return url === undefined || isWebUrl(url) ? [] : problem(setting, 'Expected an http or https URL');
}

const dnsLabel = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;

export function labelProblems(setting: string, label: string | undefined): readonly SettingProblem[] {
  return label === undefined || dnsLabel.test(label)
    ? []
    : problem(setting, 'Expected letters, digits and hyphens only');
}

export function bothProblems(first: string, second: string, present: boolean): readonly SettingProblem[] {
  return present ? problem(second, `Set ${first} or ${second}, not both`) : [];
}
