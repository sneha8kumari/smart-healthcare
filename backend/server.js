require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const db = require('./db');

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";

// CORS whitelist - for local dev allow both forms of Live Server
const allowedOrigins = [
  (process.env.CORS_ORIGIN || 'http://127.0.0.1:5500'),
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  }
}));

app.use(bodyParser.json());
app.use(morgan('dev'));

// helpers
function sendError(res, err) {
  console.error(err);
  res.status(500).json({ error: err.message || err });
}

function verifyStaff(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "No token provided" });
  const token = auth.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid token" });
    req.user = decoded;
    next();
  });
}

// routes

app.get('/', (req, res) => res.send('Smart Healthcare API Running'));

// register
app.post('/api/register', (req, res) => {
  const { name, phone, email } = req.body;
  db.run("INSERT INTO users(name, phone, email) VALUES(?, ?, ?)", [name, phone, email], function(err) {
    if (err) return sendError(res, err);
    res.json({ user_id: this.lastID, name, phone, email });
  });
});

// add doctor
app.post('/api/doctors', (req, res) => {
  const { name, department, working_start, working_end } = req.body;
  db.run("INSERT INTO doctors(name, department, working_start, working_end) VALUES(?, ?, ?, ?)",
    [name, department, working_start, working_end],
    function(err) {
      if (err) return sendError(res, err);
      res.json({ doctor_id: this.lastID });
    });
});

// list doctors
app.get('/api/doctors', (req, res) => {
  db.all("SELECT * FROM doctors", [], (err, rows) => {
    if (err) return sendError(res, err);
    res.json(rows);
  });
});

// book appointment
app.post('/api/appointments', (req, res) => {
  const { user_id, doctor_id, date, time } = req.body;
  db.run("INSERT INTO appointments(user_id, doctor_id, date, time) VALUES(?, ?, ?, ?)",
    [user_id, doctor_id, date, time],
    function(err) {
      if (err) return sendError(res, err);
      res.json({ appointment_id: this.lastID });
    });
});

// cancel appt
app.post('/api/cancel/:id', (req, res) => {
  db.run("UPDATE appointments SET status='cancelled' WHERE id=?", [req.params.id], function(err) {
    if (err) return sendError(res, err);
    res.json({ message: "Cancelled" });
  });
});

// walkin token
app.post('/api/walkin', (req, res) => {
  const { user_id, doctor_id } = req.body;
  db.get("SELECT MAX(token_no) AS maxToken FROM walkin_queue", [], (err, row) => {
    if (err) return sendError(res, err);
    const nextToken = (row?.maxToken || 0) + 1;
    db.run("INSERT INTO walkin_queue(token_no, user_id, doctor_id) VALUES (?, ?, ?)",
      [nextToken, user_id || null, doctor_id || null],
      function(err) {
        if (err) return sendError(res, err);
        io.emit('queue-update');
        res.json({ token_no: nextToken });
      });
  });
});

// queue list
app.get('/api/queue', (req, res) => {
  db.all("SELECT * FROM walkin_queue ORDER BY token_no ASC", [], (err, rows) => {
    if (err) return sendError(res, err);
    res.json(rows);
  });
});

// call next
app.post('/api/call-next', (req, res) => {
  db.get("SELECT * FROM walkin_queue WHERE status='waiting' ORDER BY token_no LIMIT 1", [], (err, row) => {
    if (err) return sendError(res, err);
    if (!row) return res.json({ message: "No waiting patients!" });

    db.run("UPDATE walkin_queue SET status='called' WHERE id=?", [row.id], function(err) {
      if (err) return sendError(res, err);

      io.emit("queue-update");
      io.emit("call-update", row.token_no);

      res.json({ message: "Next patient called!", token_no: row.token_no });
    });
  });
});

// current token
app.get('/api/current-token', (req, res) => {
  db.get("SELECT * FROM walkin_queue WHERE status='called' ORDER BY token_no DESC LIMIT 1", [], (err, row) => {
    if (err) return sendError(res, err);
    if (!row) return res.json({ token_no: null });
    res.json({ token_no: row.token_no });
  });
});

// eta
app.get('/api/eta/:token_no', (req, res) => {
  const token = req.params.token_no;
  db.get("SELECT avg_service_time_minutes FROM settings WHERE id=1", [], (err, s) => {
    if (err) return sendError(res, err);
    db.get("SELECT COUNT(*) AS ahead FROM walkin_queue WHERE status='waiting' AND token_no < ?", [token], (err, row) => {
      if (err) return sendError(res, err);
      const eta = (row.ahead || 0) * (s?.avg_service_time_minutes || 10);
      res.json({ eta_minutes: eta });
    });
  });
});

// appointments for user
app.get('/api/appointments/:user_id', (req, res) => {
  db.all("SELECT a.*, d.name as doctor_name FROM appointments a LEFT JOIN doctors d ON a.doctor_id = d.id WHERE user_id=?", [req.params.user_id], (err, rows) => {
    if (err) return sendError(res, err);
    res.json(rows);
  });
});

// staff login
app.post('/api/staff/login', (req, res) => {
  const { username, password } = req.body;
  if (username === "admin" && password === "admin123") {
    const token = jwt.sign({ role: "staff", username }, JWT_SECRET, { expiresIn: "8h" });
    res.json({ token });
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

// daily reset
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    db.run("DELETE FROM walkin_queue", [], (err) => {
      if (!err) io.emit("queue-update");
      console.log("Queue reset at midnight");
    });
  }
}, 60000);

// error handler
app.use((err, req, res, next) => {
  console.error(err && err.stack ? err.stack : err);
  res.status(500).json({ message: "Internal Server Error" });
});

http.listen(PORT, () => {
  console.log("Server running at http://localhost:" + PORT);
});
