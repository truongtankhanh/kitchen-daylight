// Checks the committed fixtures against the invariants the `provinces` / `wards` tables rely on.
//   node verify.mjs
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const load = (f) => JSON.parse(fs.readFileSync(dir + f, 'utf8'));
const P = load('provinces.json'),
  W = load('wards.json');
const errs = [];
const check = (ok, msg) => {
  if (!ok) errs.push(msg);
};
const pc = new Set(P.rows.map((p) => p.code));
check(P.rows.length === 34, `expected 34 provinces, got ${P.rows.length}`);
check(W.rows.length === 3321, `expected 3321 wards, got ${W.rows.length}`);
check(pc.size === P.rows.length, 'duplicate province codes');
check(new Set(W.rows.map((w) => w.code)).size === W.rows.length, 'duplicate ward codes');
for (const p of P.rows) {
  check(/^\d{2}$/.test(p.code), `province code ${p.code}`);
  check(['CITY', 'PROVINCE'].includes(p.type), `province type ${p.code}`);
  check(p.names?.vi && p.names.vi_full, `province names ${p.code}`);
}
for (const w of W.rows) {
  check(/^\d{5}$/.test(w.code), `ward code ${w.code}`);
  check(pc.has(w.province_code), `ward ${w.code} has unknown province ${w.province_code}`);
  check(['WARD', 'COMMUNE', 'SPECIAL_ZONE'].includes(w.type), `ward type ${w.code}`);
  check(w.names?.vi && w.names.vi_full, `ward names ${w.code}`);
  for (const n of Object.values(w.names))
    check(
      n === n.normalize('NFC') && !/\s{2}|[\n\t]|^\s|\s$/.test(n),
      `dirty name ${w.code}: ${JSON.stringify(n)}`,
    );
}
const hcm = W.rows.filter((w) => w.province_code === '79');
check(hcm.length === 168, `HCMC should have 168 communes-level units, got ${hcm.length}`);
console.log(
  errs.length
    ? `FAIL (${errs.length})\n` + errs.slice(0, 20).join('\n')
    : `OK: ${P.rows.length} provinces, ${W.rows.length} wards, HCMC ${hcm.length}`,
);
process.exit(errs.length ? 1 : 0);
