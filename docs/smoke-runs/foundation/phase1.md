# Owner smoke run 1: workspace (Phase 1)

Run the steps in order, one at a time, in the same terminal session. Stop at the first
step whose result does not match the expected result and report it. Paste the raw
output into the block under each step and tick the result. Remove usernames, host
names and home paths from pasted output (use `<repo>` and `$SMOKE_ROOT`).

Steps 1 to 6 and 8 run in a throw-away clone (`$SMOKE_ROOT/kd`), so the working copy
is never cleaned or committed to. Step 7 uses a second throw-away clone. Every step
starts with an explicit `cd`.

| Field                         | Value                                    |
| ----------------------------- | ---------------------------------------- |
| Date                          | 2026-11-03                               |
| Commit (`git rev-parse HEAD`) | 1851a22bd55fe82bdcdaae9578fb773ae959f005 |
| macOS version / chip / RAM    |                                          |
| pnpm store warm or cold       | warm                                     |

## Step 0: toolchain

Run in the repository root.

```sh
nvm use
corepack enable
node --version
pnpm --version
```

Expected: `nvm use` selects `26.13.0` from `.nvmrc`; `corepack enable` exits 0;
`node --version` prints `v26.13.0`; `pnpm --version` prints `12.16.1` (from
`packageManager`). If `corepack` is not found, stop and report it.

Result: [x] pass [ ] fail

```text
Found '<repo>/.nvmrc' with version <26.13.0>
Now using node v26.13.0 (npm v11.20.0)
v26.13.0
12.16.1
```

## Step 1: fresh install and its duration

```sh
SMOKE_ROOT="$(mktemp -d)"
git clone "$(git rev-parse --show-toplevel)" "$SMOKE_ROOT/kd"
cd "$SMOKE_ROOT/kd"
time pnpm install --frozen-lockfile
```

Expected: install exits 0 with no lockfile changes; the `prepare` script installs the
Git hooks. Record the `real` time.

Duration (`real`): 0.720 s (warm store)

Result: [x] pass [ ] fail

```text
Cloning into '$SMOKE_ROOT/kd'...
done.
Scope: all 3 workspace projects
✓ Lockfile passes supply-chain policies (verified 14m ago)
Lockfile is up to date, resolution step is skipped
Packages: +194
Progress: resolved 194, reused 194, downloaded 0, added 194, done
. prepare$ node .husky/install.mjs
└─ Done in 53ms

devDependencies:
+ @commitlint/cli 21.2.4
+ @commitlint/config-conventional 21.2.4
+ @commitlint/config-pnpm-scopes 21.2.2
+ eslint 10.14.0
+ husky 9.1.7
+ lint-staged 17.6.0
+ prettier 3.9.10
+ turbo 2.11.10
+ typescript 6.0.3

Done in 649ms using pnpm v12.16.1
pnpm install --frozen-lockfile  0.15s user 0.55s system 96% cpu 0.720 total
```

## Step 2: lint and typecheck pass

```sh
cd "$SMOKE_ROOT/kd"
pnpm turbo run lint typecheck --concurrency=2
```

Expected: exit 0; every task succeeds; the summary shows `0 cached` (first run).

Result: [x] pass [ ] fail

Note: only one task ran (`@kd/eslint-config:lint`); no package defines `typecheck`
yet.

```text
   • turbo 2.11.10
   • Packages in scope: @kd/eslint-config, @kd/tsconfig
   • Running lint, typecheck in 2 packages
   • Remote caching disabled

@kd/eslint-config:lint: cache miss, executing 5d2e30e4a519e943
@kd/eslint-config:lint: $ eslint . --max-warnings 0

 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total
  Time:    1.207s
```

## Step 3: second run is a cache hit

```sh
cd "$SMOKE_ROOT/kd"
pnpm turbo run lint typecheck --concurrency=2
```

Expected: exit 0; the summary shows `N cached, N total` (all tasks cached) and
`>>> FULL TURBO`.

Result: [x] pass [ ] fail

