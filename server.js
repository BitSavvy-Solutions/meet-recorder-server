const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
// --- NEW: Import Uploader ---
const { uploadToAzure } = require('./uploader'); 

const app = express();
const PORT = 3001;

// --- SETUP DIRECTORIES & DB ---
if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');
if (!fs.existsSync('./signals')) fs.mkdirSync('./signals');
if (!fs.existsSync('./recordings')) fs.mkdirSync('./recordings');
if (!fs.existsSync('./history.json')) fs.writeFileSync('./history.json', '[]');

app.use('/recordings', express.static(path.join(__dirname, 'recordings')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const activeRecordings = {};

const getHistory = () => JSON.parse(fs.readFileSync('./history.json'));
const saveHistory = (record) => {
    const history = getHistory();
    history.unshift(record);
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
        ${Object.keys(activeRecordings).length > 0 ? '<meta http-equiv="refresh" content="5">' : ''}
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; background: #f4f4f9; color: #333; }
            .container { max-width: 1000px; margin: 0 auto; }
            .header { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; }
            h1 { margin: 0 0 15px 0; font-size: 24px; }
            .input-group { display: flex; gap: 10px; }
            input[type="text"] { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; }
            button.btn-start { background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; }
            .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
            .status-live { color: #28a745; font-weight: bold; }
            .btn-stop { background: #dc3545; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px; }
            .btn-download { text-decoration: none; background: #007bff; color: white; padding: 6px 12px; border-radius: 4px; font-size: 14px; }
            .btn-cloud { text-decoration: none; background: #6f42c1; color: white; padding: 6px 12px; border-radius: 4px; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎥 Start New Recording</h1>
                <form action="/api/start" method="POST" class="input-group">
                    <input type="text" name="roomInput" placeholder="Enter Meeting URL or Room Name" required>
                    <button type="submit" class="btn-start">Start Recording</button>
                </form>
            </div>

            <div class="card">
                <h2>🔴 Live Recordings (${Object.keys(activeRecordings).length})</h2>
                <table>
                    <thead><tr><th>Room</th><th>Started At</th><th>Duration</th><th>Action</th></tr></thead>
                    <tbody>
                        ${Object.keys(activeRecordings).map(room => {
                            const rec = activeRecordings[room];
                            const duration = Math.floor((Date.now() - rec.startTime) / 1000);
                            return `<tr>
                                <td><strong>${room}</strong></td>
                                <td>${new Date(rec.startTime).toLocaleTimeString()}</td>
                                <td class="status-live">${Math.floor(duration/60)}m ${duration%60}s</td>
                                <td><button class="btn-stop" onclick="stopRecording('${room}')">Stop</button></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="card">
                <h2>📂 Recording History</h2>
                <table>
                    <thead><tr><th>Room</th><th>Date</th><th>Duration</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${history.map(h => `
                        <tr>
                            <td>${h.room}</td>
                            <td>${new Date(h.startTime).toLocaleString()}</td>
                            <td>${h.duration}</td>
                            <td>
                                <a href="/recordings/${h.filename}" class="btn-download" target="_blank">Local</a>
                                ${h.azureUrl ? `<a href="${h.azureUrl}" class="btn-cloud" target="_blank">Azure Cloud</a>` : '<span style="color:#999; font-size:12px;">Uploading...</span>'}
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
    let room = input;
    if (input.includes('://')) {
        const urlParts = input.split('/');
        room = urlParts[urlParts.length - 1];
        if (input.includes('/moderated/')) room = 'moderated/' + urlParts[urlParts.length - 1];
    }

    if (!room || activeRecordings[room]) return res.redirect('/');

    const safeName = room.replace(/[^a-zA-Z0-9]/g, '-');
    const out = fs.openSync(`./logs/${safeName}.log`, 'a');
    const err = fs.openSync(`./logs/${safeName}.log`, 'a');

    if (fs.existsSync(`./signals/stop-${safeName}`)) fs.unlinkSync(`./signals/stop-${safeName}`);

    const bot = spawn('xvfb-run', [
        '--auto-servernum', '-s', '-screen 0 1920x1080x24', 
        'node', 'bot.js', room
    ], { detached: true, stdio: ['ignore', out, err] });

    const startTime = Date.now();
    activeRecordings[room] = { startTime: startTime, pid: bot.pid };

    // --- HANDLE COMPLETION & UPLOAD ---
    bot.on('exit', async (code) => { // Made async
        console.log(`[API] Bot for ${room} exited.`);
        
        const durationSec = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;

        const files = fs.readdirSync('./recordings')
            .filter(f => f.startsWith(safeName) && f.endsWith('.mp4'))
            .sort().reverse();
        
        const filename = files.length > 0 ? files[0] : null;

        if (filename) {
            const localPath = path.join(__dirname, 'recordings', filename);
            
            // 1. Save Local History first (so user sees it immediately)
            const historyRecord = {
                room: room,
                startTime: startTime,
                duration: `${mins}m ${secs}s`,
                filename: filename,
                azureUrl: null // Placeholder
            };
            saveHistory(historyRecord);

            // 2. Trigger Azure Upload
            console.log(`[SERVER] Starting upload for ${filename}...`);
            const publicUrl = await uploadToAzure(safeName, localPath);

            // 3. Update History with Azure URL
            if (publicUrl) {
                const currentHistory = getHistory();
                // Find the record we just added (it's at index 0 usually, but let's be safe)
                const recordIndex = currentHistory.findIndex(h => h.filename === filename);
                if (recordIndex !== -1) {
                    currentHistory[recordIndex].azureUrl = publicUrl;
                    fs.writeFileSync('./history.json', JSON.stringify(currentHistory, null, 2));
                    console.log(`[SERVER] History updated with Azure URL: ${publicUrl}`);
                }
            }
        }

        delete activeRecordings[room];
    });

    bot.unref();
    res.redirect('/');
});

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