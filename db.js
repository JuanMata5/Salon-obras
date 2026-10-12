const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.VERCEL === '1'
  ? path.join('/tmp', 'salon-data.sqlite')
  : path.join(__dirname, 'data.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function init() {
  await run(`
    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      theme TEXT NOT NULL,
      category TEXT,
      commercial_status TEXT NOT NULL,
      whatsapp TEXT,
      email TEXT,
      description TEXT,
      image_url TEXT,
      status TEXT DEFAULT 'pending',
      votes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const columns = await all('PRAGMA table_info(works)');
  if (!columns.some((column) => column.name === 'votes')) {
    await run('ALTER TABLE works ADD COLUMN votes INTEGER NOT NULL DEFAULT 0');
  }
}

module.exports = { db, run, all, get, init };