```text
   • turbo 2.11.10
   • Packages in scope: @kd/eslint-config, @kd/tsconfig
   • Running lint, typecheck in 2 packages
   • Remote caching disabled

@kd/eslint-config:lint: cache hit, replaying logs 5d2e30e4a519e943
@kd/eslint-config:lint: $ eslint . --max-warnings 0

 Tasks:    1 successful, 1 total
Cached:    1 cached, 1 total
  Time:    63ms >>> FULL TURBO
```

## Step 4: ESLint boundary fixtures

```sh
cd "$SMOKE_ROOT/kd"
pnpm --filter @kd/eslint-config check-fixtures
```

Expected: exit 0.

Result: [x] pass [ ] fail

Note: run at commit `1851a22`. The Phase 1 review fix `797ee0b` adds sibling-path fixtures and
the manifest check; from that commit `check-fixtures` reports 197 violations, and the package
`lint` script also runs `check-fixtures` and `check-manifests`.

```text
$ node scripts/check-fixtures.mjs
ok   boundaries/admin.ts (13 expected violations)
ok   boundaries/api.ts (19 expected violations)
ok   boundaries/contracts.ts (23 expected violations)
ok   boundaries/design-tokens.ts (22 expected violations)
ok   boundaries/eslint-config.ts (25 expected violations)
ok   boundaries/i18n.ts (22 expected violations)
ok   boundaries/mobile.ts (13 expected violations)
ok   boundaries/seed-data.ts (22 expected violations)
ok   boundaries/seed.ts (19 expected violations)
ok   rules/consistent-type-imports.ts (1 expected violations)
ok   rules/no-console.ts (1 expected violations)
ok   rules/no-explicit-any.ts (1 expected violations)
ok   rules/src/cli.ts (0 expected violations)
check-fixtures: 13 files, 181 violations rejected as expected
```

## Step 5: bad commit message is rejected

```sh
cd "$SMOKE_ROOT/kd"
git commit --allow-empty -m "bad message"; echo "exit=$?"
git log -1 --format=%s
```

Expected: commitlint rejects the message from the `commit-msg` hook; `exit=` is
non-zero; `git log` still shows the previous commit subject, not `bad message`.
If the commit went through, undo it with `git reset --soft HEAD~1` and report a fail.

Result: [x] pass [ ] fail

```text
5:23PM INF 0 commits scanned.
5:23PM INF scanned ~0 bytes (0) in 25.5ms
5:23PM INF no leaks found
→ lint-staged could not find any staged files.
⧗   --- input ---
bad message
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]

✖   found 2 problems, 0 warnings
ⓘ   Get help: https://github.com/conventional-changelog/commitlint/#what-is-commitlint

husky - commit-msg script failed (code 1)
exit=1
chore(repo): add husky hooks, commitlint, lint-staged and gitleaks config
```

## Step 6: staged secret is rejected

The key is a fake built at run time, so this sheet does not contain a full key
pattern. The 16 characters after `AKIA` must stay within `A-Z` and `2-7`, or the
gitleaks AWS rule does not match.

6a. Attempt the commit:

```sh
cd "$SMOKE_ROOT/kd"
printf 'aws_access_key_id=AKIA%s\n' 'QZ7XW4R3T5Y2UPKD' > smoke-leak-check.txt
git add smoke-leak-check.txt
git commit -m "chore: smoke leak check"; echo "exit=$?"
```

Expected: the `pre-commit` hook reports an AWS access key finding and the commit is
rejected; `exit=` is non-zero.

6b. Clean up (safe in both outcomes; undoes the commit only if it went through):

```sh
cd "$SMOKE_ROOT/kd"
if [ "$(git log -1 --format=%s)" = "chore: smoke leak check" ]; then git reset --soft HEAD~1; fi
git restore --staged smoke-leak-check.txt 2>/dev/null
rm -f smoke-leak-check.txt
git status --short
git log -1 --format=%s
```

Expected: `git status --short` prints nothing; `git log` shows
`chore(repo): add husky hooks, commitlint, lint-staged and gitleaks config`.

Result: [x] pass [ ] fail

