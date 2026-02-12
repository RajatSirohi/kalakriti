const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const strokeWidthInput = document.getElementById('strokeWidth');
const strokeWidthValueSpan = document.getElementById('strokeWidthValue');
const clearButton = document.getElementById('clearButton');
const quickColorButtons = document.querySelectorAll('.quick-color-btn');
const roomIdDisplay = document.getElementById('roomIdDisplay');

let drawing = false;
let currentColor = colorPicker.value;
let currentStrokeWidth = parseInt(strokeWidthInput.value);
let drawingHistory = [];

// Zoom and Pan state
let zoom = 1;
let offsetX = 0;
let offsetY = 0;
let isPanning = false;
let lastMouseX = 0;
let lastMouseY = 0;

ctx.lineCap = 'round';
ctx.lineJoin = 'round';

function getTransformedPoint(x, y) {
    const dpr = window.devicePixelRatio || 1;
    return {
        x: (x * dpr - offsetX) / zoom,
        y: (y * dpr - offsetY) / zoom
    };
}


function redrawCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(zoom, zoom);
    
    ctx.clearRect(-offsetX / zoom, -offsetY / zoom, canvas.width / zoom, canvas.height / zoom);

    drawingHistory.forEach(stroke => drawStroke(stroke, true));
    
    ctx.restore();

    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentStrokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

function drawStroke(stroke, fromHistory = false) {
    if (!fromHistory) {
        drawingHistory.push(stroke);
    }
    
    const savedColor = ctx.strokeStyle;
    const savedWidth = ctx.lineWidth;

    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;

    // When drawing from history, we need to be in the transformed space
    if (fromHistory) {
        ctx.beginPath();
        ctx.moveTo(stroke.x1, stroke.y1);
        ctx.lineTo(stroke.x2, stroke.y2);
        ctx.stroke();
    } else {
        // When drawing a new stroke, draw it directly on the canvas without transformation
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Use the base transformation
        ctx.beginPath();
        ctx.moveTo(lastMouseX * dpr, lastMouseY * dpr);
        ctx.lineTo(stroke.x2_screen, stroke.y2_screen);
        ctx.stroke();
        ctx.restore();
    }


    ctx.strokeStyle = savedColor;
    ctx.lineWidth = savedWidth;
}


window.addEventListener('resize', redrawCanvas);


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
        colorPicker.value = selectedColor;
    });
});

let lastX = 0;
let lastY = 0;

function handleStart(clientX, clientY) {
    if (isPanning) {
        [lastMouseX, lastMouseY] = [clientX, clientY];
        return;
    }
    drawing = true;
    const point = getTransformedPoint(clientX, clientY);
    [lastX, lastY] = [point.x, point.y];
    [lastMouseX, lastMouseY] = [clientX, clientY];
}

function handleMove(clientX, clientY) {
    if (isPanning) {
        const dx = clientX - lastMouseX;
        const dy = clientY - lastMouseY;
        offsetX += dx * (window.devicePixelRatio || 1);
        offsetY += dy * (window.devicePixelRatio || 1);
        [lastMouseX, lastMouseY] = [clientX, clientY];
        redrawCanvas();
        return;
    }

    if (!drawing) return;

    const point = getTransformedPoint(clientX, clientY);
    const newX = point.x;
    const newY = point.y;

    const strokeDataForServer = {
        x1: lastX,
        y1: lastY,
        x2: newX,
        y2: newY,
        color: currentColor,
        width: currentStrokeWidth
    };

    // For local drawing, we need screen coordinates
    const strokeDataForLocal = { ...strokeDataForServer, x2_screen: clientX, y2_screen: clientY };
    
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentStrokeWidth;
    drawStroke(strokeDataForLocal, false);

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'draw', data: strokeDataForServer }));
    }

    [lastX, lastY] = [newX, newY];
    [lastMouseX, lastMouseY] = [clientX, clientY];
}

function handleEnd() {
    drawing = false;
}

canvas.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
canvas.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
canvas.addEventListener('mouseup', handleEnd);
canvas.addEventListener('mouseout', handleEnd);

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY);
});
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
});
canvas.addEventListener('touchend', handleEnd);
canvas.addEventListener('touchcancel', handleEnd);

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        isPanning = true;
        canvas.style.cursor = 'move';
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isPanning = false;
        canvas.style.cursor = 'crosshair';
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dpr = window.devicePixelRatio || 1;
    const mouseX = e.clientX * dpr;
    const mouseY = e.clientY * dpr;
    const zoomFactor = 1.1;

    const wheel = e.deltaY < 0 ? 1 : -1;
    const newZoom = zoom * Math.pow(zoomFactor, wheel);

    const mousePointX = (mouseX - offsetX) / zoom;
    const mousePointY = (mouseY - offsetY) / zoom;

    offsetX = mouseX - mousePointX * newZoom;
    offsetY = mouseY - mousePointY * newZoom;
    zoom = newZoom;

    redrawCanvas();
});


clearButton.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear' }));
    }
    drawingHistory = [];
    redrawCanvas();
});

let ws;
let roomId;

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8);
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
roomIdDisplay.textContent = roomId;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}?room=${roomId}`);

    ws.onopen = () => console.log('Connected to WebSocket server');

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        switch (message.type) {
            case 'draw':
                drawingHistory.push(message.data);
                redrawCanvas();
                break;
            case 'clear':
                drawingHistory = [];
                redrawCanvas();
                break;
            case 'history':
                drawingHistory = message.data;
                redrawCanvas();
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

redrawCanvas();
connectWebSocket();
canvas.style.cursor = 'crosshair';