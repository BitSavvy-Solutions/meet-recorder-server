const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- ARGUMENTS ---
const roomName = process.argv[2];
const outputDir = process.argv[3] || path.join(__dirname, 'recordings');
const safeFilename = process.argv[4] || roomName.replace(/[^a-zA-Z0-9]/g, '-');

if (!roomName) {
    console.error("❌ No room name provided.");
    process.exit(1);
}

const MEETING_URL = `https://meet.jit.si/${roomName}`;

// --- PATHS ---
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const TIMESTAMP = Date.now();
const RECORDING_PATH_MP4 = path.join(outputDir, `${safeFilename}-${TIMESTAMP}.mp4`);
const RECORDING_PATH_MP3 = path.join(outputDir, `${safeFilename}-${TIMESTAMP}.mp3`);
const SIGNALS_DIR = path.join(__dirname, 'signals');
const SIGNAL_FILE = path.join(SIGNALS_DIR, `stop-${safeFilename}`);

(async () => {
    console.log(`[BOT] Launching for ${roomName}...`);
    console.log(`[BOT] Saving to: ${RECORDING_PATH_MP4}`);

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        headless: false, 
        ignoreDefaultArgs: ['--enable-automation'], 
        args: [
            '--kiosk', 
            '--disable-infobars', 
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--start-maximized',
            '--window-position=0,0',
            '--window-size=1920,1080',
            '--disable-dev-shm-usage',
            // --- NEW AUDIO FLAGS ---
            '--disable-audio-output-resampler', // Prevents Chrome from resampling audio internally
            '--disable-features=AudioServiceSandbox' // Helps with audio stability in Docker/Linux
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`[BOT] Navigating to ${MEETING_URL}`);
    await page.goto(MEETING_URL);
    
    // --- JOIN LOGIC ---
    try {
        await new Promise(r => setTimeout(r, 3000));
        const nameInput = 'input[field-name="displayName"]';
        if (await page.$(nameInput)) {
            await page.click(nameInput, { clickCount: 3 });
            await page.type(nameInput, 'BitSavvy Recorder');
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 2000)); 
        }
        
        const joinSelectors = ['[aria-label="Join meeting"]', '[data-testid="prejoin.joinMeeting"]', '.toolbox-button'];
        for (const s of joinSelectors) {
            if (await page.$(s)) { await page.click(s); break; }
        }
    } catch (e) { console.log(`[BOT] Join Error: ${e.message}`); }

    await new Promise(r => setTimeout(r, 5000));

    // --- FFMPEG RECORDING ---
    const displayID = process.env.DISPLAY || ':1'; 
    console.log(`[BOT] Using Display: ${displayID}`);

    // NOTE: If 'BitSavvySink' does not exist, this will fail. 
    // Try changing 'BitSavvySink.monitor' to 'default' if you haven't set up PulseAudio sinks.
    const audioDevice = 'BitSavvySink.monitor'; 

    const ffmpegEnv = { ...process.env, PULSE_LATENCY_MSEC: '60' };

    const ffmpeg = spawn('ffmpeg', [
        '-y', 
        
        // --- INPUT SETTINGS ---
        '-thread_queue_size', '4096', // CRITICAL: Prevents "Thread message queue blocking" (audio dropouts)
        '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-s', '2560x1440', '-i', displayID, 
        
        '-thread_queue_size', '4096', // Apply to audio input as well
        '-f', 'pulse', '-ac', '2', '-ar', '48000', '-i', audioDevice, // Force Stereo (2ch) and 48kHz sample rate
        
        // --- VIDEO OUTPUT (MP4) ---
        '-map', '0:v', '-map', '1:a',
        '-crf', '20', 
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', // Increased to 320k bitrate, locked 48kHz
        RECORDING_PATH_MP4,

        // --- AUDIO OUTPUT (MP3) ---
        '-map', '1:a',
        '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '48000', // Use CBR 320k for music stability
        RECORDING_PATH_MP3
    ], { env: ffmpegEnv }); // Pass the modified environment

    // --- CRITICAL: LOG FFMPEG ERRORS ---
    ffmpeg.stderr.on('data', (data) => {
        // Only log errors, ignore standard frame info to keep logs clean
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('fail') || msg.includes('found')) {
            console.error(`[FFMPEG ERROR] ${msg}`);
        }
    });

    ffmpeg.on('close', (code) => {
        console.log(`[FFMPEG] Process exited with code ${code}`);
    });

    console.log(`[BOT] Recording started...`);

    // --- MONITORING LOOP ---
    let aloneCounter = 0;
    const checkStatus = async () => {
        if (fs.existsSync(SIGNAL_FILE)) {
            console.log("[BOT] 🛑 Stop signal received.");
            try { fs.unlinkSync(SIGNAL_FILE); } catch(e) {}
            await gracefulExit();
            return;
        }

        try {
            const status = await page.evaluate(() => {
                if (typeof APP === 'undefined' || !APP.conference) return { ready: false };
                return { ready: true, count: APP.conference.membersCount };
            });

            if (status.ready && status.count <= 1) aloneCounter++;
            else aloneCounter = 0;

            if (aloneCounter >= 6) { 
                console.log("[BOT] 📉 Meeting empty. Auto-stopping.");
                await gracefulExit();
            }
        } catch (e) {}
    };

    const checkerInterval = setInterval(checkStatus, 5000);

    async function gracefulExit() {
        clearInterval(checkerInterval);
        console.log("[BOT] 💾 Saving files...");
        
        ffmpeg.kill('SIGINT'); 
        
        // Wait for FFmpeg to finish writing the file trailer
        await new Promise(r => setTimeout(r, 4000));
        
        await browser.close();
        process.exit(0);
    }

    setTimeout(() => gracefulExit(), 1000 * 60 * 60); 
})();