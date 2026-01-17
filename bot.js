const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');

const roomName = process.argv[2];
if (!roomName) process.exit(1);

const safeFilename = roomName.replace(/[^a-zA-Z0-9]/g, '-');
const MEETING_URL = `https://meet.jit.si/${roomName}`;
const RECORDING_PATH = `./recordings/${safeFilename}-${Date.now()}.mp4`;
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

    // Start FFmpeg
    const displayID = process.env.DISPLAY || ':1'; 
    const ffmpeg = spawn('ffmpeg', [
        '-y', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30',
        '-s', '1920x1080', '-i', displayID, '-f', 'pulse', '-i', 'BitSavvySink.monitor',
        '-c:v', 'libx264', '-preset', 'superfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', RECORDING_PATH
    ]);

    console.log(`[BOT] Recording started: ${RECORDING_PATH}`);

    // --- STATUS CHECK LOOP ---
    let aloneCounter = 0;

    const checkStatus = async () => {
        // 1. CHECK FOR SERVER SIGNAL
        if (fs.existsSync(SIGNAL_FILE)) {
            console.log("[BOT] 🛑 Stop signal received from Dashboard.");
            try { fs.unlinkSync(SIGNAL_FILE); } catch(e) {}
            await gracefulExit();
            return;
        }

        // 2. CHECK PARTICIPANT COUNT (Using membersCount property)
        try {
            const status = await page.evaluate(() => {
                // Check if Jitsi API is ready
                if (typeof APP === 'undefined') return { ready: false, reason: "APP undefined" };
                if (!APP.conference) return { ready: false, reason: "APP.conference undefined" };
                
                // FIX: Use membersCount property
                return { 
                    ready: true, 
                    count: APP.conference.membersCount 
                };
            });

            if (status.ready) {
                console.log(`[HEARTBEAT] Participants: ${status.count} | Alone Checks: ${aloneCounter}/6`);
                
                // Logic: 1 participant means ONLY the bot is there
                if (status.count <= 1) {
                    aloneCounter++;
                } else {
                    aloneCounter = 0;
                }
            } else {
                console.log(`[HEARTBEAT] Jitsi API not ready yet (${status.reason})...`);
            }

            // 3. AUTO STOP TRIGGER (30 Seconds Alone)
            if (aloneCounter >= 6) { 
                console.log("[BOT] 📉 Meeting empty for 30 seconds. Auto-stopping.");
                await gracefulExit();
            }

        } catch (e) {
            console.log(`[ERROR] Check loop failed: ${e.message}`);
        }
    };

    const checkerInterval = setInterval(checkStatus, 5000);

    async function gracefulExit() {
        clearInterval(checkerInterval);
        console.log("[BOT] 💾 Saving file and shutting down...");
        
        ffmpeg.kill('SIGINT'); 
        await new Promise(r => setTimeout(r, 2000)); 
        
        await browser.close();
        process.exit(0);
    }

    // --- HARD LIMIT: 1 HOUR ---
    console.log("[BOT] ⏳ 1-Hour Timer Started.");
    setTimeout(() => {
        console.log("[BOT] ⏰ Time Limit Reached (1 Hour). Forcing exit.");
        gracefulExit();
    }, 1000 * 60 * 60); // 60 Minutes

})();