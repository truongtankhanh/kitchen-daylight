// ESLint layer of @kd/mobile: React Native preset plus its boundary row (decision 0003).
import { reactNative } from '@kd/eslint-config';

export default [
  { name: 'kd/mobile/ignores', ignores: ['.expo/', 'dist/', 'coverage/', 'ios/', 'android/'] },
  ...reactNative({ importer: 'mobile' }),
];
