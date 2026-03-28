const XLSX = require('xlsx');
const path = require('path');
const filePath = path.join(__dirname, '..', 'MortgageCalc_Risk_SK_v86_platné_od_12_01_2026 (1).xlsx');
const wb = XLSX.readFile(filePath);

// Multi-household formulas
const sheets = ['prijem - EUR-viac-domacnosti', 'rovne_splatky', 'klesajuce_splatky'];
sheets.forEach(sn => {
  const ws = wb.Sheets[sn];
  if (!ws || !ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  console.log('\n=== FORMULAS: ' + sn + ' ===');
  for (let r = 0; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({r, c});
      const cell = ws[addr];
      if (cell && cell.f) {
        console.log(addr + ': ' + cell.f);
      }
    }
  }
});

// Also read LI formulas from multi-household
const ws = wb.Sheets['prijem - EUR-viac-domacnosti'];
if (ws) {
  console.log('\n=== VALUES: prijem - EUR-viac-domacnosti (rows 100-183) ===');
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 99; r <= range.e.r; r++) {
    const vals = [];
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({r, c});
      const cell = ws[addr];
      if (cell && cell.v != null) {
        vals.push(XLSX.utils.encode_col(c) + (r+1) + '=' + cell.v + (cell.f ? ' [F:' + cell.f + ']' : ''));
      }
    }
    if (vals.length) console.log(vals.join(' | '));
  }
}
