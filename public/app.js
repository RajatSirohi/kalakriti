const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const strokeWidthInput = document.getElementById('strokeWidth');
const strokeWidthValueSpan = document.getElementById('strokeWidthValue');
const clearButton = document.getElementById('clearButton');
const quickColorButtons = document.querySelectorAll('.quick-color-btn');

let drawing = false;
let currentColor = colorPicker.value;
let currentStrokeWidth = parseInt(strokeWidthInput.value);

// Initialize canvas context
ctx.strokeStyle = currentColor;
ctx.lineWidth = currentStrokeWidth;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

function resizeCanvas() {
    // Get the device pixel ratio for sharper drawing on high-DPI screens
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    // Set canvas display size for CSS
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    // When resizing, we might lose the content, so we would ideally redraw the history here.
    // For now, it will just clear. Redrawing history will be handled later.
    // Ensure styles are reapplied after context reset from resize
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentStrokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

function drawStroke(stroke) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(stroke.x1, stroke.y1);
    ctx.lineTo(stroke.x2, stroke.y2);
    ctx.stroke();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Initial canvas resize

colorPicker.addEventListener('change', (e) => {
    currentColor = e.target.value;
    ctx.strokeStyle = currentColor;
});

strokeWidthInput.addEventListener('input', (e) => {
    currentStrokeWidth = parseInt(e.target.value);
    strokeWidthValueSpan.textContent = currentStrokeWidth;
    ctx.lineWidth = currentStrokeWidth;
});

quickColorButtons.forEach(button => {
    button.addEventListener('click', () => {
        const selectedColor = button.getAttribute('data-color');
        currentColor = selectedColor;
        ctx.strokeStyle = currentColor;
        colorPicker.value = selectedColor; // Update main color picker
    });
});


// Basic drawing functionality (will be integrated with WebSocket later)
canvas.addEventListener('mousedown', (e) => {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(e.clientX, e.clientY);
});

canvas.addEventListener('mouseup', () => {
    drawing = false;
    ctx.closePath();
});

let lastX = 0;
let lastY = 0;

canvas.addEventListener('mousedown', (e) => {
    drawing = true;
    [lastX, lastY] = [e.clientX, e.clientY];
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
});

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Prevent scrolling
    drawing = true;
    const touch = e.touches[0];
    [lastX, lastY] = [touch.clientX, touch.clientY];
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
});


canvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;

    ctx.lineTo(e.clientX, e.clientY);
    ctx.stroke();

    // Send draw event to WebSocket server
    if (ws && ws.readyState === WebSocket.OPEN) {
        const strokeData = {
            x1: lastX,
            y1: lastY,
            x2: e.clientX,
            y2: e.clientY,
            color: currentColor,
            width: currentStrokeWidth
        };
        ws.send(JSON.stringify({ type: 'draw', data: strokeData }));
    }
    [lastX, lastY] = [e.clientX, e.clientY];
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault(); // Prevent scrolling
    if (!drawing) return;

    const touch = e.touches[0];
    ctx.lineTo(touch.clientX, touch.clientY);
    ctx.stroke();

    // Send draw event to WebSocket server
    if (ws && ws.readyState === WebSocket.OPEN) {
        const strokeData = {
            x1: lastX,
            y1: lastY,
            x2: touch.clientX,
            y2: touch.clientY,
            color: currentColor,
            width: currentStrokeWidth
        };
        ws.send(JSON.stringify({ type: 'draw', data: strokeData }));
    }
    [lastX, lastY] = [touch.clientX, touch.clientY];
});


canvas.addEventListener('mouseup', () => {
    drawing = false;
    ctx.closePath();
});

canvas.addEventListener('touchend', () => {
    drawing = false;
    ctx.closePath();
});

clearButton.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear' }));
    }
    // Clear the canvas locally immediately
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Redraw with current settings after clear
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentStrokeWidth;
});

// WebSocket connection
let ws;
let roomId;


function generateRoomId() {
    return Math.random().toString(36).substring(2, 8); // 6-character alphanumeric
}

function getOrCreateRoomId() {
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('room');
    if (!id || !/^[a-zA-Z0-9]{6}$/.test(id)) {
        id = generateRoomId();
        window.history.replaceState(null, '', `?room=${id}`);
    }
    return id;
}

roomId = getOrCreateRoomId();
console.log(`Joining room: ${roomId}`);

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}?room=${roomId}`);

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        switch (message.type) {
            case 'draw':
                drawStroke(message.data);
                break;
            case 'clear':
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                // Re-apply current stroke settings
                ctx.strokeStyle = currentColor;
                ctx.lineWidth = currentStrokeWidth;
                break;
            case 'history':
                ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear before drawing history
                message.data.forEach(stroke => drawStroke(stroke));
                // Re-apply current stroke settings after history is drawn
                ctx.strokeStyle = currentColor;
                ctx.lineWidth = currentStrokeWidth;
                break;
            default:
                console.warn('Unknown message type:', message.type);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from WebSocket server. Reconnecting in 3 seconds...');
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        ws.close();
    };
}

connectWebSocket();


