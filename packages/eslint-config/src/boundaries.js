// Dependency matrix of decision 0003, section 6, as `no-restricted-imports` patterns.
// Each importer lists the workspace packages it must never import. Config-only cells
// (`@kd/tsconfig`, `@kd/eslint-config`) are not restricted here.

const FOLDERS = {
  api: 'apps/api',
  admin: 'apps/admin',
  mobile: 'apps/mobile',
  contracts: 'packages/contracts',
  'design-tokens': 'packages/design-tokens',
  i18n: 'packages/i18n',
  tsconfig: 'packages/tsconfig',
  'eslint-config': 'packages/eslint-config',
  seed: 'tools/seed',
  'seed-data': 'tools/seed-data',
};

const FORBIDDEN = {
  api: ['admin', 'mobile', 'design-tokens', 'seed', 'seed-data'],
  admin: ['api', 'mobile', 'seed', 'seed-data'],
  mobile: ['api', 'admin', 'seed', 'seed-data'],
  contracts: ['api', 'admin', 'mobile', 'design-tokens', 'i18n', 'seed', 'seed-data'],
  'design-tokens': ['api', 'admin', 'mobile', 'contracts', 'i18n', 'seed', 'seed-data'],
  i18n: ['api', 'admin', 'mobile', 'contracts', 'design-tokens', 'seed', 'seed-data'],
  seed: ['api', 'admin', 'mobile', 'contracts', 'design-tokens', 'i18n'],
  'seed-data': ['api', 'admin', 'mobile', 'contracts', 'design-tokens', 'i18n', 'seed'],
  'eslint-config': [
    'api',
    'admin',
    'mobile',
    'contracts',
    'design-tokens',
    'i18n',
    'seed',
    'seed-data',
  ],
};

export const IMPORTERS = Object.keys(FORBIDDEN);

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A relative specifier that climbs out with `../` and then walks into the folder.
const relativeInto = (folder) => `^(\\.\\./)+(.*/)?${escape(folder)}(/|$)`;

function forbidPackage(importer, target) {
  const message = `${importer} must not import ${target} (decision 0003, dependency matrix).`;
  return [
    { group: [`@kd/${target}`, `@kd/${target}/**`], message },
    { regex: relativeInto(FOLDERS[target]), message },
  ];
}

function extraPatterns(importer) {
  if (importer !== 'api') return [];
  // Decision 0004: the API may import the root of @kd/contracts, never the generated client.
  const message = 'api must not import the generated client of @kd/contracts (decision 0004).';
  return [
    { group: ['@kd/contracts/client', '@kd/contracts/client/**'], message },
    { regex: '^(\\.\\./)+(.*/)?packages/contracts/src/(client|generated)(\\.|/|$)', message },
  ];
}

const designsPattern = {
  regex: relativeInto('designs'),
  message: 'Nothing imports from designs/ (decision 0003).',
};

/** The `no-restricted-imports` layer of one importer, without a `files` scope. */
export function boundaries(importer) {
  const targets = FORBIDDEN[importer];
  if (!targets) throw new Error(`Unknown importer "${importer}" in @kd/eslint-config boundaries.`);
  return {
    name: `kd/boundaries/${importer}`,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...targets.flatMap((target) => forbidPackage(importer, target)),
            ...extraPatterns(importer),
            designsPattern,
          ],
        },
      ],
    },
  };
}
