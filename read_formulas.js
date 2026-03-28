const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'MortgageCalc_Risk_SK_v86_platné_od_12_01_2026 (1).xlsx');
const wb = XLSX.readFile(filePath);

// Focus on the main calculation sheet "prijem - EUR"
const mainSheet = wb.Sheets['prijem - EUR'];
const ref = mainSheet['!ref'];
const range = XLSX.utils.decode_range(ref);

console.log('=== FORMULAS in "prijem - EUR" ===');
for (let r = 0; r <= range.e.r; r++) {
  for (let c = 0; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({r, c});
    const cell = mainSheet[addr];
    if (cell && cell.f) {
      console.log(addr + ': ' + cell.f);
    }
  }
}

console.log('\n=== FORMULAS in "RPSN" (first 20) ===');
const rpsn = wb.Sheets['RPSN'];
const rref = XLSX.utils.decode_range(rpsn['!ref']);
let count = 0;
for (let r = 0; r <= Math.min(rref.e.r, 20); r++) {
  for (let c = 0; c <= rref.e.c; c++) {
    const addr = XLSX.utils.encode_cell({r, c});
    const cell = rpsn[addr];
    if (cell && cell.f) {
      console.log(addr + ': ' + cell.f);
      count++;
    }
  }
}

console.log('\n=== FORMULAS in "rovne_splatky" (first 15 rows) ===');
const rs = wb.Sheets['rovne_splatky'];
const rsref = XLSX.utils.decode_range(rs['!ref']);
for (let r = 0; r <= Math.min(rsref.e.r, 15); r++) {
  for (let c = 0; c <= rsref.e.c; c++) {
    const addr = XLSX.utils.encode_cell({r, c});
    const cell = rs[addr];
    if (cell && cell.f) {
      console.log(addr + ': ' + cell.f);
    }
  }
}

console.log('\n=== FORMULAS in "klesajuce_splatky" (first 15 rows) ===');
const ks = wb.Sheets['klesajuce_splatky'];
const ksref = XLSX.utils.decode_range(ks['!ref']);
for (let r = 0; r <= Math.min(ksref.e.r, 15); r++) {
  for (let c = 0; c <= ksref.e.c; c++) {
    const addr = XLSX.utils.encode_cell({r, c});
    const cell = ks[addr];
    if (cell && cell.f) {
      console.log(addr + ': ' + cell.f);
    }
  }
}
