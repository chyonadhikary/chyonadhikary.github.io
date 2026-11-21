const PINS = [13, 14, 27, 26, 25];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17], [17, 13], [13, 9], [9, 5],
];
const state = {
  mode: 1,
  cameraStream: null,
  serialPort: null,
  serialWriter: null,
  serialReader: null,
  palm: 'waiting',
  brightness: 0,
  distance: 0,
  fingers: 0,
  demo: 'none',
  lastBrightnessSentAt: 0,
  lastLandmarks: null,
  lastHandAt: 0,
  handTrackingRun: 0,
  lastCommands: { 1: 'MODE1:OFF', 2: 'MODE2:0', 3: 'MODE3:0' },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function makeChannelRows() {
  $$('.matrix-channels').forEach((container) => {
    container.innerHTML = PINS.map((pin, index) => `
      <div class="channel-row" data-channel="${index}">
        <span class="channel-pin">GPIO ${pin}</span>
        <span class="channel-meta">LED ${index + 1}</span>
        <div class="channel-rail"><div class="channel-fill"></div></div>
        <span class="channel-state">OFF</span>
      </div>`).join('');
  });
}

function makeFingerControls() {
  $('#ledGrid').innerHTML = PINS.map((_, index) => `<div class="led-unit"><div class="led-node" data-led="${index}"></div><span class="led-id">${index + 1}</span></div>`).join('');
  $('#fingerGrid').innerHTML = FINGERS.map((finger) => `<div class="finger-chip-unit"><span class="finger-name">${finger}</span><span class="finger-state">DOWN</span></div>`).join('');
}

function getChannelValues() {
  if (state.mode === 1) return state.palm === 'open' ? [255, 255, 255, 255, 255] : [0, 0, 0, 0, 0];
  if (state.mode === 2) return PINS.map(() => state.brightness);
  if (state.mode === 3) return PINS.map((_, index) => index < state.fingers ? 255 : 0);
  return [0, 0, 0, 0, 0];
}

function updateMatrices() {
  const values = getChannelValues();
  $$('.matrix-card').forEach((card) => {
    card.querySelectorAll('.channel-row').forEach((row, index) => {
      const value = values[index] || 0;
      row.classList.toggle('is-on', value > 0);
      row.querySelector('.channel-fill').style.width = `${Math.max(3, (value / 255) * 100)}%`;
      row.querySelector('.channel-fill').style.opacity = value > 0 ? '1' : '0';
      row.querySelector('.channel-state').textContent = value > 0 ? (state.mode === 2 ? `${value}` : 'ON') : 'OFF';
    });
  });
  $('#cmd1').textContent = state.lastCommands[1];
  $('#cmd2').textContent = state.lastCommands[2];
  $('#cmd3').textContent = state.lastCommands[3];
}

async function sendSerial(command, mode = state.mode) {
  state.lastCommands[mode] = command;
  updateMatrices();
  if (!state.serialWriter) return;
  try {
    await state.serialWriter.write(new TextEncoder().encode(`${command}\n`));
  } catch {
    showToast('Serial write failed — check the USB connection.');
  }
}

function setPalm(value, shouldSend = true) {
  if (state.palm === value && shouldSend) return;
  state.palm = value;
  const label = value === 'open' ? 'OPEN PALM' : value === 'closed' ? 'CLOSED FIST' : 'WAITING FOR HAND';
  $('#palmState').textContent = label;
  $('#palmState').className = `state-pill ${value === 'open' ? 'open' : ''}`;
  if (shouldSend && value !== 'waiting') sendSerial(`MODE1:${value === 'open' ? 'ON' : 'OFF'}`, 1);
  updateMatrices();
}

function setBrightness(value, shouldSend = true) {
  const nextBrightness = Math.max(0, Math.min(255, Math.round(value)));
  if (shouldSend && nextBrightness === state.brightness) return;
  state.brightness = nextBrightness;
  state.distance = state.brightness / 255;
  const percentage = Math.round((state.brightness / 255) * 100);
  $('#brightnessValue').textContent = `${state.brightness} / 255 (${percentage}%)`;
  $('#brightnessBar').style.width = `${percentage}%`;
  $('#pinchDistance').textContent = state.distance.toFixed(3);
  if (shouldSend) sendSerial(`MODE2:${state.brightness}`, 2);
  updateMatrices();
}

function setFingers(value, shouldSend = true) {
  const nextFingers = Math.max(0, Math.min(5, Math.round(value)));
  if (shouldSend && nextFingers === state.fingers) return;
  state.fingers = nextFingers;
  $('#fingerCount').textContent = state.fingers;
  $('#fingerState').textContent = state.fingers === 0 ? 'All Outputs Inactive' : `${state.fingers} LED${state.fingers === 1 ? '' : 's'} Active`;
  $$('.finger-chip-unit').forEach((chip, index) => {
    const extended = index < state.fingers;
    chip.classList.toggle('extended', extended);
    chip.querySelector('.finger-state').textContent = extended ? 'UP' : 'DOWN';
  });
  $$('.led-node').forEach((node, index) => node.classList.toggle('active', index < state.fingers));
  if (shouldSend) sendSerial(`MODE3:${state.fingers}`, 3);
  updateMatrices();
}

function setMode(mode) {
  state.mode = Number(mode);
  $$('.tab-btn').forEach((tab) => {
    const active = Number(tab.dataset.mode) === state.mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('.mode-pane').forEach((pane) => {
    const active = pane.id === `mode${state.mode}`;
    pane.classList.toggle('active', active);
    pane.hidden = !active;
  });
  updateMatrices();
}

async function enableCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $('#fallbackTitle').textContent = 'Camera unavailable';
    $('#fallbackDesc').textContent = 'This browser does not expose camera access. Use the demo input controls below to test the modes.';
    $('#enableCamera').hidden = true;
    $('#cameraDemoControls').hidden = false;
    showToast('Camera access is not available in this browser.');
    return;
  }
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const video = $('#webcamVideo');
    video.srcObject = state.cameraStream;
    await video.play();
    $('#viewportFrame').classList.add('video-live');
    $('#cameraDemoControls').hidden = false;
    $('#trackingStatus').textContent = 'Camera Live · Hand Tracking';
    $('#enableCamera').hidden = true;
    $('#fallbackDesc').textContent = 'Video is processed locally in your browser and never uploaded.';
    startCameraOverlay();
    startHandTracking(video);
    showToast('Camera enabled locally.');
  } catch {
    $('#fallbackTitle').textContent = 'Camera permission needed';
    $('#fallbackDesc').textContent = 'Allow camera access in your browser, or use Demo input to test the hardware states without a camera.';
    $('#cameraDemoControls').hidden = false;
    showToast('Camera permission was not granted.');
  }
}

