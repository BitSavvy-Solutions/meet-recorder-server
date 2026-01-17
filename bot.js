const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');

const roomName = process.argv[2];
if (!roomName) process.exit(1);

const MEETING_URL = `https://meet.jit.si/${roomName}`;
const RECORDING_PATH = `./recordings/${roomName}-${Date.now()}.mp4`;

if (!fs.existsSync('./recordings')) fs.mkdirSync('./recordings');

(async () => {
    console.log(`[BOT] Launching for ${roomName} in 1080p...`);

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
            '--window-size=1920,1080', // <--- 1080p Window
            '--disable-dev-shm-usage'
        ]
    });

    const page = await browser.newPage();

    // Force Viewport to 1080p
    await page.setViewport({ width: 1920, height: 1080 });

    // 1. Go to URL
    await page.goto(MEETING_URL);

    // Wait for page load
    await new Promise(r => setTimeout(r, 5000));

    // 2. Handle "Pre-Join" Screen
    try {
        const nameInput = 'input[field-name="displayName"]';
        const inputExists = await page.$(nameInput);

        if (inputExists) {
            await page.click(nameInput, { clickCount: 3 });
            await page.type(nameInput, 'BitSavvy Recorder');
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 2000));
        }

        // Join Button Logic
        const joinButtonSelectors = [
            '[aria-label="Join meeting"]',
            '[data-testid="prejoin.joinMeeting"]',
            '.toolbox-button'
        ];

        let joined = false;
        for (const selector of joinButtonSelectors) {
            if (await page.$(selector)) {
                await page.click(selector);
                joined = true;
                break;
            }
        }

        if (!joined) {
            const buttons = await page.$$('div[role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.innerText, btn);
                if (text && (text.toLowerCase().includes('join') || text.toLowerCase().includes('ask'))) {
                    await btn.click();
                    joined = true;
                    break;
                }
            }
        }

    } catch (e) {
        console.log(`[BOT] Error during join: ${e.message}`);
    }

    // Wait to settle inside the meeting
    await new Promise(r => setTimeout(r, 5000));

    // 3. Start FFmpeg (1080p Config)
    const displayID = process.env.DISPLAY || ':1';
    console.log(`[BOT] Recording from Display: ${displayID}`);


    const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-f', 'x11grab',
        '-draw_mouse', '0',
        '-framerate', '30',       // Force 30 FPS (Prevents jitter)
        '-s', '1920x1080',
        '-i', displayID,
        '-f', 'pulse',
        '-i', 'BitSavvySink.monitor',
        '-c:v', 'libx264',

        // --- QUALITY SETTINGS ---
        '-preset', 'superfast',   // Better than ultrafast, still safe for CPU
        '-crf', '18',             // 18 is "Visually Lossless". Text will be crisp.
        '-tune', 'zerolatency',   // Optimizes for real-time recording
        '-profile:v', 'high',     // Uses advanced compression features
        // ------------------------

        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        RECORDING_PATH
    ]);

    console.log(`[BOT] Recording started: ${RECORDING_PATH}`);

    // 4. Keep alive & Listen for Stop
    await page.exposeFunction('killBot', async () => {
        console.log("[BOT] Stop command received.");
        ffmpeg.kill('SIGINT');
        await browser.close();
        process.exit(0);
    });

    await page.evaluate(() => {
        setInterval(() => {
            const messages = document.querySelectorAll('.usermessage');
            if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1].innerText;
                if (lastMsg.includes("!stop")) {
                    window.killBot();
                }
            }
        }, 2000);
    });

    // Safety timeout: 2 hours
    setTimeout(async () => {
        ffmpeg.kill('SIGINT');
        await browser.close();
        process.exit();
    }, 1000 * 60 * 120);

})();