import { base } from './base.js';

/** Expo app. Expo and React rules are chosen and added in P4-T7 (decision 0002). */
export function reactNative(options = {}) {
  return [
    ...base(options),
    {
      name: 'kd/react-native',
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
  ];
}
