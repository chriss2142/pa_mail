const { MatrixClient, SimpleFsStorageProvider, AutojoinRoomsMixin } = require("matrix-bot-sdk");
const fs = require("fs");
const path = require("path");

// Configuration
const homeserverUrl = process.env.PA_MATRIX_SERVER; // Replace with your homeserver URL
const accessToken = process.env.PA_MATRIX_TOKEN; // Replace with your access token
const targetUserId = process.env.PA_MATRIX_TARGET_USER; // Replace with the target Matrix user ID
const mp3FilePath = "speech.mp3"; // Replace with the path to your MP3 file

async function sendFile() {
    try {
        // Initialize the client
        const storage = new SimpleFsStorageProvider("matrix-storage.json");
        const client = new MatrixClient(homeserverUrl, accessToken, storage);

        // Enable auto-joining of rooms
        AutojoinRoomsMixin.setupOnClient(client);

        // Start the client
        await client.start();
        console.log("Matrix client started.");

        // Check if the file exists
        if (!fs.existsSync(mp3FilePath)) {
            console.error(`File not found: ${mp3FilePath}`);
            return;
        }

        // Read the file
        const fileBuffer = fs.readFileSync(mp3FilePath);
        const fileName = path.basename(mp3FilePath);

        // Create a room to DM the user
        const roomId = await client.createRoom({
            invite: [targetUserId],
            is_direct: true,
        });
        console.log(`Created room ${roomId} to message ${targetUserId}.`);

        // Upload the file to the Matrix content repository
        const mxcUrl = await client.uploadContent(fileBuffer, "audio/mpeg", fileName);
        console.log(`File uploaded to ${mxcUrl}.`);

        // Send the file as a message
        await client.sendMessage(roomId, {
            msgtype: "m.audio",
            body: fileName,
            url: mxcUrl,
            info: {
                mimetype: "audio/mpeg",
                size: fileBuffer.length,
            },
        });
        console.log(`MP3 file sent to ${targetUserId}.`);

        // Stop the client after sending
        await client.stop();
    } catch (error) {
        console.error("Error sending MP3 file:", error);
    }
}

sendFile();
