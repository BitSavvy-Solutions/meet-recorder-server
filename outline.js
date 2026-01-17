// outline.js
require('dotenv').config();
const axios = require('axios');

const OUTLINE_URL = "https://docs.bitsavvy.ca"
const OUTLINE_TOKEN = process.env.OUTLINE_BITSAVVY_API;
const COLLECTION_ID = process.env.OUTLINE_IVERSE_COLLECTION_ID;

async function createOutlinePage(roomName, dateStr, duration, mp4Url, mp3Url, transcriptionText) {
    if (!OUTLINE_URL || !OUTLINE_TOKEN || !COLLECTION_ID) {
        console.log("[OUTLINE] ⚠️ Missing configuration. Skipping.");
        return null;
    }

    const title = `Meeting: ${roomName} - ${dateStr}`;
    
    // Construct Markdown Content
    const markdown = `
# 📅 Meeting Record: ${roomName}

**Date:** ${new Date().toLocaleString()}  
**Duration:** ${duration}

---

## 🎬 Recordings

- **🎥 Video:** [Watch on Azure](${mp4Url})
- **🎧 Audio:** [Listen on Azure](${mp3Url})

---

## 📝 Transcription

${transcriptionText}
    `;

    try {
        console.log(`[OUTLINE] Creating document for ${roomName}...`);
        
        const response = await axios.post(`${OUTLINE_URL}/api/documents.create`, {
            collectionId: COLLECTION_ID,
            title: title,
            text: markdown,
            publish: true // Automatically publish so it's visible
        }, {
            headers: {
                'Authorization': `Bearer ${OUTLINE_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const docUrl = `${OUTLINE_URL}/doc/${response.data.data.urlId}`;
        console.log(`[OUTLINE] Success! Document created: ${docUrl}`);
        return docUrl;

    } catch (error) {
        console.error(`[OUTLINE] Failed: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
        return null;
    }
}

module.exports = { createOutlinePage };