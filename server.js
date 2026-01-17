const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const app = express();
const PORT = 3001;

// Ensure directories exist
if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');
if (!fs.existsSync('./signals')) fs.mkdirSync('./signals');

// Store active recordings: { roomName: { startTime, pid } }
// We use roomName as the key now because it's more reliable than PID with xvfb
const activeRecordings = {};

app.use(express.json());

// --- DASHBOARD ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>BitSavvy Recorder</title>
        <meta http-equiv="refresh" content="3">
        <style>
            body { font-family: sans-serif; padding: 20px; background: #f4f4f9; }
            .container { max-width: 900px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #007bff; color: white; }
            .btn-stop { background: #dc3545; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 4px; }
            .btn-stop:hover { background: #c82333; }
            .status-live { color: green; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔴 Recorder Dashboard</h1>
            <table>
                <thead>
                    <tr>
                        <th>Room</th>
                        <th>Started At</th>
                        <th>Duration</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.keys(activeRecordings).length === 0 ? '<tr><td colspan="4" style="text-align:center;padding:20px;">No active recordings.</td></tr>' : ''}
                    
                    ${Object.keys(activeRecordings).map(room => {
                        const rec = activeRecordings[room];
                        const duration = Math.floor((Date.now() - rec.startTime) / 1000);
                        const minutes = Math.floor(duration / 60);
                        const seconds = duration % 60;
                        return `
                        <tr>
                            <td><strong>${room}</strong></td>
                            <td>${new Date(rec.startTime).toLocaleTimeString()}</td>
                            <td class="status-live">${minutes}m ${seconds}s</td>
                            <td>
                                <button class="btn-stop" onclick="stopRecording('${room}')">Stop Recording</button>
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
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

// --- JOIN API ---
app.get('/join', (req, res) => {
    const room = req.query.room;
    if (!room) return res.status(400).send('Error: Specify room');

    // Prevent duplicate recordings for the same room
    if (activeRecordings[room]) {
        return res.redirect('/');
    }

    const safeName = room.replace(/[^a-zA-Z0-9]/g, '-');
    const out = fs.openSync(`./logs/${safeName}.log`, 'a');
    const err = fs.openSync(`./logs/${safeName}.log`, 'a');

    // Remove any old signal files for this room
    if (fs.existsSync(`./signals/stop-${safeName}`)) fs.unlinkSync(`./signals/stop-${safeName}`);

    const bot = spawn('xvfb-run', [
        '--auto-servernum', '-s', '-screen 0 1920x1080x24', 
        'node', 'bot.js', room
    ], {
        detached: true,
        stdio: ['ignore', out, err]
    });

    activeRecordings[room] = {
        startTime: Date.now(),
        pid: bot.pid
    };

    // When the bot process actually exits (crashes or stops), remove from list
    bot.on('exit', () => {
        console.log(`[API] Bot for ${room} exited.`);
        delete activeRecordings[room];
    });

    bot.unref();
    res.redirect('/');
});

// --- STOP API (SIGNAL METHOD) ---
app.post('/api/stop', (req, res) => {
    const room = req.body.room;
    if (activeRecordings[room]) {
        const safeName = room.replace(/[^a-zA-Z0-9]/g, '-');
        const signalFile = `./signals/stop-${safeName}`;
        
        // Create the signal file
        fs.closeSync(fs.openSync(signalFile, 'w'));
        console.log(`[API] Signal sent to stop: ${room}`);
        
        // We don't delete from activeRecordings here. 
        // We wait for the bot to exit naturally, which triggers the bot.on('exit') above.
        res.send({ success: true });
    } else {
        res.status(404).send({ error: "Room not found" });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Dashboard running on port ${PORT}`);
});