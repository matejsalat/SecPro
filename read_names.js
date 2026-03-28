const XLSX = require('xlsx');
const path = require('path');
const filePath = path.join(__dirname, '..', 'MortgageCalc_Risk_SK_v86_platné_od_12_01_2026 (1).xlsx');
const wb = XLSX.readFile(filePath);
if (wb.Workbook && wb.Workbook.Names) {
  console.log('=== Named Ranges ===');
  wb.Workbook.Names.forEach(n => {
    console.log(n.Name + ' = ' + n.Ref);
  });
}
