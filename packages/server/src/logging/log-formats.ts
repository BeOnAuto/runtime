import { Layer, Logger, References } from 'effect';

import { colorDepthOf, painterFor, type ColorDepth, type Style } from './terminal.ts';

export type LogFormat = 'json' | 'pretty' | 'console';

export type LogLevelSetting = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  readonly message: unknown;
  readonly level: string;
  readonly timestamp: string;
  readonly cause: string | undefined;
  readonly annotations: Readonly<Record<string, unknown>>;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function clockOf(timestamp: string): string {
  const date = new Date(timestamp);
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => twoDigits(part)).join(':');
  return `${time}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function valueText(value: unknown): string {
  return typeof value === 'string' && /^\S+$/u.test(value) ? value : JSON.stringify(value);
}

function prettyLine({ message, level, timestamp, cause, annotations }: LogEntry): string {
  const { source, ...details } = annotations;
  const line = [
    clockOf(timestamp),
    level.padEnd(5),
    ...(source === undefined ? [] : [`[${valueText(source)}]`]),
    typeof message === 'string' ? message : JSON.stringify(message),
    ...Object.entries(details).map(([name, value]: readonly [string, unknown]) => `${name}=${valueText(value)}`),
  ].join(' ');
  return cause === undefined ? line : `${line}\n${cause.replaceAll(/^/gmu, '    ')}`;
}

export const formatPretty = Logger.map(Logger.formatStructured, prettyLine);

const consoleMarks: Readonly<Record<string, readonly [Style, string]>> = {
  INFO: ['cyan', '•'],
  WARN: ['yellow', '▲'],
  ERROR: ['red', '✖'],
  FATAL: ['red', '✖'],
};

const quietMark: readonly [Style, string] = ['gray', '·'];

function consoleLine(depth: ColorDepth): (entry: LogEntry) => string {
  const paint = painterFor(depth);
  return ({ message, level, timestamp, cause }) => {
    const [style, mark] = consoleMarks[level] ?? quietMark;
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    const line = `  ${paint('dim', clockOf(timestamp).slice(0, 8))} ${paint(style, mark)} ${text}`;
    return cause === undefined ? line : `${line}\n${paint('dim', cause.replaceAll(/^/gmu, '      '))}`;
  };
}

export function formatConsole(depth: ColorDepth): Logger.Logger<unknown, string> {
  return Logger.map(Logger.formatStructured, consoleLine(depth));
}

const loggers: Readonly<Record<LogFormat, () => Logger.Logger<unknown, unknown>>> = {
  json: () => Logger.formatJson,
  pretty: () => formatPretty,
  console: () => formatConsole(colorDepthOf(process.stderr)),
};

export function logsToStderr(format: LogFormat): Layer.Layer<never> {
  return Logger.layer([Logger.withConsoleError(loggers[format]())]);
}

const minimumLevels: Readonly<Record<LogLevelSetting, 'Debug' | 'Info' | 'Warn' | 'Error'>> = {
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
};

export function logsFrom(level: LogLevelSetting): Layer.Layer<never> {
  return Layer.succeed(References.MinimumLogLevel, minimumLevels[level]);
}
