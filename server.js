const express = require('express');
const { spawn } = require('child_process');
const app = express();
const PORT = 3001; // Using 3001 to avoid conflict with your other apps

app.get('/join', (req, res) => {
    const room = req.query.room;
    
    if (!room) {
        return res.status(400).send('Error: You must specify a room. Usage: /join?room=MyMeeting');
    }

    console.log(`[API] Summoning bot to room: ${room}`);

    // Spawn the bot process independently
    // CRITICAL: The screen resolution here (1920x1080) MUST match bot.js
    const bot = spawn('xvfb-run', [
        '--auto-servernum', 
        '--server-args="-screen 0 1920x1080x24"', 
        'node', 
        'bot.js', 
        room
    ], {
        detached: true,
        stdio: 'ignore' // Detach completely so the API request finishes immediately
    });

    bot.unref();

    res.send(`✅ BitSavvy Recorder dispatched to: ${room} (1080p Mode)`);
});

app.listen(PORT, () => {
    console.log(`🚀 Summoner API running on port ${PORT}`);
});