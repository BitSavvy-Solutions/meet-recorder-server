const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');

const roomName = process.argv[2];
if (!roomName) process.exit(1);

const safeFilename = roomName.replace(/[^a-zA-Z0-9]/g, '-');
const MEETING_URL = `https://meet.jit.si/${roomName}`;

// --- CHANGED: Define paths for both files ---
const TIMESTAMP = Date.now();
const RECORDING_PATH_MP4 = `./recordings/${safeFilename}-${TIMESTAMP}.mp4`;
const RECORDING_PATH_MP3 = `./recordings/${safeFilename}-${TIMESTAMP}.mp3`;
const SIGNAL_FILE = `./signals/stop-${safeFilename}`;

if (!fs.existsSync('./recordings')) fs.mkdirSync('./recordings');

(async () => {
    console.log(`[BOT] Launching for ${roomName}...`);

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
            '--disable-dev-shm-usage'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`[BOT] Navigating to ${MEETING_URL}`);
    await page.goto(MEETING_URL);
    await new Promise(r => setTimeout(r, 5000));

    // --- JOIN LOGIC ---
    try {
        const nameInput = 'input[field-name="displayName"]';
        if (await page.$(nameInput)) {
            console.log("[BOT] Entering Display Name...");
            await page.click(nameInput, { clickCount: 3 });
            await page.type(nameInput, 'BitSavvy Recorder');
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 2000)); 
        }
        
        const joinButtonSelectors = ['[aria-label="Join meeting"]', '[data-testid="prejoin.joinMeeting"]', '.toolbox-button'];
        for (const selector of joinButtonSelectors) {
            if (await page.$(selector)) { 
                console.log(`[BOT] Clicking Join Button: ${selector}`);
                await page.click(selector); 
                break; 
            }
        }
    } catch (e) { console.log(`[BOT] Join Error: ${e.message}`); }
    // ------------------

    await new Promise(r => setTimeout(r, 5000));

    // --- CHANGED: FFmpeg Command for Dual Output ---
    const displayID = process.env.DISPLAY || ':1'; 
    
    const ffmpeg = spawn('ffmpeg', [
        '-y', 
        // INPUT 0: Video (Screen)
        '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-s', '1920x1080', '-i', displayID, 
        // INPUT 1: Audio (Pulse)
        '-f', 'pulse', '-i', 'BitSavvySink.monitor',
        
        // OUTPUT 1: MP4 (Video + Audio)
        '-map', '0:v', // Use Input 0 for Video
        '-map', '1:a', // Use Input 1 for Audio
        '-c:v', 'libx264', '-preset', 'superfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', 
        RECORDING_PATH_MP4,

        // OUTPUT 2: MP3 (Audio Only)
        '-map', '1:a', // Use Input 1 for Audio
        '-c:a', 'libmp3lame', // MP3 Encoder
        '-q:a', '2', // Quality (VBR, roughly 190kbps)
        RECORDING_PATH_MP3
    ]);

    console.log(`[BOT] Recording started: MP4 & MP3`);

    // --- STATUS CHECK LOOP ---
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

            if (status.ready) {
                console.log(`[HEARTBEAT] Participants: ${status.count}`);
                if (status.count <= 1) aloneCounter++;
                else aloneCounter = 0;
            }

            if (aloneCounter >= 6) { 
                console.log("[BOT] 📉 Meeting empty. Auto-stopping.");
                await gracefulExit();
            }
        } catch (e) { console.log(`[ERROR] Check loop: ${e.message}`); }
    };

    const checkerInterval = setInterval(checkStatus, 5000);

    async function gracefulExit() {
        clearInterval(checkerInterval);
        console.log("[BOT] 💾 Saving files and shutting down...");
        
        ffmpeg.kill('SIGINT'); 
        await new Promise(r => setTimeout(r, 3000)); // Give slightly more time for 2 files to close
        
        await browser.close();
        process.exit(0);
    }

    setTimeout(() => {
        console.log("[BOT] ⏰ Time Limit Reached.");
        gracefulExit();
    }, 1000 * 60 * 60); 
})();