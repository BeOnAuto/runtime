import { createHash } from 'node:crypto';

const LICENSE_KEY = /^alk\.[^.\s]+\.([^.\s]+)\.[^.\s]+$/u;

export function installationOfKey(key: string): string | undefined {
  return LICENSE_KEY.exec(key)?.[1];
}

export function isLicenseKey(key: string): boolean {
  return installationOfKey(key) !== undefined;
}

export function keyDigestOf(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
