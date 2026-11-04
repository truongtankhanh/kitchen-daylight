// Builds the `provinces` and `wards` seed fixtures from the official web service of the
// National Statistics Office (NSO, formerly GSO): https://danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx
//
//   node fetch.mjs                      -> provinces.json, wards.json (state as of today)
//   node fetch.mjs --asof 01/07/2025    -> same, as of that date (dd/MM/yyyy), written to --out
//   node fetch.mjs --out ./tmp          -> write somewhere else
//
// No dependencies (Node 18+). Requests are sequential, one per province (34 + 1), with a short pause.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ENDPOINT = 'https://danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx';
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const today = new Date();
const asOf =
  args.asof ??
  `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
const outDir = path.resolve(args.out ?? path.dirname(new URL(import.meta.url).pathname));

async function soap(op, fields) {
  const body = Object.entries(fields)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${op} xmlns="http://tempuri.org/">${body}</${op}></soap:Body></soap:Envelope>`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"http://tempuri.org/${op}"`,
      'User-Agent': 'KitchenDaylight-seed/0.1',
    },
    body: xml,
  });
  if (!res.ok) throw new Error(`${op}: HTTP ${res.status}`);
  return res.text();
}
// The service is not clean: at least one name contains a line break ("Phường \nHoàn Kiếm"), so every value is NFC-normalised and whitespace-collapsed.
const clean = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
// The service returns an ADO.NET DataSet: <TABLE>…<Field>value</Field>…</TABLE>
function rows(xml) {
  return [...xml.matchAll(/<TABLE\b[^>]*>([\s\S]*?)<\/TABLE>/g)].map((m) =>
    Object.fromEntries(
      [...m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map((f) => [f[1], clean(decode(f[2]))]),
    ),
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROVINCE_TYPE = { 'Thành phố Trung ương': 'CITY', Tỉnh: 'PROVINCE' };
const WARD_TYPE = { Phường: 'WARD', Xã: 'COMMUNE', 'Đặc khu': 'SPECIAL_ZONE' };
const stripPrefix = (full, prefixes) => {
  const p = prefixes.find((x) => full.startsWith(x + ' '));
  return p ? full.slice(p.length + 1) : full;
};

const provRows = rows(await soap('DanhMucTinh', { DenNgay: asOf }));
const provinces = provRows
  .map((r) => {
    const type = PROVINCE_TYPE[r.LoaiHinh];
    if (!type) throw new Error(`Unknown province type: ${r.LoaiHinh} (${r.MaTinh})`);
    return {
      code: r.MaTinh,
      names: { vi: stripPrefix(r.TenTinh, ['Thành phố', 'Tỉnh']), vi_full: r.TenTinh },
      type,
      region: r.Vung || null,
    };
  })
  .sort((a, b) => a.code.localeCompare(b.code));

const wards = [];
for (const p of provinces) {
  const xml = await soap('DanhMucPhuongXa', {
    DenNgay: asOf,
    Tinh: p.code,
    TenTinh: '',
    QuanHuyen: '',
    TenQuanHuyen: '',
  });
  for (const r of rows(xml)) {
    const type = WARD_TYPE[r.LoaiHinh];
    if (!type) throw new Error(`Unknown ward type: ${r.LoaiHinh} (${r.MaPhuongXa})`);
    wards.push({
      code: r.MaPhuongXa,
      province_code: r.MaTinh,
      names: {
        vi: stripPrefix(r.TenPhuongXa, ['Phường', 'Xã', 'Đặc khu']),
        vi_full: r.TenPhuongXa,
      },
      type,
    });
  }
  await sleep(300);
}
wards.sort((a, b) => a.code.localeCompare(b.code));

// Sanity checks: fail loudly instead of writing a half-valid fixture.
const codes = new Set(wards.map((w) => w.code));
const provCodes = new Set(provinces.map((p) => p.code));
const problems = [];
if (codes.size !== wards.length) problems.push('duplicate ward codes');
if (wards.some((w) => !provCodes.has(w.province_code)))
  problems.push('ward with unknown province_code');
if (provinces.some((p) => !/^\d{2}$/.test(p.code)) || wards.some((w) => !/^\d{5}$/.test(w.code)))
  problems.push('code format (expected 2 and 5 digits)');
if (problems.length) throw new Error(problems.join('; '));

const meta = {
  source: ENDPOINT,
  operations: ['DanhMucTinh', 'DanhMucPhuongXa'],
  as_of: asOf,
  retrieved_at: new Date().toISOString(),
  counts: {
    provinces: provinces.length,
    wards: wards.length,
    by_ward_type: Object.fromEntries(
      Object.values(WARD_TYPE).map((t) => [t, wards.filter((w) => w.type === t).length]),
    ),
  },
};
const write = (name, data) =>
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 1) + '\n');
fs.mkdirSync(outDir, { recursive: true });
write('provinces.json', { _meta: meta, rows: provinces });
write('wards.json', { _meta: meta, rows: wards });
const sha = (f) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(outDir, f)))
    .digest('hex');
console.log(
  JSON.stringify(
    {
      ...meta,
      sha256: { 'provinces.json': sha('provinces.json'), 'wards.json': sha('wards.json') },
    },
    null,
    2,
  ),
);
