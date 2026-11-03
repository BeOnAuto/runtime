import type { SettingsOf } from '../testing/host-files.ts';
import { carriedPagesSuite } from './carried-pages-suite.ts';
import { foldingSuite } from './folding-suite.ts';
import { pageViewsSuite } from './page-views-suite.ts';
import { replaySuite } from './replay-suite.ts';
import { rowsSuite } from './rows-suite.ts';
import { sharingSuite } from './sharing-suite.ts';
import { stallSuite } from './stall-suite.ts';
import { versionsSuite } from './versions-suite.ts';

export function viewsSuites(settingsOf: SettingsOf): void {
  foldingSuite(settingsOf);
  stallSuite(settingsOf);
  versionsSuite(settingsOf);
  sharingSuite(settingsOf);
  rowsSuite(settingsOf);
  pageViewsSuite(settingsOf);
  carriedPagesSuite(settingsOf);
  replaySuite(settingsOf);
}
