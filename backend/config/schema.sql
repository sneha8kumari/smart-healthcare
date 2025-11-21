CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department TEXT,
    working_start TEXT,
    working_end TEXT
);

CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    doctor_id INTEGER,
    date TEXT,
    time TEXT,
    status TEXT DEFAULT 'booked',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS walkin_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_no INTEGER,
    user_id INTEGER,
    doctor_id INTEGER,
    status TEXT DEFAULT 'waiting',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY,
    avg_service_time_minutes INTEGER DEFAULT 10
);

INSERT OR IGNORE INTO settings(id, avg_service_time_minutes)
VALUES (1, 10);
