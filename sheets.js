const { google } = require("googleapis");

function getServiceAccount_() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env is required");

  const obj = JSON.parse(raw);
  if (obj.private_key) obj.private_key = obj.private_key.replace(/\\n/g, "\n");
  return obj;
}

function getSheets_() {
  const sa = getServiceAccount_();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getSheetValues_(spreadsheetId, rangeA1) {
  const sheets = getSheets_();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: rangeA1 });
  return res.data.values || [];
}

async function appendRow_(spreadsheetId, rangeA1, row) {
  const sheets = getSheets_();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: rangeA1,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

async function updateCell_(spreadsheetId, rangeA1, value) {
  const sheets = getSheets_();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: rangeA1,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

function nowIso_() {
  return new Date().toISOString();
}

function buildHeaderMap_(headersRow) {
  const map = {};
  headersRow.forEach((h, i) => (map[String(h).trim()] = i));
  return map;
}

async function readTable_(spreadsheetId, sheetName) {
  const values = await getSheetValues_(spreadsheetId, `${sheetName}!A:Z`);
  if (values.length === 0) return { headers: [], rows: [] };
  const headers = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return { headers, rows };
}

async function findRowByValue_(spreadsheetId, sheetName, colName, value) {
  const { headers, rows } = await readTable_(spreadsheetId, sheetName);
  if (!headers.length) return null;
  const map = buildHeaderMap_(headers);
  const idx = map[colName];
  if (idx === undefined) throw new Error(`Column ${colName} not found in ${sheetName}`);

  for (let r = 0; r < rows.length; r++) {
    const cell = rows[r][idx];
    if (String(cell || "") === String(value)) {
      return { headers, map, rowIndex1: r + 2, row: rows[r] }; // 1-based row in sheet
    }
  }
  return null;
}

async function findRowsByPredicate_(spreadsheetId, sheetName, predicateFn) {
  const { headers, rows } = await readTable_(spreadsheetId, sheetName);
  if (!headers.length) return [];
  const map = buildHeaderMap_(headers);

  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = rows[r][i]));
    if (predicateFn(obj)) out.push({ obj, rowIndex1: r + 2, headers, map });
  }
  return out;
}

module.exports = {
  nowIso_,
  getSheetValues_,
  appendRow_,
  updateCell_,
  readTable_,
  findRowByValue_,
  findRowsByPredicate_,
};
