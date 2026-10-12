// Google Sheets + Drive como almacenamiento persistente para el salón.
// Implementar como aplicación web: ejecutar como propietario y permitir acceso externo.
const STORAGE_VERSION = 'sheets-drive-v3';
const SHEET_NAME = 'Obras';
const HEADERS = [
  'id', 'title', 'author', 'theme', 'category', 'commercial_status',
  'whatsapp', 'email', 'description', 'image_url', 'status', 'votes', 'created_at'
];

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function getWorksFromSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return [];
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((header) => String(header).trim().toLowerCase());
  return values.slice(1)
    .filter((row) => row.some((cell) => cell !== '' && cell !== null))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => { record[header] = row[index]; });
      return {
        ...record,
        id: String(record.id ?? ''),
        category: Array.isArray(record.category)
          ? record.category
          : String(record.category || '').split(';').map((value) => value.trim()).filter(Boolean),
        votes: Number(record.votes) || 0,
        created_at: record.created_at instanceof Date
          ? record.created_at.toISOString()
          : String(record.created_at || '')
      };
    });
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'list') {
      return jsonOutput({ ok: true, version: STORAGE_VERSION, works: getWorksFromSheet() });
    }
    return jsonOutput({ ok: true, message: 'Google Sheets and Drive storage active', version: STORAGE_VERSION });
  } catch (error) {
    return jsonOutput({ ok: false, version: STORAGE_VERSION, error: error.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const payload = JSON.parse(e.postData.contents);
    const record = payload.record || {};
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    } else if (String(sheet.getRange(1, 1).getValue()).toLowerCase() !== 'id') {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    }

    let lastColumn = sheet.getLastColumn();
    const sheetHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    HEADERS.forEach((header) => {
      if (!sheetHeaders.some((cell) => String(cell).toLowerCase() === header.toLowerCase())) {
        lastColumn += 1;
        sheet.getRange(1, lastColumn).setValue(header);
        sheetHeaders.push(header);
      }
    });

    const indexes = {};
    sheetHeaders.forEach((header, index) => { indexes[String(header).toLowerCase()] = index; });
    const lastRow = sheet.getLastRow();
    const matchingRows = lastRow > 1
      ? sheet.getRange(2, indexes.id + 1, lastRow - 1, 1).getValues()
        .map((row, index) => String(row[0]) === String(record.id) ? index + 2 : null)
        .filter((rowNumber) => rowNumber !== null)
      : [];

    if (payload.action === 'delete') {
      const deleted = matchingRows.length;
      matchingRows.reverse().forEach((rowNumber) => sheet.deleteRow(rowNumber));
      return jsonOutput({ ok: true, deleted });
    }

    const rowNumber = matchingRows[0];
    matchingRows.slice(1).reverse().forEach((duplicateRow) => sheet.deleteRow(duplicateRow));
    const values = rowNumber
      ? sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0]
      : new Array(lastColumn).fill('');

    let imageUrl = record.image_url || values[indexes.image_url] || '';
    if (record.image_base64) {
      const bytes = Utilities.base64Decode(record.image_base64);
      const mimeType = record.image_mime_type || 'image/jpeg';
      const fileName = String(record.image_file_name || `obra-${record.id}.jpg`).replace(/[\\/:*?"<>|]/g, '_');
      const file = DriveApp.createFile(Utilities.newBlob(bytes, mimeType, fileName));
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      imageUrl = `https://drive.google.com/uc?export=view&id=${file.getId()}`;
    }

    const rowRecord = {
      id: record.id || '',
      title: record.title || '',
      author: record.author || '',
      theme: record.theme || '',
      category: Array.isArray(record.category) ? record.category.join('; ') : (record.category || ''),
      commercial_status: record.commercial_status || '',
      whatsapp: record.whatsapp || '',
      email: record.email || '',
      description: record.description || '',
      image_url: imageUrl,
      status: record.status || 'pending',
      votes: Number(record.votes) || 0,
      created_at: record.created_at || new Date().toISOString()
    };
    Object.keys(rowRecord).forEach((key) => { values[indexes[key]] = rowRecord[key]; });

    if (rowNumber) sheet.getRange(rowNumber, 1, 1, lastColumn).setValues([values]);
    else sheet.appendRow(values);

    return jsonOutput({ ok: true, updated: Boolean(rowNumber), image_url: imageUrl });
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
