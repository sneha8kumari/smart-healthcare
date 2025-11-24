const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbFile = path.join(__dirname, "database.sqlite");
const schemaFile = path.join(__dirname, "schema.sql");

// If a database file from old backend exists in backend_old, copy it (optional).
// (We won't auto-copy here; below I will show how to copy if you want the old DB.)

const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error("DB Error:", err);
    else console.log("SQLite DB Connected");
});

// load schema file and execute (creates tables if not present)
const schema = fs.readFileSync(schemaFile, "utf-8");
db.exec(schema, (err) => {
    if (err) console.error("Schema Error:", err);
    else console.log("Tables created/verified");
});

module.exports = db;
