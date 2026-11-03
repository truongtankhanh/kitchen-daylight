// Dependency matrix of decision 0003, section 6. Each importer lists the workspace packages it must
// never import. Package names are checked by `no-restricted-imports`; relative paths are resolved
// against the linted file and checked by the local rule `kd/no-relative-boundary`, so a short path
// between sibling folders (`../../api/src/main.js` from `apps/admin/src`) is caught as well.
// Config-only cells (`@kd/tsconfig`, `@kd/eslint-config`) are not restricted here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const FOLDERS = {
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

const ALL_RUNTIME = [
  'api',
  'admin',
  'mobile',
  'contracts',
  'design-tokens',
  'i18n',
  'seed',
  'seed-data',
];

const FORBIDDEN = {
  api: ['admin', 'mobile', 'design-tokens', 'seed', 'seed-data'],
  admin: ['api', 'mobile', 'seed', 'seed-data'],
  mobile: ['api', 'admin', 'seed', 'seed-data'],
  contracts: ['api', 'admin', 'mobile', 'design-tokens', 'i18n', 'seed', 'seed-data'],
  'design-tokens': ['api', 'admin', 'mobile', 'contracts', 'i18n', 'seed', 'seed-data'],
  i18n: ['api', 'admin', 'mobile', 'contracts', 'design-tokens', 'seed', 'seed-data'],
  seed: ['api', 'admin', 'mobile', 'contracts', 'design-tokens', 'i18n'],
  'seed-data': ['api', 'admin', 'mobile', 'contracts', 'design-tokens', 'i18n', 'seed'],
  'eslint-config': ALL_RUNTIME,
  tsconfig: [...ALL_RUNTIME, 'eslint-config'],
};

export const IMPORTERS = Object.keys(FORBIDDEN);

const packageMessage = (importer, target) =>
  `${importer} must not import ${target} (decision 0003, dependency matrix).`;
const CLIENT_MESSAGE = 'api must not import the generated client of @kd/contracts (decision 0004).';
const DESIGNS_MESSAGE = 'Nothing imports from designs/ (decision 0003).';

const toPosix = (value) => value.split(path.sep).join('/');

// True when `relative` (repository-relative, POSIX) is `target`, a path under it, or a file named
// after it with an extension (`src/client.js` for `src/client`).
const isInside = (relative, target) =>
  relative === target || relative.startsWith(`${target}/`) || relative.startsWith(`${target}.`);

const noRelativeBoundary = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid relative imports that resolve into a folder the importer must not reach.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          targets: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, message: { type: 'string' } },
              required: ['path', 'message'],
              additionalProperties: false,
            },
          },
        },
        required: ['targets'],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [{ targets }] = context.options;
    const { filename } = context;
    if (!path.isAbsolute(filename)) return {};

    const check = (source) => {
      if (source?.type !== 'Literal' || typeof source.value !== 'string') return;
      if (!/^\.\.?(\/|$)/.test(source.value)) return;
      const resolved = path.resolve(path.dirname(filename), source.value);
      const relative = toPosix(path.relative(REPO_ROOT, resolved));
      const hit = targets.find((target) => isInside(relative, target.path));
      if (hit) context.report({ node: source, message: hit.message });
    };

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

const plugin = {
  meta: { name: '@kd/eslint-config' },
  rules: { 'no-relative-boundary': noRelativeBoundary },
};

/** The boundary layer of one importer, without a `files` scope. */
export function boundaries(importer) {
  const targets = FORBIDDEN[importer];
  if (!targets) throw new Error(`Unknown importer "${importer}" in @kd/eslint-config boundaries.`);

  const packagePatterns = targets.map((target) => ({
    group: [`@kd/${target}`, `@kd/${target}/**`],
    message: packageMessage(importer, target),
  }));
  const pathTargets = targets.map((target) => ({
    path: FOLDERS[target],
    message: packageMessage(importer, target),
  }));

  // Decision 0004: the API may import the root of @kd/contracts, never the generated client.
  if (importer === 'api') {
    packagePatterns.push({
      group: ['@kd/contracts/client', '@kd/contracts/client/**'],
      message: CLIENT_MESSAGE,
    });
    pathTargets.push(
      { path: 'packages/contracts/src/client', message: CLIENT_MESSAGE },
      { path: 'packages/contracts/src/generated', message: CLIENT_MESSAGE },
    );
  }
  pathTargets.push({ path: 'designs', message: DESIGNS_MESSAGE });

  return {
    name: `kd/boundaries/${importer}`,
    plugins: { kd: plugin },
    rules: {
      'no-restricted-imports': ['error', { patterns: packagePatterns }],
      'kd/no-relative-boundary': ['error', { targets: pathTargets }],
    },
  };
}

/**
 * The `@kd/*` dependencies of a workspace manifest that the matrix forbids (decision 0003,
 * section 6, manifest level). A manifest whose own name, or a dependency's name, is not in the
 * matrix is rejected too: a new package needs a row and a column first.
 */
export function forbiddenDependencies(manifest) {
  const importer = String(manifest.name ?? '').replace(/^@kd\//, '');
  const forbidden = FORBIDDEN[importer];
  if (!forbidden) {
    return [{ dependency: manifest.name, reason: 'package is not in the dependency matrix' }];
  }

  const problems = [];
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      if (!dependency.startsWith('@kd/')) continue;
      const target = dependency.slice('@kd/'.length);
      if (!(target in FOLDERS)) {
        problems.push({ dependency, reason: `${field}: not in the dependency matrix` });
      } else if (forbidden.includes(target)) {
        problems.push({ dependency, reason: `${field}: ${packageMessage(importer, target)}` });
      }
    }
  }
  return problems;
}
