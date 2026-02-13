const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const bufferCanvas = document.createElement('canvas');
const bufferCtx = bufferCanvas.getContext('2d');

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
let currentPath = [];

let zoom = 1;
let offsetX = 0;
let offsetY = 0;
let isPanning = false;
let isGesturing = false;
let lastMouseX = 0;
let lastMouseY = 0;
let initialPinchDistance = null;
let gestureTimeout;

[ctx, bufferCtx].forEach(c => {
    c.lineCap = 'round';
    c.lineJoin = 'round';
});

function getTransformedPoint(x, y) {
    const dpr = window.devicePixelRatio || 1;
    return {
        x: (x * dpr - offsetX) / zoom,
        y: (y * dpr - offsetY) / zoom
    };
}

function drawGrid(context) {
    const dpr = window.devicePixelRatio || 1;
    const screenWidth = context.canvas.width;
    const screenHeight = context.canvas.height;

    // Determine grid spacing based on zoom
    const baseSpacing = 100; // The spacing at zoom = 1
    let spacing = baseSpacing;
    while (spacing * zoom < 50) {
        spacing *= 5;
    }
    while (spacing * zoom > 150) {
        spacing /= 5;
    }
    
    const lineCountX = screenWidth / (spacing * zoom);
    const lineCountY = screenHeight / (spacing * zoom);

    context.strokeStyle = '#e9e9e9';
    context.lineWidth = 1 / dpr;
    context.beginPath();

    const startX = Math.floor(-offsetX / (spacing * zoom)) * spacing;
    const startY = Math.floor(-offsetY / (spacing * zoom)) * spacing;
    const endX = startX + (screenWidth / zoom) + spacing;
    const endY = startY + (screenHeight / zoom) + spacing;
    
    for (let x = startX; x < endX; x += spacing) {
        context.moveTo(x, startY);
        context.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += spacing) {
        context.moveTo(startX, y);
        context.lineTo(endX, y);
    }
    context.stroke();
}


function redrawBuffer() {
    const dpr = window.devicePixelRatio || 1;
    bufferCanvas.width = window.innerWidth * dpr;
    bufferCanvas.height = window.innerHeight * dpr;
    bufferCtx.setTransform(1, 0, 0, 1, 0, 0);
    // Clear with a specific background color
    bufferCtx.fillStyle = '#f4f4f4';
    bufferCtx.fillRect(0, 0, bufferCanvas.width, bufferCanvas.height);
    
    bufferCtx.save();
    bufferCtx.translate(offsetX, offsetY);
    bufferCtx.scale(zoom, zoom);

    // Draw the grid first
    drawGrid(bufferCtx);
    
    drawingHistory.forEach(stroke => drawStroke(bufferCtx, stroke));
    bufferCtx.restore();
    requestAnimationFrame(drawFrame);
}

function drawFrame() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bufferCanvas, 0, 0);

    if (currentPath.length > 1) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(zoom, zoom);
        drawStroke(ctx, { points: currentPath, color: currentColor, width: currentStrokeWidth });
        ctx.restore();
    }
}

function drawStroke(context, stroke) {
    if (!stroke.points || stroke.points.length < 2) {
        // Handle old segment-based format for backward compatibility if needed
        if (stroke.x1 !== undefined) {
            context.strokeStyle = stroke.color;
            context.lineWidth = stroke.width;
            context.beginPath();
            context.moveTo(stroke.x1, stroke.y1);
            context.lineTo(stroke.x2, stroke.y2);
            context.stroke();
        }
        return;
    }
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
        context.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    context.stroke();
}

window.addEventListener('resize', () => {
    redrawBuffer();
});

colorPicker.addEventListener('change', (e) => { currentColor = e.target.value; });
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

function handleStart(clientX, clientY) {
    if (isPanning) {
        handleGestureStart();
        [lastMouseX, lastMouseY] = [clientX, clientY];
        return;
    }
    drawing = true;
    currentPath = [getTransformedPoint(clientX, clientY)];
}

function handleMove(clientX, clientY) {
    if (isPanning && isGesturing) {
        const dx = clientX - lastMouseX;
        const dy = clientY - lastMouseY;
        const dpr = window.devicePixelRatio || 1;
        offsetX += dx * dpr;
        offsetY += dy * dpr;
        [lastMouseX, lastMouseY] = [clientX, clientY];
        requestAnimationFrame(drawFrame);
        return;
    }
    if (!drawing) return;
    currentPath.push(getTransformedPoint(clientX, clientY));
    requestAnimationFrame(drawFrame);
}

