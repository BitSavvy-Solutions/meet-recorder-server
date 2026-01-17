// uploader.js
require('dotenv').config();
const { BlobServiceClient } = require('@azure/storage-blob');
const fs = require('fs');
const path = require('path');

const AZURE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'aida-public';

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING);

async function uploadToAzure(roomName, filePath) {
    try {
        const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

        // 1. Generate Date string (YYYY-MM-DD)
        const dateStr = new Date().toISOString().split('T')[0];
        
        // 2. Extract filename
        const fileName = path.basename(filePath);
        
        // 3. Construct the specific path: bitsavvy/meetings/date/meeting-name/file
        // Azure "folders" are just prefixes in the blob name
        const blobName = `bitsavvy/meetings/${dateStr}/${roomName}/${fileName}`;
        
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        console.log(`[AZURE] Uploading to: ${CONTAINER_NAME}/${blobName}`);

        const stream = fs.createReadStream(filePath);
        const uploadOptions = {
            blobHTTPHeaders: { blobContentType: "video/mp4" }
        };

        // Upload the file
        await blockBlobClient.uploadStream(stream, 4 * 1024 * 1024, 20, uploadOptions);

        console.log(`[AZURE] Upload success!`);
        
        // Return the URL (Since your container is already set to 'Blob' access, this will work)
        return blockBlobClient.url;

    } catch (error) {
        console.error(`[AZURE] Upload failed: ${error.message}`);
        return null;
    }
}

module.exports = { uploadToAzure };