function startCameraOverlay() {
  const canvas = $('#outputCanvas');
  const ctx = canvas.getContext('2d');
  let frameCount = 0;
  let lastTime = performance.now();
  function draw() {
    if (!state.cameraStream) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.clearRect(0, 0, width, height);
    const pulse = 0.18 + Math.sin(performance.now() / 500) * 0.04;
    ctx.strokeStyle = `rgba(43,255,0,${pulse})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(18, 18, width - 36, height - 36);
    drawHandOverlay(ctx, width, height, performance.now());
    frameCount += 1;
    const now = performance.now();
    if (now - lastTime > 900) {
      $('#fpsDisplay').textContent = `${Math.round((frameCount * 1000) / (now - lastTime))} FPS`;
      frameCount = 0;
      lastTime = now;
    }
    requestAnimationFrame(draw);
  }
  draw();
}

function drawHandOverlay(ctx, width, height, now) {
  if (!state.lastLandmarks || now - state.lastHandAt > 260) return;
  const points = state.lastLandmarks;
  const point = (index) => ({ x: points[index].x * width, y: points[index].y * height });
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(43,255,0,.55)';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = '#2bff00';
  ctx.lineWidth = Math.max(3, Math.min(width, height) * 0.0065);
  HAND_CONNECTIONS.forEach(([from, to]) => {
    const a = point(from);
    const b = point(to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  const wave = 1 + Math.sin(now / 150) * 0.12;
  points.forEach((_, index) => {
    const p = point(index);
    const fingertip = [4, 8, 12, 16, 20].includes(index);
    ctx.beginPath();
    ctx.shadowColor = 'rgba(255,28,28,.45)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#ff1c1c';
    ctx.arc(p.x, p.y, (fingertip ? 6.2 : 4.8) * (fingertip ? wave : 1), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function startHandTracking(video) {
  if (typeof Hands === 'undefined') {
    $('#trackingStatus').textContent = 'Camera Live · Demo Tracking';
    return;
  }
  const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  const runId = ++state.handTrackingRun;
  hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.62, minTrackingConfidence: 0.58 });
  hands.onResults((results) => {
    const landmarks = results.multiHandLandmarks?.[0];
    if (!landmarks) {
      $('#trackingStatus').textContent = 'No Hand Detected';
      if (performance.now() - state.lastHandAt > 180) state.lastLandmarks = null;
      if (state.mode === 1) setPalm('waiting', false);
      return;
    }
    const previous = state.lastLandmarks;
    state.lastLandmarks = landmarks.map((landmark, index) => {
      const old = previous?.[index];
      return old ? {
        x: old.x * 0.56 + landmark.x * 0.44,
        y: old.y * 0.56 + landmark.y * 0.44,
        z: old.z * 0.56 + landmark.z * 0.44,
      } : { x: landmark.x, y: landmark.y, z: landmark.z };
    });
    state.lastHandAt = performance.now();
    $('#trackingStatus').textContent = 'Hand Tracked (1)';
    const extended = [8, 12, 16, 20].map((tip) => landmarks[tip].y < landmarks[tip - 2].y);
    const thumbExtended = Math.abs(landmarks[4].x - landmarks[2].x) > 0.08;
    const fingerCount = extended.filter(Boolean).length + (thumbExtended ? 1 : 0);
    const pinchDistance = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y);
    if (state.mode === 1) {
      setPalm(fingerCount >= 4 ? 'open' : fingerCount <= 1 ? 'closed' : 'waiting');
    } else if (state.mode === 2) {
      const brightness = ((pinchDistance - 0.025) / 0.22) * 255;
      const now = performance.now();
      if (now - state.lastBrightnessSentAt > 90 || Math.abs(brightness - state.brightness) > 4) {
        state.lastBrightnessSentAt = now;
        setBrightness(brightness);
      }
    } else if (state.mode === 3) {
      setFingers(fingerCount);
    }
  });
  const processFrame = async () => {
    if (!state.cameraStream || runId !== state.handTrackingRun) return;
    try { await hands.send({ image: video }); } catch { /* keep camera usable when model assets are blocked */ }
    window.setTimeout(processFrame, 100);
  };
  processFrame();
}

async function connectSerial() {
  if (!('serial' in navigator)) {
    showToast('Web Serial is not supported here. Try Chrome or Edge on desktop.');
    return;
  }
  if (state.serialPort) {
    await disconnectSerial('USB Serial disconnected.');
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    state.serialPort = port;
    state.serialWriter = port.writable?.getWriter() || null;
    $('#statusDot').classList.add('connected');
    $('#statusText').textContent = 'Connected';
    $('#serialButtonText').textContent = 'Disconnect USB Serial';
    void readSerialOutput(port);
    showToast('ESP32 connected at 115200 baud.');
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Could not connect to that serial port.');
  }
}

async function readSerialOutput(port) {
  if (!port.readable) return;
  const reader = port.readable.getReader();
  state.serialReader = reader;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (state.serialPort === port) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.filter(Boolean).forEach((line) => {
        if (/controller ready|hardware.*initialized/i.test(line)) {
          $('#statusText').textContent = 'Connected · Ready';
          window.clearTimeout(readSerialOutput.statusTimer);
          readSerialOutput.statusTimer = window.setTimeout(() => {
            if (state.serialPort === port) $('#statusText').textContent = 'Connected';
          }, 2600);
        }
      });
    }
  } catch {
    if (state.serialPort === port) await disconnectSerial('Serial connection lost.');
  } finally {
    try { reader.releaseLock(); } catch {}
    if (state.serialReader === reader) state.serialReader = null;
  }
}

async function disconnectSerial(message = 'USB Serial disconnected.') {
  const port = state.serialPort;
  state.serialPort = null;
  if (state.serialReader) {
    try { await state.serialReader.cancel(); } catch {}
    state.serialReader = null;
  }
  if (state.serialWriter) {
    try { state.serialWriter.releaseLock(); } catch {}
    state.serialWriter = null;
  }
  if (port) {
    try { await port.close(); } catch {}
  }
  $('#statusDot').classList.remove('connected');
  $('#statusText').textContent = 'Disconnected';
  $('#serialButtonText').textContent = 'Connect USB Serial';
  showToast(message);
}

function initDemoControls() {
  $$('.demo-chip').forEach((button) => button.addEventListener('click', () => {
    state.demo = button.dataset.demo;
    $$('.demo-chip').forEach((item) => item.classList.toggle('active', item === button));
    if (state.demo === 'open') setPalm('open');
    else if (state.demo === 'closed') setPalm('closed');
    else if (state.demo === 'pinch') { setMode(2); setBrightness(128); }
    else if (state.demo === 'fingers') { setMode(3); setFingers(3); }
    else setPalm('waiting', false);
  }));
}

makeChannelRows();
makeFingerControls();
updateMatrices();
$$('.tab-btn').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('#enableCamera').addEventListener('click', enableCamera);
$('#connectSerial').addEventListener('click', connectSerial);
initDemoControls();
if ('serial' in navigator) {
  navigator.serial.addEventListener('disconnect', ({ port }) => {
    if (state.serialPort === port) void disconnectSerial('ESP32 USB connection was removed.');
  });
}
window.addEventListener('beforeunload', () => {
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  if (state.serialReader) void state.serialReader.cancel();
  if (state.serialWriter) try { state.serialWriter.releaseLock(); } catch {}
});