function handleEnd() {
    if (drawing && currentPath.length > 1) {
        const newStroke = {
            points: currentPath,
            color: currentColor,
            width: currentStrokeWidth
        };
        drawingHistory.push(newStroke);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'draw', data: newStroke }));
        }
        
        // Apply transform to buffer before drawing the final stroke
        bufferCtx.save();
        bufferCtx.translate(offsetX, offsetY);
        bufferCtx.scale(zoom, zoom);
        drawStroke(bufferCtx, newStroke); // Finalize path on buffer
        bufferCtx.restore();
    }
    drawing = false;
    currentPath = [];
    if (isGesturing) {
        handleGestureEnd();
    }
}

function handleGestureStart() {
    isGesturing = true;
    clearTimeout(gestureTimeout);
}

function handleGestureEnd() {
    clearTimeout(gestureTimeout);
    gestureTimeout = setTimeout(() => {
        if (isGesturing) {
            isGesturing = false;
            redrawBuffer();
        }
    }, 100);
}

canvas.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
canvas.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
canvas.addEventListener('mouseup', handleEnd);
canvas.addEventListener('mouseout', handleEnd);

function getDistance(touches) { return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); }

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        handleStart(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length >= 2) {
        drawing = false;
        currentPath = [];
        handleGestureStart();
        initialPinchDistance = getDistance(e.touches);
        [lastMouseX, lastMouseY] = [(e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2];
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && drawing) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2 && initialPinchDistance) {
        const newPinchDistance = getDistance(e.touches);
        const zoomFactor = newPinchDistance / initialPinchDistance;
        const currentCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const currentCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const dpr = window.devicePixelRatio || 1;
        const mouseX = currentCenterX * dpr;
        const mouseY = currentCenterY * dpr;
        const dx = currentCenterX - lastMouseX;
        const dy = currentCenterY - lastMouseY;
        offsetX += dx * dpr;
        offsetY += dy * dpr;
        const newZoom = zoom * zoomFactor;
        const mousePointX = (mouseX - offsetX) / zoom;
        const mousePointY = (mouseY - offsetY) / zoom;
        offsetX = mouseX - mousePointX * newZoom;
        offsetY = mouseY - mousePointY * newZoom;
        zoom = newZoom;
        initialPinchDistance = newPinchDistance;
        [lastMouseX, lastMouseY] = [currentCenterX, currentCenterY];
        requestAnimationFrame(drawFrame);
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        initialPinchDistance = null;
        if (isGesturing) handleGestureEnd();
    }
    if (e.touches.length < 1) {
        if (drawing) handleEnd();
    }
});
canvas.addEventListener('touchcancel', handleEnd);

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isPanning) {
        isPanning = true;
        canvas.style.cursor = 'move';
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isPanning = false;
        canvas.style.cursor = 'crosshair';
        if (isGesturing) handleGestureEnd();
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    handleGestureStart();
    const dpr = window.devicePixelRatio || 1;
    const mouseX = e.clientX * dpr;
    const mouseY = e.clientY * dpr;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.1, Math.min(zoom * zoomFactor, 20));
    const mousePointX = (mouseX - offsetX) / zoom;
    const mousePointY = (mouseY - offsetY) / zoom;
    offsetX = mouseX - mousePointX * newZoom;
    offsetY = mouseY - mousePointY * newZoom;
    zoom = newZoom;
    requestAnimationFrame(drawFrame);
    handleGestureEnd();
});

clearButton.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear' }));
    }
    drawingHistory = [];
    currentPath = [];
    redrawBuffer();
});

toggleControls.addEventListener('click', () => { controls.classList.toggle('hidden'); });

let ws;
let roomId;

function generateRoomId() { return Math.random().toString(36).substring(2, 8).toLowerCase(); }

function getOrCreateRoomId() {
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('room');
    if (!id || !/^[a-z0-9]{6}$/.test(id)) {
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
                // Apply transform to buffer before drawing the incoming stroke
                bufferCtx.save();
                bufferCtx.translate(offsetX, offsetY);
                bufferCtx.scale(zoom, zoom);
                drawStroke(bufferCtx, message.data);
                bufferCtx.restore();
                requestAnimationFrame(drawFrame);
                break;
            case 'clear':
                drawingHistory = [];
                currentPath = [];
                redrawBuffer();
                break;
            case 'history':
                drawingHistory = message.data;
                redrawBuffer();
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

redrawBuffer();
connectWebSocket();
canvas.style.cursor = 'crosshair';
controls.classList.add('hidden');