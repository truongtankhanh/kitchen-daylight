// Runs from the root `prepare` script. Installs the Git hooks, unless:
// - HUSKY=0 is set (CI sets it, decision 0002): husky itself skips;
// - husky is not installed (for example a production-only install): skip without failing.
let husky;
try {
  ({ default: husky } = await import('husky'));
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  process.stderr.write('prepare: husky is not installed, Git hooks were not set up.\n');
  process.exit(0);
}

const message = husky();
if (message) process.stderr.write(`prepare: ${message}\n`);