Note: a first attempt used a suffix containing `8` and `9`, which the rule does not
match, so that commit went through in the throw-away clone and was undone. The run
below uses the corrected suffix.

```text
# 6a
Finding:     aws_access_key_id=REDACTED
Secret:      REDACTED
RuleID:      aws-access-token
Entropy:     4.121928
File:        smoke-leak-check.txt
Line:        1
Fingerprint: smoke-leak-check.txt:aws-access-token:1

5:27PM INF 0 commits scanned.
5:27PM INF scanned ~39 bytes (39 bytes) in 25.4ms
5:27PM WRN leaks found: 1
husky - pre-commit script failed (code 1)
exit=1

# 6b
chore(repo): add husky hooks, commitlint, lint-staged and gitleaks config
```

## Step 7: install without the hook tool binary does not fail

`pnpm install --prod` skips the root `prepare` script, so the hook installer is also
run directly to prove it tolerates the missing binary.

```sh
git clone "$SMOKE_ROOT/kd" "$SMOKE_ROOT/kd-nohooks"
cd "$SMOKE_ROOT/kd-nohooks"
pnpm install --frozen-lockfile --prod; echo "install exit=$?"
test -e node_modules/.bin/husky && echo "husky present" || echo "husky absent"
node .husky/install.mjs; echo "prepare exit=$?"
```

Expected: `install exit=0`; `husky absent`; `prepare exit=0`.

Result: [x] pass [ ] fail

```text
Cloning into '$SMOKE_ROOT/kd-nohooks'...
done.
Scope: all 3 workspace projects
✓ Lockfile passes supply-chain policies (verified 19m ago)
Lockfile is up to date, resolution step is skipped
Packages: +97
Progress: resolved 97, reused 97, downloaded 0, added 97, done
Done in 223ms using pnpm v12.16.1
install exit=0
husky absent
prepare: husky is not installed, Git hooks were not set up.
prepare exit=0
```

## Step 8: peak memory of step 2

`--force` bypasses the cache so the full run is measured.

```sh
cd "$SMOKE_ROOT/kd"
/usr/bin/time -l pnpm turbo run lint typecheck --concurrency=2 --force
```

Expected: exit 0. Record `maximum resident set size` (bytes; the largest single
process, not the sum) and `peak memory footprint` if printed.

Maximum resident set size: 199917568 bytes (~191 MiB)
Peak memory footprint: 20597376 bytes (~20 MiB)

Result: [x] pass [ ] fail

```text
   • turbo 2.11.10
   • Packages in scope: @kd/eslint-config, @kd/tsconfig
   • Running lint, typecheck in 2 packages
   • Remote caching disabled

@kd/eslint-config:lint: cache bypass, force executing 5d2e30e4a519e943
@kd/eslint-config:lint: $ eslint . --max-warnings 0

 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total
  Time:    677ms

        0.83 real         0.66 user         0.23 sys
           199917568  maximum resident set size
               33749  page reclaims
                1876  page faults
                   0  swaps
                1759  voluntary context switches
                7601  involuntary context switches
           455017484  instructions retired
           182938865  cycles elapsed
            20597376  peak memory footprint
```

## Step 9: peak memory of a fresh install

Added at the Phase 1 review: the phase success criteria ask for the install's peak memory too.
Self-contained, so it can run after the cleanup below. Start in the repository root.

```sh
SMOKE_ROOT="$(mktemp -d)"
git clone "$(git rev-parse --show-toplevel)" "$SMOKE_ROOT/kd"
cd "$SMOKE_ROOT/kd"
/usr/bin/time -l pnpm install --frozen-lockfile
```

Expected: exit 0. Record `maximum resident set size` and `peak memory footprint` as in step 8.

Maximum resident set size: ____
Peak memory footprint: ____

Result: [ ] pass [ ] fail

```text

```

## Cleanup

```sh
cd "$HOME" && rm -rf "$SMOKE_ROOT"
```

Then return to the working copy, fill in this sheet and commit it.

Phase 1 gate: run the review prompt
