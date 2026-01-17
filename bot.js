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

    await page.goto(MEETING_URL);
    await new Promise(r => setTimeout(r, 5000));

    // --- JOIN LOGIC ---
    try {
        const nameInput = 'input[field-name="displayName"]';
        if (await page.$(nameInput)) {
            await page.click(nameInput, { clickCount: 3 });
            await page.type(nameInput, 'BitSavvy Recorder');
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 2000)); 
        }
        const joinButtonSelectors = ['[aria-label="Join meeting"]', '[data-testid="prejoin.joinMeeting"]', '.toolbox-button'];
        for (const selector of joinButtonSelectors) {
            if (await page.$(selector)) { await page.click(selector); break; }
        }
    } catch (e) { console.log(e); }
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

    // --- CONTROL LOOP ---
    let aloneCounter = 0;

    const checkStatus = async () => {
        // 1. CHECK FOR SERVER SIGNAL (The Manual Stop)
        if (fs.existsSync(SIGNAL_FILE)) {
            console.log("[BOT] Stop signal received from Dashboard.");
            // Delete signal file so we don't loop
            try { fs.unlinkSync(SIGNAL_FILE); } catch(e) {}
            await gracefulExit();
            return;
        }

        // 2. CHECK FOR CHAT COMMAND
        const stopInChat = await page.evaluate(() => {
            const msgs = document.querySelectorAll('.usermessage');
            return msgs.length > 0 && msgs[msgs.length - 1].innerText.includes("!stop");
        });

        if (stopInChat) {
            console.log("[BOT] Stop command received via Chat.");
            await gracefulExit();
            return;
        }

        // 3. CHECK IF ALONE (Auto Stop)
        try {
            const participantCount = await page.$$eval('.videocontainer', els => els.length);
            if (participantCount === 1) {
                aloneCounter++;
            } else {
                aloneCounter = 0;
            }
            if (aloneCounter >= 6) { // 30 seconds
                console.log("[BOT] Meeting empty. Auto-stopping.");
                await gracefulExit();
            }
        } catch (e) {}
    };

    const checkerInterval = setInterval(checkStatus, 5000);

    async function gracefulExit() {
        clearInterval(checkerInterval);
        console.log("[BOT] Stopping...");
        
        ffmpeg.kill('SIGINT'); // Stop recording
        await new Promise(r => setTimeout(r, 2000)); // Wait for save
        
        await browser.close();
        process.exit(0);
    }

    // Safety timeout (2 hours)
    setTimeout(gracefulExit, 1000 * 60 * 120);
})();