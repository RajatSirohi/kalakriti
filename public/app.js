const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const strokeWidthInput = document.getElementById('strokeWidth');
const strokeWidthValueSpan = document.getElementById('strokeWidthValue');
const clearButton = document.getElementById('clearButton');
const quickColorButtons = document.querySelectorAll('.quick-color-btn');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const toggleControls = document.getElementById('toggleControls');
const controls = document.getElementById('controls');

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
let initialPinchDistance = null;

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

    drawingHistory.forEach(stroke => drawStroke(stroke));

    ctx.restore();
}

function drawStroke(stroke) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(stroke.x1, stroke.y1);
    ctx.lineTo(stroke.x2, stroke.y2);
    ctx.stroke();
}


window.addEventListener('resize', redrawCanvas);


colorPicker.addEventListener('change', (e) => {
    currentColor = e.target.value;
});

strokeWidthInput.addEventListener('input', (e) => {
    currentStrokeWidth = parseInt(e.target.value);
    strokeWidthValueSpan.textContent = currentStrokeWidth;
});

quickColorButtons.forEach(button => {
    button.addEventListener('click', () => {
        const selectedColor = button.getAttribute('data-color');
        currentColor = selectedColor;
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
}

const handleMove = throttle((clientX, clientY) => {
    if (isPanning) {
        const dx = clientX - lastMouseX;
        const dy = clientY - lastMouseY;
        const dpr = window.devicePixelRatio || 1;
        offsetX += dx * dpr;
        offsetY += dy * dpr;
        [lastMouseX, lastMouseY] = [clientX, clientY];
        redrawCanvas();
        return;
    }

    if (!drawing) return;

    const point = getTransformedPoint(clientX, clientY);
    const newX = point.x;
    const newY = point.y;

    const stroke = {
        x1: lastX,
        y1: lastY,
        x2: newX,
        y2: newY,
        color: currentColor,
        width: currentStrokeWidth
    };

    drawingHistory.push(stroke);
    drawStroke(stroke); // Draw the new stroke immediately
    redrawCanvas();


    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'draw', data: stroke }));
    }

    [lastX, lastY] = [newX, newY];
}, 16); // Throttle to ~60fps

function handleEnd() {
    drawing = false;
    initialPinchDistance = null;
}

canvas.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
canvas.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
canvas.addEventListener('mouseup', handleEnd);
canvas.addEventListener('mouseout', handleEnd);

function getDistance(touches) {
    return Math.sqrt(Math.pow(touches[0].clientX - touches[1].clientX, 2) + Math.pow(touches[0].clientY - touches[1].clientY, 2));
}

canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        drawing = true;
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);
    } else if (e.touches.length === 2) {
        drawing = false;
        initialPinchDistance = getDistance(e.touches);
    } else {
        drawing = false;
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && drawing) {
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY);
    } else if (e.touches.length === 2 && initialPinchDistance) {
        const newPinchDistance = getDistance(e.touches);
        const zoomFactor = newPinchDistance / initialPinchDistance;
        
        const dpr = window.devicePixelRatio || 1;
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 * dpr;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 * dpr;

        const newZoom = zoom * zoomFactor;

        const mousePointX = (centerX - offsetX) / zoom;
        const mousePointY = (centerY - offsetY) / zoom;

        offsetX = centerX - mousePointX * newZoom;
        offsetY = centerY - mousePointY * newZoom;
        zoom = newZoom;
        
        initialPinchDistance = newPinchDistance;
        redrawCanvas();
    }
});

canvas.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        initialPinchDistance = null;
    }
    if (e.touches.length < 1) {
        drawing = false;
    }
});
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

toggleControls.addEventListener('click', () => {
    controls.classList.toggle('hidden');
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

// Simple throttle function
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

redrawCanvas();
connectWebSocket();
canvas.style.cursor = 'crosshair';
controls.classList.add('hidden');