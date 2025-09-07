const express = require('express');
const cors = require("cors");

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;
app.use(cors());
app.use(express.json());

// Connect to SQLite DB
const dbPath = path.resolve(__dirname, 'campus_events.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("❌ Error opening DB:", err.message);
    else console.log("✅ Connected to SQLite database at", dbPath);
});

/* -------------------- EVENTS -------------------- */
app.post('/events', (req, res) => {
    const { college_id, title, description, event_type, start_date, end_date } = req.body;
    if (!college_id || !title) return res.status(400).json({ error: "college_id and title are required" });

    db.run(
        `INSERT INTO Events (college_id, title, description, event_type, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [college_id, title, description, event_type, start_date, end_date],
        function (err) {
            if (err) return res.status(500).json({ error: "Failed to create event", details: err.message });
            res.json({ message: "✅ Event created", event_id: this.lastID });
        }
    );
});

app.get('/events', (req, res) => {
    db.all("SELECT * FROM Events", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch events" });
        res.json(rows);
    });
});

/* -------------------- STUDENTS -------------------- */
app.post('/students', (req, res) => {
    const { college_id, name, email, year, department } = req.body;
    if (!college_id || !name || !email) return res.status(400).json({ error: "college_id, name, and email are required" });

    db.run(
        `INSERT INTO Students (college_id, name, email, year, department)
         VALUES (?, ?, ?, ?, ?)`,
        [college_id, name, email, year, department],
        function (err) {
            if (err) {
                if (err.message.includes("UNIQUE constraint failed: Students.email")) {
                    return res.status(400).json({ error: "⚠️ Email already exists. Please use a different one." });
                }
                return res.status(500).json({ error: "Failed to add student", details: err.message });
            }
            res.json({ message: "✅ Student added", student_id: this.lastID });
        }
    );
});

/* -------------------- REGISTRATIONS -------------------- */
app.post('/register', (req, res) => {
    const { student_id, event_id } = req.body;
    if (!student_id || !event_id) return res.status(400).json({ error: "student_id and event_id are required" });

    db.run(
        `INSERT INTO Registrations (student_id, event_id) VALUES (?, ?)`,
        [student_id, event_id],
        function (err) {
            if (err) {
                if (err.message.includes("UNIQUE constraint failed")) {
                    return res.status(400).json({ error: "⚠️ Student is already registered for this event" });
                }
                return res.status(500).json({ error: "Failed to register student", details: err.message });
            }
            res.json({ message: "✅ Student registered", registration_id: this.lastID });
        }
    );
});

/* -------------------- ATTENDANCE -------------------- */
app.post('/attendance', (req, res) => {
    const { registration_id, attended, checkin_time } = req.body;
    if (!registration_id) return res.status(400).json({ error: "registration_id is required" });

    db.run(
        `INSERT INTO Attendance (registration_id, attended, checkin_time)
         VALUES (?, ?, ?)`,
        [registration_id, attended || 0, checkin_time || null],
        function (err) {
            if (err) {
                if (err.message.includes("FOREIGN KEY constraint failed")) {
                    return res.status(400).json({ error: "⚠️ Invalid registration_id. Please register student first." });
                }
                return res.status(500).json({ error: "Failed to mark attendance", details: err.message });
            }
            res.json({ message: "✅ Attendance marked", attendance_id: this.lastID });
        }
    );
});

/* -------------------- FEEDBACK -------------------- */
app.post('/feedback', (req, res) => {
    const { registration_id, rating, comments } = req.body;
    if (!registration_id || !rating) return res.status(400).json({ error: "registration_id and rating are required" });

    db.run(
        `INSERT INTO Feedback (registration_id, rating, comments)
         VALUES (?, ?, ?)`,
        [registration_id, rating, comments || null],
        function (err) {
            if (err) {
                if (err.message.includes("FOREIGN KEY constraint failed")) {
                    return res.status(400).json({ error: "⚠️ Invalid registration_id. Please register student first." });
                }
                return res.status(500).json({ error: "Failed to submit feedback", details: err.message });
            }
            res.json({ message: "✅ Feedback submitted", feedback_id: this.lastID });
        }
    );
});

/* -------------------- REPORTS -------------------- */

// 1. Popular Events Report
app.get('/reports/popular-events', (req, res) => {
    db.all(
        `SELECT e.title, COUNT(r.registration_id) AS total_registrations
         FROM Events e
         LEFT JOIN Registrations r ON e.event_id = r.event_id
         GROUP BY e.event_id
         ORDER BY total_registrations DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Failed to generate report", details: err.message });
            res.json(rows);
        }
    );
});

// 2. Student Participation Report
app.get('/reports/student-participation', (req, res) => {
    db.all(
        `SELECT s.name, COUNT(a.attendance_id) AS events_attended
         FROM Students s
         JOIN Registrations r ON s.student_id = r.student_id
         JOIN Attendance a ON r.registration_id = a.registration_id
         WHERE a.attended = 1
         GROUP BY s.student_id
         ORDER BY events_attended DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Failed to generate report", details: err.message });
            res.json(rows);
        }
    );
});

// 3. Top 3 Most Active Students
app.get('/reports/top-students', (req, res) => {
    db.all(
        `SELECT s.name, COUNT(a.attendance_id) AS events_attended
         FROM Students s
         JOIN Registrations r ON s.student_id = r.student_id
         JOIN Attendance a ON r.registration_id = a.registration_id
         WHERE a.attended = 1
         GROUP BY s.student_id
         ORDER BY events_attended DESC
         LIMIT 3`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Failed to generate report", details: err.message });
            res.json(rows);
        }
    );
});

// Get all registrations for a student
app.get("/students/:student_id/registrations", (req, res) => {
    const { student_id } = req.params;

    db.all(
        `SELECT r.registration_id, e.title, e.event_type, e.start_date, e.end_date
         FROM Registrations r
         JOIN Events e ON r.event_id = e.event_id
         WHERE r.student_id = ?`,
        [student_id],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: "Failed to fetch registrations", details: err.message });
            }
            res.json(rows);
        }
    );
});

// Get all events with registrations count
app.get("/admin/events", (req, res) => {
    db.all(
        `SELECT e.event_id, e.title, e.event_type, COUNT(r.registration_id) AS total_registrations
         FROM Events e
         LEFT JOIN Registrations r ON e.event_id = r.event_id
         GROUP BY e.event_id`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Failed to fetch events", details: err.message });
            res.json(rows);
        }
    );
});

// Get students registered for a specific event
app.get("/admin/events/:event_id/registrations", (req, res) => {
    const { event_id } = req.params;
    db.all(
        `SELECT r.registration_id, s.name, s.department, s.year, a.attended
         FROM Registrations r
         JOIN Students s ON r.student_id = s.student_id
         LEFT JOIN Attendance a ON r.registration_id = a.registration_id
         WHERE r.event_id = ?`,
        [event_id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Failed to fetch registrations", details: err.message });
            res.json(rows);
        }
    );
});

// Mark attendance for a registration
app.post("/admin/attendance", (req, res) => {
    const { registration_id, attended } = req.body;

    if (!registration_id || attended === undefined) {
        return res.status(400).json({ error: "registration_id and attended are required" });
    }

    db.run(
        `INSERT INTO Attendance (registration_id, attended, checkin_time)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(registration_id) DO UPDATE SET attended = excluded.attended, checkin_time = excluded.checkin_time`,
        [registration_id, attended],
        function (err) {
            if (err) return res.status(500).json({ error: "Failed to mark attendance", details: err.message });
            res.json({ message: "✅ Attendance updated", registration_id });
        }
    );
});



/* -------------------- SERVER -------------------- */
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
