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
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = path.basename(filePath);
        const blobName = `bitsavvy/meetings/${dateStr}/${roomName}/${fileName}`;
        
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        console.log(`[AZURE] Uploading to: ${CONTAINER_NAME}/${blobName}`);

        // --- CHANGED: Dynamic Content Type ---
        const ext = path.extname(filePath).toLowerCase();
        let contentType = "application/octet-stream";
        if (ext === '.mp4') contentType = "video/mp4";
        if (ext === '.mp3') contentType = "audio/mpeg";

        const stream = fs.createReadStream(filePath);
        const uploadOptions = {
            blobHTTPHeaders: { blobContentType: contentType }
        };

        await blockBlobClient.uploadStream(stream, 4 * 1024 * 1024, 20, uploadOptions);

        console.log(`[AZURE] Upload success: ${fileName}`);
        return blockBlobClient.url;

    } catch (error) {
        console.error(`[AZURE] Upload failed for ${filePath}: ${error.message}`);
        return null;
    }
}

module.exports = { uploadToAzure };