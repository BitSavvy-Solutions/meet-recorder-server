const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3001;

// --- SETUP DIRECTORIES & DB ---
if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');
if (!fs.existsSync('./signals')) fs.mkdirSync('./signals');
if (!fs.existsSync('./recordings')) fs.mkdirSync('./recordings');
if (!fs.existsSync('./history.json')) fs.writeFileSync('./history.json', '[]');

// Serve the recordings folder so we can watch/download videos
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-Memory Active List
const activeRecordings = {};

// Helper to read/write history
const getHistory = () => JSON.parse(fs.readFileSync('./history.json'));
const saveHistory = (record) => {
    const history = getHistory();
    history.unshift(record); // Add to top
    fs.writeFileSync('./history.json', JSON.stringify(history, null, 2));
};

// --- DASHBOARD UI ---
app.get('/', (req, res) => {
    const history = getHistory();
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>BitSavvy Recorder</title>
        <!-- Refresh only if there are active recordings to update status -->
        ${Object.keys(activeRecordings).length > 0 ? '<meta http-equiv="refresh" content="5">' : ''}
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; background: #f4f4f9; color: #333; }
            .container { max-width: 1000px; margin: 0 auto; }
            
            /* Header & Form */
            .header { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; }
            h1 { margin: 0 0 15px 0; font-size: 24px; }
            .input-group { display: flex; gap: 10px; }
            input[type="text"] { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; }
            button.btn-start { background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; }
            button.btn-start:hover { background: #218838; }

            /* Tables */
            .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; }
            h2 { margin-top: 0; font-size: 18px; border-bottom: 2px solid #f4f4f9; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
            th { color: #666; font-weight: 600; font-size: 14px; }
            
            /* Status & Buttons */
            .status-live { color: #28a745; font-weight: bold; display: flex; align-items: center; gap: 5px; }
            .status-live::before { content: ''; display: block; width: 8px; height: 8px; background: #28a745; border-radius: 50%; }
            .btn-stop { background: #dc3545; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px; }
            .btn-download { text-decoration: none; background: #007bff; color: white; padding: 6px 12px; border-radius: 4px; font-size: 14px; }
            .btn-download:hover { background: #0056b3; }
            .timestamp { color: #888; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            
            <!-- START FORM -->
            <div class="header">
                <h1>🎥 Start New Recording</h1>
                <form action="/api/start" method="POST" class="input-group">
                    <input type="text" name="roomInput" placeholder="Enter Meeting URL (e.g. https://meet.jit.si/Daily) or Room Name" required>
                    <button type="submit" class="btn-start">Start Recording</button>
                </form>
            </div>

            <!-- ACTIVE RECORDINGS -->
            <div class="card">
                <h2>🔴 Live Recordings (${Object.keys(activeRecordings).length})</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Room Name</th>
                            <th>Started At</th>
                            <th>Duration</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.keys(activeRecordings).length === 0 ? '<tr><td colspan="4" style="text-align:center; color:#999;">No active recordings.</td></tr>' : ''}
                        
                        ${Object.keys(activeRecordings).map(room => {
                            const rec = activeRecordings[room];
                            const duration = Math.floor((Date.now() - rec.startTime) / 1000);
                            const mins = Math.floor(duration / 60);
                            const secs = duration % 60;
                            return `
                            <tr>
                                <td><strong>${room}</strong></td>
                                <td>${new Date(rec.startTime).toLocaleTimeString()}</td>
                                <td class="status-live">${mins}m ${secs}s</td>
                                <td><button class="btn-stop" onclick="stopRecording('${room}')">Stop</button></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <!-- HISTORY -->
            <div class="card">
                <h2>📂 Recording History</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Room Name</th>
                            <th>Date</th>
                            <th>Duration</th>
                            <th>Recording</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${history.length === 0 ? '<tr><td colspan="4" style="text-align:center; color:#999;">No history yet.</td></tr>' : ''}

                        ${history.map(h => `
                        <tr>
                            <td>${h.room}</td>
                            <td class="timestamp">${new Date(h.startTime).toLocaleString()}</td>
                            <td>${h.duration}</td>
                            <td>
                                <a href="/recordings/${h.filename}" class="btn-download" target="_blank">Download / Play</a>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>

        </div>

        <script>
            function stopRecording(room) {
                if(confirm('Stop recording for ' + room + '?')) {
                    fetch('/api/stop', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ room: room })
                    }).then(() => window.location.reload());
                }
            }
        </script>
    </body>
    </html>
    `);
});

// --- API: START RECORDING ---
app.post('/api/start', (req, res) => {
    let input = req.body.roomInput.trim();
    
    // Logic to extract Room Name from URL
    // Removes "https://meet.jit.si/" or "http://..."
    let room = input;
    if (input.includes('://')) {
        const urlParts = input.split('/');
        // Get the last part (e.g. "MyRoom" from "meet.jit.si/MyRoom")
        room = urlParts[urlParts.length - 1];
        // Handle "moderated/123" case
        if (input.includes('/moderated/')) {
            room = 'moderated/' + urlParts[urlParts.length - 1];
        }
    }

    if (!room) return res.redirect('/');
    if (activeRecordings[room]) return res.redirect('/'); // Already recording

    const safeName = room.replace(/[^a-zA-Z0-9]/g, '-');
    const out = fs.openSync(`./logs/${safeName}.log`, 'a');
    const err = fs.openSync(`./logs/${safeName}.log`, 'a');

    // Remove old signal
    if (fs.existsSync(`./signals/stop-${safeName}`)) fs.unlinkSync(`./signals/stop-${safeName}`);

    const bot = spawn('xvfb-run', [
        '--auto-servernum', '-s', '-screen 0 1920x1080x24', 
        'node', 'bot.js', room
    ], {
        detached: true,
        stdio: ['ignore', out, err]
    });

    const startTime = Date.now();

    activeRecordings[room] = {
        startTime: startTime,
        pid: bot.pid
    };

    // --- HANDLE COMPLETION ---
    bot.on('exit', (code) => {
        console.log(`[API] Bot for ${room} exited.`);
        
        // Calculate duration
        const durationSec = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;

        // Find the file (we guess the name based on bot.js logic)
        // Note: bot.js uses Date.now(), so exact match is hard. 
        // We look for the most recent file matching the room name.
        const files = fs.readdirSync('./recordings')
            .filter(f => f.startsWith(safeName) && f.endsWith('.mp4'))
            .sort().reverse(); // Newest first
        
        const filename = files.length > 0 ? files[0] : null;

        if (filename) {
            saveHistory({
                room: room,
                startTime: startTime,
                duration: `${mins}m ${secs}s`,
                filename: filename
            });
        }

        delete activeRecordings[room];
    });

    bot.unref();
    res.redirect('/');
});

// --- API: STOP RECORDING ---
app.post('/api/stop', (req, res) => {
    const room = req.body.room;
    if (activeRecordings[room]) {
        const safeName = room.replace(/[^a-zA-Z0-9]/g, '-');
        const signalFile = `./signals/stop-${safeName}`;
        fs.closeSync(fs.openSync(signalFile, 'w'));
        res.send({ success: true });
    } else {
        res.status(404).send({ error: "Room not found" });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Dashboard running on port ${PORT}`);
});