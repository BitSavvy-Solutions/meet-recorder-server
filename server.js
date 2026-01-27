const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // REQUIRED: npm install axios

const app = express();
const PORT = 3001;

// --- CONFIGURATION ---
// Based on your docker-compose, your n8n is at auto.bitsavvy.ca
// Ensure your n8n Webhook node is set to POST and path is 'process-meeting'
const N8N_WEBHOOK_URL = 'https://auto.bitsavvy.ca/webhook/process-meeting';

// --- DIRECTORIES ---
const LOGS_DIR = path.join(__dirname, 'logs');
const SIGNALS_DIR = path.join(__dirname, 'signals');
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const HISTORY_FILE = path.join(__dirname, 'history.json');

// --- SETUP ---
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);
if (!fs.existsSync(SIGNALS_DIR)) fs.mkdirSync(SIGNALS_DIR);
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR);
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]');

app.use('/recordings', express.static(RECORDINGS_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const activeRecordings = {};

// --- HISTORY HELPERS ---
const getHistory = () => {
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE)); } catch (e) { return []; }
};

const saveHistory = (record) => {
    const history = getHistory();
    history.unshift(record);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
};

// --- DASHBOARD UI ---
app.get('/', (req, res) => {
    const history = getHistory();
    const isRecording = Object.keys(activeRecordings).length > 0;

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>BitSavvy Recorder</title>
        ${isRecording ? '<meta http-equiv="refresh" content="5">' : ''}
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; background: #f4f4f9; color: #333; }
            .container { max-width: 1200px; margin: 0 auto; }
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
            .btn-download { text-decoration: none; background: #007bff; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px; }
            .badge-sent { background: #17a2b8; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
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
                    <thead><tr><th>Room</th><th>Date</th><th>Duration</th><th>Files</th><th>Automation Status</th></tr></thead>
                    <tbody>
                        ${history.map(h => {
                            const files = h.files || {}; 
                            return `
                            <tr>
                                <td>${h.room}</td>
                                <td>${new Date(h.startTime).toLocaleString()}</td>
                                <td>${h.duration}</td>
                                <td>
                                    ${files.mp4 ? `<a href="/recordings/${files.mp4}" class="btn-download" target="_blank">MP4</a>` : ''}
                                    ${files.mp3 ? `<a href="/recordings/${files.mp3}" class="btn-download" target="_blank">MP3</a>` : ''}
                                </td>
                                <td>
                                    ${h.n8nTriggered ? '<span class="badge-sent">🚀 Sent to n8n</span>' : '<span style="color:red">❌ Failed</span>'}
                                </td>
                            </tr>`;
                        }).join('')}
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
        if (input.includes('/moderated/')) {
            room = 'moderated/' + urlParts[urlParts.length - 1];
        }
    }

    if (!room || activeRecordings[room]) return res.redirect('/');

    const safeName = room.replace(/[^a-zA-Z0-9]/g, '-');
    const out = fs.openSync(path.join(LOGS_DIR, `${safeName}.log`), 'a');
    const err = fs.openSync(path.join(LOGS_DIR, `${safeName}.log`), 'a');

    const signalFile = path.join(SIGNALS_DIR, `stop-${safeName}`);
    if (fs.existsSync(signalFile)) fs.unlinkSync(signalFile);

    // 2560x1440 is much sharper than 1080p but lighter than 4K
    const bot = spawn('xvfb-run', [
        '--auto-servernum', '-s', '-screen 0 2560x1440x24', 
        'node', 'bot.js', room
    ], { detached: true, stdio: ['ignore', out, err] });

    const startTime = Date.now();
    activeRecordings[room] = { startTime: startTime, pid: bot.pid };

    // --- HANDLE COMPLETION & TRIGGER N8N ---
    bot.on('exit', async (code) => {
        console.log(`[API] Bot for ${room} exited.`);
        
        const durationSec = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        const durationStr = `${mins}m ${secs}s`;

        const allFiles = fs.readdirSync(RECORDINGS_DIR);
        
        // Find the files
        const mp4File = allFiles.filter(f => f.startsWith(safeName) && f.endsWith('.mp4')).sort().reverse()[0];
        const mp3File = allFiles.filter(f => f.startsWith(safeName) && f.endsWith('.mp3')).sort().reverse()[0];

        let n8nTriggered = false;

        if (mp3File && mp4File) {
            console.log(`[SERVER] Found audio: ${mp3File}. Triggering n8n...`);
            console.log(`[SERVER] Found audio: ${mp4File}. Triggering n8n...`);

            try {
                // SEND JSON PAYLOAD (Pass by Reference)
                await axios.post(N8N_WEBHOOK_URL, {
                    audioFileName: mp3File, 
                    roomName: room,
                    videoFileName: mp4File,
                    duration: durationStr
                });
                console.log(`[SERVER] ✅ Successfully triggered n8n workflow.`);
                n8nTriggered = true;
            } catch (error) {
                console.error(`[SERVER] ❌ Failed to trigger n8n: ${error.message}`);
            }
        }

        // Save History
        saveHistory({
            room: room,
            startTime: startTime,
            duration: durationStr,
            files: { mp4: mp4File || null, mp3: mp3File || null },
            n8nTriggered: n8nTriggered
        });

        delete activeRecordings[room];
    });

    bot.unref();
    res.redirect('/');
});

app.post('/api/stop', (req, res) => {
    const room = req.body.room;
    if (activeRecordings[room]) {
        const safeName = room.replace(/[^a-zA-Z0-9]/g, '-');
        const signalFile = path.join(SIGNALS_DIR, `stop-${safeName}`);
        fs.closeSync(fs.openSync(signalFile, 'w'));
        res.send({ success: true });
    } else {
        res.status(404).send({ error: "Room not found" });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Dashboard running on port ${PORT}`);
});