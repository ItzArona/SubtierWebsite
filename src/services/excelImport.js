const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { getLeaderboard, saveLeaderboard } = require('./dataStore');

const SOURCE_EXCEL = path.resolve(__dirname, '../../1.9+Subtier Overall(1).xlsx');

function toNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toNumber(value) {
  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function importExcelIfNeeded() {
  const existing = await getLeaderboard();
  if (existing.length > 0 || !fs.existsSync(SOURCE_EXCEL)) {
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(SOURCE_EXCEL);

  const sheet = workbook.getWorksheet('Overall') || workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Excel文件中未找到有效工作表');
  }

  const headers = sheet.getRow(1).values.slice(1).map((header) => String(header || '').trim());
  const categoryHeaders = headers.slice(4);

  const entries = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const values = row.values.slice(1);
    const player = toNullableString(values[1]);
    if (!player) {
      return;
    }

    const categories = {};
    for (let i = 0; i < categoryHeaders.length; i += 1) {
      const key = categoryHeaders[i];
      categories[key] = toNullableString(values[i + 4]);
    }

    entries.push({
      id: `entry-${rowNumber}`,
      position: toNumber(values[0]),
      player,
      rank: toNullableString(values[2]) || 'Unranked',
      points: toNumber(values[3]),
      categories,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });

  await saveLeaderboard(entries);
}

module.exports = {
  importExcelIfNeeded
};
