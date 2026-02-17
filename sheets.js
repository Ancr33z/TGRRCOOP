const { google } = require("googleapis");

function getServiceAccount_() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env is required");

  // На некоторых платформах JSON приходит с экранированными переносами
  const obj = JSON.parse(raw);

  // private_key иногда ломается из-за \n — восстанавливаем
  if (obj.private_key) {
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
  }

  return obj;
}

function getSheetsClient_() {
  const sa = getServiceAccount_();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function sheetsAppendRow(spreadsheetId, rangeA1, valuesRow) {
  const sheets = getSheetsClient_();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: rangeA1,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [valuesRow] },
  });
}

module.exports = { sheetsAppendRow };
