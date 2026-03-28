const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'MortgageCalc_Risk_SK_v86_platné_od_12_01_2026 (1).xlsx');
const wb = XLSX.readFile(filePath);

console.log('Sheets:', wb.SheetNames);

wb.SheetNames.forEach(sn => {
  const ws = wb.Sheets[sn];
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  console.log('\n=== ' + sn + ' === rows=' + (range.e.r + 1) + ' cols=' + (range.e.c + 1));

  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  data.slice(0, 120).forEach((row, i) => {
    const vals = [];
    row.forEach((v, j) => {
      if (v != null) vals.push(XLSX.utils.encode_col(j) + (i + 1) + '=' + v);
    });
    if (vals.length) console.log(vals.join(' | '));
  });
});
