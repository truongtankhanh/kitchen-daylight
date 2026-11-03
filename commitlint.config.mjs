// Conventional Commits (decision 0002). Scopes are the pnpm workspace names without the
// `@kd/` prefix, plus the fixed list below. The scope is optional; no ticket id is required.
import pnpmScopes from '@commitlint/config-pnpm-scopes';

const EXTRA_SCOPES = ['repo', 'docs', 'ci', 'deps'];

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': async (context) => {
      const [level, applicable, workspaceScopes] = await pnpmScopes.rules['scope-enum'](context);
      // config-pnpm-scopes also adds `global`, which this repository does not use.
      const scopes = workspaceScopes.filter((scope) => scope !== 'global');
      return [level, applicable, [...new Set([...scopes, ...EXTRA_SCOPES])].sort()];
    },
  },
};
