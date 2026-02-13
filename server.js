const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const url = require('url'); // Import the 'url' module

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage for rooms
// Each room ID maps to an object containing a Set of connected clients and an array storing drawing history.
const rooms = new Map(); // Map<roomId, { clients: Set<WebSocket>, history: Array<Stroke> }>

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Create an HTTP server
const server = http.createServer(app);

// Instantiate WebSocket server
const wss = new WebSocket.Server({ server });

// Function to validate a stroke object
function isValidStroke(stroke) {
    if (!stroke || typeof stroke !== 'object') return false;

    const { color, width } = stroke;
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return false;
    if (typeof width !== 'number' || !isFinite(width) || width <= 0) return false;

    // New path-based format
    if (Array.isArray(stroke.points)) {
        if (stroke.points.length < 2 || stroke.points.length > 1000) return false; // Path must have points, but not too many
        for (const point of stroke.points) {
            if (typeof point !== 'object' || typeof point.x !== 'number' || typeof point.y !== 'number' || !isFinite(point.x) || !isFinite(point.y)) {
                return false;
            }
        }
        return true;
    }

    // Old segment-based format for compatibility
    const { x1, y1, x2, y2 } = stroke;
    if (typeof x1 === 'number' && typeof y1 === 'number' && typeof x2 === 'number' && typeof y2 === 'number') {
        if (![x1, y1, x2, y2].every(isFinite)) return false;
        return true;
    }

    return false;
}

wss.on('connection', (ws, req) => {
    const parameters = url.parse(req.url, true);
    const roomId = parameters.query.room;

    // Validate room ID
    if (!roomId || !/^[a-zA-Z0-9]{6}$/.test(roomId)) {
        console.log('Client disconnected: Invalid or missing room ID');
        ws.close(1008, 'Invalid or missing room ID');
        return;
    }

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
        rooms.set(roomId, { clients: new Set(), history: [] });
        console.log(`Room '${roomId}' created.`);
    }

    const room = rooms.get(roomId);

    // Enforce max capacity
    if (room.clients.size >= 20) {
        console.log(`Client disconnected: Room '${roomId}' is full.`);
        ws.close(1008, 'Room is full');
        return;
    }

    room.clients.add(ws);
    console.log(`Client connected to room '${roomId}'. Total clients: ${room.clients.size}`);

    // Store room ID in websocket object for later use (e.g., on close)
    ws.roomId = roomId;

    // Send initialization message with existing stroke history to the new client
    if (room.history.length > 0) {
        ws.send(JSON.stringify({ type: 'history', data: room.history }));
    }

    ws.on('message', message => {
        // Reject payloads exceeding 512 bytes
        if (message.length > 512) {
            console.warn(`Client sent too large payload (${message.length} bytes), disconnecting.`);
            ws.close(1009, 'Message too large');
            return;
        }

        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (error) {
            console.warn('Received invalid JSON message:', error);
            return;
        }

        // Handle structured message types (e.g., 'draw', 'clear')
        switch (parsedMessage.type) {
            case 'draw':
                if (!room) {
                    console.warn(`Draw message received for non-existent room: ${ws.roomId}`);
                    return;
                }
                const stroke = parsedMessage.data;

                // Validate the stroke data
                if (!isValidStroke(stroke)) {
                    console.warn(`Received invalid stroke data from client in room ${ws.roomId}`);
                    return; // Drop the message
                }

                room.history.push(stroke);
                // Enforce max history length
                if (room.history.length > 10000) {
                    room.history.shift(); // Remove the oldest stroke
                }
                // Broadcast to all clients in the room
                room.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(parsedMessage));
                    }
                });
                break;
            case 'clear':
                if (!room) {
                    console.warn(`Clear message received for non-existent room: ${ws.roomId}`);
                    return;
                }
                room.history = []; // Reset the room's history
                // Broadcast to all clients in the room, including the sender
                room.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(parsedMessage));
                    }
                });
                break;
            default:
                console.warn('Unknown message type:', parsedMessage.type);
                break;
        }
    });

    ws.on('close', () => {
        const roomId = ws.roomId;
        if (roomId && rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.clients.delete(ws);
            console.log(`Client disconnected from room '${roomId}'. Remaining clients: ${room.clients.size}`);

            if (room.clients.size === 0) {
                rooms.delete(roomId);
                console.log(`Room '${roomId}' deleted as no clients remain.`);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
