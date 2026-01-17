// transcriber.js
require('dotenv').config();
const Replicate = require("replicate");

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

async function transcribeAudio(audioUrl) {
    try {
        console.log(`[REPLICATE] Starting transcription for: ${audioUrl}`);
        
        // Using the model version you specified
        const output = await replicate.run(
            "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
            {
                input: {
                    audio: audioUrl,
                    batch_size: 64
                }
            }
        );

        // Output is usually an object: { text: "...", chunks: [...] }
        console.log(`[REPLICATE] Success! Length: ${output.text.length} chars`);
        return output.text;

    } catch (error) {
        console.error(`[REPLICATE] Error: ${error.message}`);
        return null;
    }
}

module.exports = { transcribeAudio };