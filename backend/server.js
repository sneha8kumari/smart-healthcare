
require("dotenv").config();
const PORT = process.env.PORT || 5000;

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("./db");

const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: {
        origin: "*"
    }
});

app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
    res.send("Smart Healthcare API Running!");
});

app.post("/api/register", (req, res) => {
    const { name, phone } = req.body;
    db.run(
        "INSERT INTO users(name, phone) VALUES(?, ?)",
        [name, phone],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ user_id: this.lastID, name, phone });
        }
    );
});

app.post("/api/doctors", (req, res) => {
    const { name, department, working_start, working_end } = req.body;
    db.run(
        "INSERT INTO doctors(name, department, working_start, working_end) VALUES(?, ?, ?, ?)",
        [name, department, working_start, working_end],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ doctor_id: this.lastID });
        }
    );
});

app.post("/api/appointments", (req, res) => {
    const { user_id, doctor_id, date, time } = req.body;
    db.run(
        "INSERT INTO appointments(user_id, doctor_id, date, time) VALUES(?, ?, ?, ?)",
        [user_id, doctor_id, date, time],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ appointment_id: this.lastID });
        }
    );
});

app.post("/api/walkin", (req, res) => {
    const { user_id, doctor_id } = req.body;

    db.get(
        "SELECT MAX(token_no) AS maxToken FROM walkin_queue",
        [],
        (err, row) => {
            const nextToken = (row?.maxToken || 0) + 1;

            db.run(
                "INSERT INTO walkin_queue(token_no, user_id, doctor_id) VALUES (?, ?, ?)",
                [nextToken, user_id, doctor_id],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    res.json({ token_no: nextToken });
                }
            );
        }
    );
});
app.post("/api/call-next", (req, res) => {
    db.get(
        "SELECT * FROM walkin_queue WHERE status='waiting' ORDER BY token_no LIMIT 1",
        [],
        (err, row) => {
            if (!row) return res.json({ message: "No waiting patients!" });

            db.run(
                "UPDATE walkin_queue SET status='called' WHERE id=?",
                [row.id],
                () => {
                    io.emit("queue-update"); 
                    io.emit("call-update", row.token_no);

    
                    res.json({
                        message: "Next patient called!",
                        token_no: row.token_no
                    });
                }
            );
        }
    );
});
app.get("/api/current-token", (req, res) => {
    db.get(
        "SELECT * FROM walkin_queue WHERE status='called' ORDER BY token_no DESC LIMIT 1",
        [],
        (err, row) => {
            if (!row) return res.json({ token_no: null });
            res.json({ token_no: row.token_no });
        }
    );
});
app.get("/api/eta/:token_no", (req, res) => {
    const token = req.params.token_no;

    db.get("SELECT avg_service_time_minutes FROM settings WHERE id=1", [], (err, s) => {
        db.get(
            "SELECT COUNT(*) AS ahead FROM walkin_queue WHERE status='waiting' AND token_no < ?",
            [token],
            (err, row) => {
                const eta = row.ahead * s.avg_service_time_minutes;
                res.json({ eta_minutes: eta });
            }
        );
    });
});
app.get("/api/appointments/:user_id", (req, res) => {
    db.all(
        "SELECT * FROM appointments WHERE user_id=?",
        [req.params.user_id],
        (err, rows) => {
            res.json(rows);
        }
    );
});

app.post("/api/cancel/:id", (req, res) => {
    db.run(
        "UPDATE appointments SET status='cancelled' WHERE id=?",
        [req.params.id],
        () => {
            res.json({ message: "Cancelled" });
        }
    );
});
const jwt = require("jsonwebtoken");

// STAFF LOGIN (username: admin, password: admin123)
app.post("/api/staff/login", (req, res) => {
    const { username, password } = req.body;

    if (username === "admin" && password === "admin123") {
        const token = jwt.sign({ role: "staff" }, process.env.JWT_SECRET, {
            expiresIn: "8h",
        });
        res.json({ token });
    } else {
        res.status(401).json({ message: "Invalid credentials" });
    }
});
function verifyStaff(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token provided" });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ message: "Invalid token" });
        next();
    });
}
// ------------------ DAILY QUEUE RESET AT MIDNIGHT ---------------------
setInterval(() => {
    const now = new Date();

    // If time is 00:00 (midnight)
    if (now.getHours() === 0 && now.getMinutes() === 0) {
        db.run("DELETE FROM walkin_queue"); // Clear queue
        io.emit("queue-update");            // Notify all dashboards
        console.log("Queue reset at midnight 🚀");
    }
}, 60000); // Check every 60 seconds

http.listen(PORT, () => {
    console.log("Server running on port", PORT);
});

