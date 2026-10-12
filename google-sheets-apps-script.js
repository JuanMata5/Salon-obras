// Google Apps Script para una hoja de cálculo con una pestaña llamada "Obras".
// Implementar como aplicación web con ejecución como propietario y acceso adecuado.

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
    const record = payload.record || {};
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('Obras') || spreadsheet.insertSheet('Obras');
    const headers = [
      'id', 'title', 'author', 'theme', 'category', 'commercial_status',
      'whatsapp', 'email', 'description', 'image_url', 'status', 'votes', 'created_at'
    ];

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (String(sheet.getRange(1, 1).getValue()).toLowerCase() !== 'id') {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    let lastColumn = sheet.getLastColumn();
    let sheetHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    headers.forEach((header) => {
      if (!sheetHeaders.some((cell) => String(cell).toLowerCase() === header.toLowerCase())) {
        lastColumn += 1;
        sheet.getRange(1, lastColumn).setValue(header);
        sheetHeaders.push(header);
      }
    });

    const headerIndexes = {};
    sheetHeaders.forEach((header, index) => {
      headerIndexes[String(header).toLowerCase()] = index;
    });
    const idColumn = headerIndexes.id + 1;
    const lastRow = sheet.getLastRow();
    const matchingRows = lastRow > 1
      ? sheet.getRange(2, idColumn, lastRow - 1, 1).getValues()
        .map((row, index) => String(row[0]) === String(record.id) ? index + 2 : null)
        .filter((rowNumber) => rowNumber !== null)
      : [];

    if (payload.action === 'delete') {
      const deleted = matchingRows.length;
      matchingRows.reverse().forEach((rowNumber) => sheet.deleteRow(rowNumber));
      return ContentService.createTextOutput(JSON.stringify({ ok: true, deleted }));
    }

    const rowNumber = matchingRows[0];
    matchingRows.slice(1).reverse().forEach((duplicateRow) => sheet.deleteRow(duplicateRow));

    const rowValues = {
      id: record.id || '',
      title: record.title || '',
      author: record.author || '',
      theme: record.theme || '',
      category: Array.isArray(record.category) ? record.category.join('; ') : (record.category || ''),
      commercial_status: record.commercial_status || '',
      whatsapp: record.whatsapp || '',
      email: record.email || '',
      description: record.description || '',
      image_url: record.image_url || '',
      status: record.status || '',
      votes: record.votes || 0,
      created_at: record.created_at || new Date().toISOString()
    };

    const values = rowNumber
      ? sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0]
      : new Array(lastColumn).fill('');
    Object.keys(rowValues).forEach((key) => {
      values[headerIndexes[key]] = rowValues[key];
    });

    if (rowNumber) {
      sheet.getRange(rowNumber, 1, 1, lastColumn).setValues([values]);
    } else {
      sheet.appendRow(values);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, updated: Boolean(rowNumber) }));
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: error.message }));
  }
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    message: 'Google Sheets webhook active',
    version: 'upsert-lock-v2'
  }));
}
