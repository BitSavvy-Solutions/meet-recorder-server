const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- MODULE IMPORTS ---
const { uploadToAzure } = require('./uploader'); 
const { transcribeAudio } = require('./transcriber');
const { createOutlinePage } = require('./outline');

const app = express();
const PORT = 3001;

// --- FIX: USE ABSOLUTE PATHS ---
const LOGS_DIR = path.join(__dirname, 'logs');
const SIGNALS_DIR = path.join(__dirname, 'signals');
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const HISTORY_FILE = path.join(__dirname, 'history.json');

// --- SETUP DIRECTORIES & DB ---
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);
if (!fs.existsSync(SIGNALS_DIR)) fs.mkdirSync(SIGNALS_DIR);
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR);
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]');

app.use('/recordings', express.static(RECORDINGS_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const activeRecordings = {};

// --- FIX: READ/WRITE TO ABSOLUTE PATH ---
const getHistory = () => {
    try {
        return JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch (e) {
        return [];
    }
};

const saveHistory = (record) => {
    const history = getHistory();
    history.unshift(record);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
};

// --- DASHBOARD UI ---
app.get('/', (req, res) => {
    const history = getHistory();
    
    // Auto-refresh if recording is active OR transcription is processing
    const isProcessing = Object.keys(activeRecordings).length > 0 || history.some(h => h.transcription && h.transcription.status === 'processing');

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>BitSavvy Recorder</title>
        ${isProcessing ? '<meta http-equiv="refresh" content="5">' : ''}
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
            .btn-cloud { text-decoration: none; background: #6f42c1; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
            .btn-view { text-decoration: none; background: #17a2b8; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
            .btn-outline { text-decoration: none; background: #2c3e50; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
            .badge-wait { background: #ffc107; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
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
                    <thead><tr><th>Room</th><th>Date</th><th>Duration</th><th>Video (MP4)</th><th>Audio (MP3)</th><th>Transcription</th><th>Outline</th></tr></thead>
                    <tbody>
                        ${history.map(h => {
                            const files = h.files || {}; 
                            const cloud = h.cloud || {};
                            const trans = h.transcription || { status: 'none' };
                            
                            let transHtml = '<span style="color:#ccc">-</span>';
                            if(trans.status === 'processing') transHtml = '<span class="badge-wait">⏳ Processing...</span>';
                            if(trans.status === 'completed') transHtml = `<a href="/recordings/${trans.file}" class="btn-view" target="_blank">📄 View Text</a>`;
                            if(trans.status === 'failed') transHtml = '<span style="color:red">❌ Failed</span>';

                            return `
                            <tr>
                                <td>${h.room}</td>
                                <td>${new Date(h.startTime).toLocaleString()}</td>
                                <td>${h.duration}</td>
                                <td>
                                    ${files.mp4 ? `<a href="/recordings/${files.mp4}" class="btn-download" target="_blank">Local</a>` : ''}
                                    ${cloud.mp4 ? `<a href="${cloud.mp4}" class="btn-cloud" target="_blank">Azure</a>` : ''}
                                </td>
                                <td>
                                    ${files.mp3 ? `<a href="/recordings/${files.mp3}" class="btn-download" target="_blank">Local</a>` : ''}
                                    ${cloud.mp3 ? `<a href="${cloud.mp3}" class="btn-cloud" target="_blank">Azure</a>` : ''}
                                </td>
                                <td>${transHtml}</td>
                                <td>
                                    ${h.outlineUrl ? `<a href="${h.outlineUrl}" class="btn-outline" target="_blank">📝 Notes</a>` : '-'}
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
    // FIX: Use absolute path for logs
    const out = fs.openSync(path.join(LOGS_DIR, `${safeName}.log`), 'a');
    const err = fs.openSync(path.join(LOGS_DIR, `${safeName}.log`), 'a');

    const signalFile = path.join(SIGNALS_DIR, `stop-${safeName}`);
    if (fs.existsSync(signalFile)) fs.unlinkSync(signalFile);

    const bot = spawn('xvfb-run', [
        '--auto-servernum', '-s', '-screen 0 1920x1080x24', 
        'node', 'bot.js', room
    ], { detached: true, stdio: ['ignore', out, err] });

    const startTime = Date.now();
    activeRecordings[room] = { startTime: startTime, pid: bot.pid };

    // --- HANDLE COMPLETION & WORKFLOW ---
    bot.on('exit', async (code) => {
        console.log(`[API] Bot for ${room} exited.`);
        
        const durationSec = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        const durationStr = `${mins}m ${secs}s`;

        const allFiles = fs.readdirSync(RECORDINGS_DIR);
        
        const mp4File = allFiles.filter(f => f.startsWith(safeName) && f.endsWith('.mp4')).sort().reverse()[0];
        const mp3File = allFiles.filter(f => f.startsWith(safeName) && f.endsWith('.mp3')).sort().reverse()[0];

        if (mp4File || mp3File) {
            const historyRecord = {
                room: room,
                startTime: startTime,
                duration: durationStr,
                files: { mp4: mp4File || null, mp3: mp3File || null },
                cloud: { mp4: null, mp3: null },
                transcription: { status: 'none', file: null },
                outlineUrl: null
            };
            saveHistory(historyRecord);

            let mp4CloudUrl = null;
            let mp3CloudUrl = null;

            // 2. Upload MP4
            if (mp4File) {
                console.log(`[SERVER] Uploading MP4...`);
                mp4CloudUrl = await uploadToAzure(safeName, path.join(RECORDINGS_DIR, mp4File));
                if (mp4CloudUrl) updateHistoryCloudUrl(mp4File, 'mp4', mp4CloudUrl);
            }

            // 3. Upload MP3 -> Transcribe -> Outline
            if (mp3File) {
                console.log(`[SERVER] Uploading MP3...`);
                mp3CloudUrl = await uploadToAzure(safeName, path.join(RECORDINGS_DIR, mp3File));
                
                if (mp3CloudUrl) {
                    updateHistoryCloudUrl(mp4File, 'mp3', mp3CloudUrl);
                    
                    console.log(`[SERVER] Triggering Transcription...`);
                    updateHistoryTranscriptionStatus(mp4File, 'processing', null);

                    transcribeAudio(mp3CloudUrl).then(async (text) => {
                        if (text) {
                            const txtFilename = mp3File.replace('.mp3', '.txt');
                            fs.writeFileSync(path.join(RECORDINGS_DIR, txtFilename), text);
                            updateHistoryTranscriptionStatus(mp4File, 'completed', txtFilename);
                            
                            console.log(`[SERVER] Creating Outline Document...`);
                            const finalMp4Url = mp4CloudUrl || "#";
                            const dateStr = new Date().toISOString().split('T')[0];

                            const outlineDocUrl = await createOutlinePage(
                                room, 
                                dateStr, 
                                durationStr, 
                                finalMp4Url, 
                                mp3CloudUrl, 
                                text
                            );

                            if (outlineDocUrl) {
                                updateHistoryOutlineUrl(mp4File, outlineDocUrl);
                            }

                        } else {
                            updateHistoryTranscriptionStatus(mp4File, 'failed', null);
                        }
                    });
                }
            }
        }

        delete activeRecordings[room];
    });

    bot.unref();
    res.redirect('/');
});

// --- HELPERS ---

function updateHistoryCloudUrl(keyFile, type, url) {
    const currentHistory = getHistory();
    const recordIndex = currentHistory.findIndex(h => (h.files?.mp4 === keyFile) || (h.files?.mp3 === keyFile));
    if (recordIndex !== -1) {
        if (!currentHistory[recordIndex].cloud) currentHistory[recordIndex].cloud = {};
        currentHistory[recordIndex].cloud[type] = url;
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(currentHistory, null, 2));
    }
}

function updateHistoryTranscriptionStatus(keyFile, status, txtFilename) {
    const currentHistory = getHistory();
    const recordIndex = currentHistory.findIndex(h => (h.files?.mp4 === keyFile) || (h.files?.mp3 === keyFile));
    if (recordIndex !== -1) {
        currentHistory[recordIndex].transcription = {
            status: status,
            file: txtFilename
        };
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(currentHistory, null, 2));
    }
}

function updateHistoryOutlineUrl(keyFile, docUrl) {
    const currentHistory = getHistory();
    const recordIndex = currentHistory.findIndex(h => (h.files?.mp4 === keyFile) || (h.files?.mp3 === keyFile));
    if (recordIndex !== -1) {
        currentHistory[recordIndex].outlineUrl = docUrl;
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(currentHistory, null, 2));
    }
}

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