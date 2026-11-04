// Conventional Commits (decision 0002). Scopes are the pnpm workspace names without the
// `@kd/` prefix, plus the fixed list below. The scope is optional; no ticket id is required.
import pnpmScopes from '@commitlint/config-pnpm-scopes';

const EXTRA_SCOPES = ['repo', 'docs', 'ci', 'deps'];

// Dependabot writes the header from .github/dependabot.yml (`chore(deps): bump ...`) but its
// body carries release notes and URLs longer than body-max-line-length. Only messages with
// that header and Dependabot's sign-off are skipped (decision 0002, P5-T2).
const isDependabotCommit = (message) =>
  /^chore\(deps\): bump /.test(message) &&
  /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/m.test(message);

export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [isDependabotCommit],
  rules: {
    'scope-enum': async (context) => {
      const [level, applicable, workspaceScopes] = await pnpmScopes.rules['scope-enum'](context);
      // config-pnpm-scopes also adds `global`, which this repository does not use.
      const scopes = workspaceScopes.filter((scope) => scope !== 'global');
      return [level, applicable, [...new Set([...scopes, ...EXTRA_SCOPES])].sort()];
    },
  },
};
