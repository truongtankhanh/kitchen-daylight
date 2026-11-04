// Failing fixture for scripts/check.mjs: `en` lacks one message and one empty namespace of `vi`.
// `expect` lists exactly what the check must report.
export const DEFAULT_LOCALE = 'vi';

export const catalogues = {
  vi: {
    common: { appName: 'KD', tagline: 'placeholder' },
    errors: {},
  },
  en: {
    common: { appName: 'KD' },
  },
};

export const expect = ['en: common.tagline', 'en: errors'];
