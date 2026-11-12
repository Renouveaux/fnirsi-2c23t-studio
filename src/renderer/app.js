// FNIRSI 2C23T Studio - Core Application Logic

let currentDeviceStatus = null;
let scopeRunning = true;
let liveScopeWave1 = null;
let liveScopeWave2 = null;
let lastScopeWaveTime = 0;
let liveScopeMeta = {
  tb: '1ms',
  v1: '1V',
  v2: '1V',
  f1: 0,
  vpp1: 0,
  f2: 0,
  vpp2: 0,
  running: true,
  ch1En: true,
  ch2En: true
};
let activeWavePreset = 'sine';
let wavePoints = 64;
let maxMv = 2500;
let customPoints = [];
let isDrawingWave = false;

// DOM Elements
const statusPill = document.getElementById('statusPill');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const metaHw = document.getElementById('metaHw');
const metaDrive = document.getElementById('metaDrive');
const btnRefresh = document.getElementById('btnRefresh');
const btnOpenExplorer = document.getElementById('btnOpenExplorer');

// Tabs & Navigation
const navItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');
const instrumentButtons = document.querySelectorAll('.btn-instrument');

// Toast
const toast = document.getElementById('toast');
function showToast(msg, duration = 3000) {
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// 3-in-1 Instrument & Tab Switching
function switchTab(target) {
  navItems.forEach(n => {
    n.classList.toggle('active', n.dataset.tab === target);
  });
  instrumentButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === target);
  });
  tabPanels.forEach(p => {
    p.classList.toggle('active', p.id === `tab-${target}`);
  });

  if (target === 'gallery') loadScreenshots();
  if (target === 'dmm') renderDmmCanvas();
}

navItems.forEach(item => {
  item.addEventListener('click', () => switchTab(item.dataset.tab));
});

instrumentButtons.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Refresh button
btnRefresh.addEventListener('click', async () => {
  showToast('Scanne USB-Laufwerke...');
  const status = await window.api.getStatus();
  updateDeviceUI(status);
});

btnOpenExplorer.addEventListener('click', async () => {
  if (currentDeviceStatus && currentDeviceStatus.driveLetter) {
    await window.api.openInExplorer(currentDeviceStatus.driveLetter);
  } else {
    showToast('Kein 2C23T Laufwerk aktiv');
  }
});

// Update Device Status in Header
function updateDeviceUI(status) {
  currentDeviceStatus = status;
  statusPill.className = 'status-pill';

  if (!status.connected) {
    statusPill.classList.add('offline');
    statusText.innerText = 'Kein 2C23T erkannt';
    metaHw.innerText = 'HW: --';
    metaDrive.innerText = 'Laufwerk: --';
    return;
  }

  if (status.mode === 'BOOTLOADER') {
    statusPill.classList.add('bootloader');
    statusText.innerText = 'BootLoader Modus (Bereit)';
    metaHw.innerText = 'IAP Bootloader';
    metaDrive.innerText = `Laufwerk: ${status.driveLetter}`;
  } else {
    statusPill.classList.add('online');
    statusText.innerText = status.firmwareVersion || 'Verbunden';
    metaHw.innerText = status.hwVersion;
    metaDrive.innerText = `Laufwerk: ${status.driveLetter}`;

    if (status.bootloaderCrc) {
      document.getElementById('valBootloaderCrc').innerText = status.bootloaderCrc;
    }
  }
}

// Initial status fetch & listener
window.api.getStatus().then(updateDeviceUI);
window.api.onStatusChange(updateDeviceUI);

// ==========================================
// 0. DIGITAL-MULTIMETER & DATENLOGGER (DMM)
// ==========================================
let dmmMode = 'DCV';
let dmmUnit = 'V';
let dmmSubtype = 'DC';
let dmmHold = false;
let dmmRel = false;
let dmmRelBaseline = 0;
let dmmAuto = true;
let dmmBuzzerEnabled = true;
let dmmLoggerRunning = true;
let dmmTimeWindow = 60; // seconds

let dmmHistory = [];
let dmmStats = { min: null, max: null, count: 0, sum: 0 };
let dmmLogCounter = 0;

// Audio Buzzer for Continuity (Web Audio API)
let audioCtx = null;
let buzzerOsc = null;

function playBuzzer(freq = 2400) {
  if (!dmmBuzzerEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    if (buzzerOsc) return;

    buzzerOsc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    buzzerOsc.type = 'sine';
    buzzerOsc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    buzzerOsc.connect(gain);
    gain.connect(audioCtx.destination);
    buzzerOsc.start();
  } catch (e) {}
}

function stopBuzzer() {
  if (buzzerOsc) {
    try {
      buzzerOsc.stop();
      buzzerOsc.disconnect();
    } catch(e) {}
    buzzerOsc = null;
  }
}

// DOM Elements for DMM
const dmmValueEl = document.getElementById('dmmValue');
const dmmSignEl = document.getElementById('dmmSign');
const dmmUnitEl = document.getElementById('dmmUnit');
const dmmBargraphFill = document.getElementById('dmmBargraphFill');
const dmmClockEl = document.getElementById('dmmClock');

const dmmStatMinEl = document.getElementById('dmmStatMin');
const dmmStatMaxEl = document.getElementById('dmmStatMax');
const dmmStatAvgEl = document.getElementById('dmmStatAvg');
const dmmStatRelEl = document.getElementById('dmmStatRel');

const tagDmmSubtype = document.getElementById('tagDmmSubtype');
const tagDmmAuto = document.getElementById('tagDmmAuto');
const tagDmmHold = document.getElementById('tagDmmHold');
const tagDmmRel = document.getElementById('tagDmmRel');
const tagDmmBuzzer = document.getElementById('tagDmmBuzzer');

const btnDmmHold = document.getElementById('btnDmmHold');
const btnDmmRel = document.getElementById('btnDmmRel');
const btnDmmRange = document.getElementById('btnDmmRange');
const btnDmmResetStats = document.getElementById('btnDmmResetStats');
const btnDmmBuzzer = document.getElementById('btnDmmBuzzer');

const btnDmmRun = document.getElementById('btnDmmRun');
const btnDmmExportCsv = document.getElementById('btnDmmExportCsv');
const btnDmmClearLogger = document.getElementById('btnDmmClearLogger');

const selDmmWindow = document.getElementById('selDmmWindow');
const dmmCanvas = document.getElementById('dmmCanvas');
const dmmCtx = dmmCanvas ? dmmCanvas.getContext('2d') : null;
const dmmTableBody = document.getElementById('dmmTableBody');
const lblLogCount = document.getElementById('lblLogCount');

// Reset Statistics
function resetDmmStats() {
  dmmStats = { min: null, max: null, count: 0, sum: 0 };
  if (dmmStatMinEl) dmmStatMinEl.innerText = '--';
  if (dmmStatMaxEl) dmmStatMaxEl.innerText = '--';
  if (dmmStatAvgEl) dmmStatAvgEl.innerText = '--';
  if (dmmStatRelEl) dmmStatRelEl.innerText = '0.000';
}

// Mode Selection Buttons
document.querySelectorAll('.btn-dmm-mode').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-dmm-mode').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    dmmMode = btn.dataset.mode;
    dmmUnit = btn.dataset.unit;
    dmmSubtype = btn.dataset.subtype;

    if (tagDmmSubtype) tagDmmSubtype.innerText = dmmSubtype;
    if (dmmUnitEl) dmmUnitEl.innerText = dmmUnit;

    resetDmmStats();
    stopBuzzer();

    // Synchronize mode change to physical 2C23T hardware
    if (window.api && window.api.sendDmmCommand) {
      window.api.sendDmmCommand('MODE:' + dmmMode);
    }
  });
});

// Softkeys
btnDmmHold?.addEventListener('click', () => {
  dmmHold = !dmmHold;
  btnDmmHold.classList.toggle('active', dmmHold);
  tagDmmHold.classList.toggle('active', dmmHold);
  showToast(dmmHold ? 'HOLD: Messwert eingefroren' : 'HOLD: Deaktiviert');
});

btnDmmRel?.addEventListener('click', () => {
  dmmRel = !dmmRel;
  btnDmmRel.classList.toggle('active', dmmRel);
  tagDmmRel.classList.toggle('active', dmmRel);

  if (dmmRel) {
    const cur = parseFloat(dmmValueEl.innerText) || 0;
    dmmRelBaseline = cur;
    showToast(`REL Δ: Nullpunkt auf ${cur} ${dmmUnit} gesetzt`);
  } else {
    dmmRelBaseline = 0;
    showToast('REL Δ: Deaktiviert');
  }
});

btnDmmRange?.addEventListener('click', () => {
  dmmAuto = !dmmAuto;
  tagDmmAuto.classList.toggle('active', dmmAuto);
  btnDmmRange.innerText = dmmAuto ? 'RANGE: AUTO' : 'RANGE: MAN';
  btnDmmRange.classList.toggle('active', !dmmAuto);
});

btnDmmResetStats?.addEventListener('click', () => {
  resetDmmStats();
  showToast('Statistiken zurückgesetzt');
});

btnDmmBuzzer?.addEventListener('click', () => {
  dmmBuzzerEnabled = !dmmBuzzerEnabled;
  btnDmmBuzzer.classList.toggle('active', dmmBuzzerEnabled);
  tagDmmBuzzer.classList.toggle('active', dmmBuzzerEnabled);
  btnDmmBuzzer.innerText = dmmBuzzerEnabled ? 'BUZZER ON' : 'BUZZER OFF';
  if (!dmmBuzzerEnabled) stopBuzzer();
  showToast(dmmBuzzerEnabled ? 'Durchgangs-Buzzer aktiv' : 'Buzzer stummgeschaltet');
});

// Logger Controls
btnDmmRun?.addEventListener('click', () => {
  dmmLoggerRunning = !dmmLoggerRunning;
  btnDmmRun.innerText = dmmLoggerRunning ? 'LOGGER: STOP' : 'LOGGER: START';
  btnDmmRun.style.color = dmmLoggerRunning ? '' : '#10b981';
  showToast(dmmLoggerRunning ? 'Messwert-Schreiber fortgesetzt' : 'Messwert-Schreiber pausiert');
});

btnDmmClearLogger?.addEventListener('click', () => {
  dmmHistory = [];
  dmmLogCounter = 0;
  if (dmmTableBody) dmmTableBody.innerHTML = '';
  if (lblLogCount) lblLogCount.innerText = '0';
  resetDmmStats();
  renderDmmCanvas();
  showToast('Datenlogger geleert');
});

selDmmWindow?.addEventListener('change', (e) => {
  dmmTimeWindow = parseInt(e.target.value, 10);
  renderDmmCanvas();
});

// CSV Export
btnDmmExportCsv?.addEventListener('click', async () => {
  if (dmmHistory.length === 0) {
    showToast('Keine Messdaten zum Exportieren vorhanden');
    return;
  }

  let csv = 'Nr;Zeitstempel;Messbereich;Messwert;Einheit;Status\r\n';
  dmmHistory.forEach((item, idx) => {
    csv += `${idx + 1};${item.timeStr};${item.mode};${item.value.toFixed(4).replace('.', ',')};${item.unit};${item.status}\r\n`;
  });

  const filename = `DMM_Messung_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  const res = await window.api.saveCsv(filename, csv);
  if (res && res.success) {
    showToast(`Messreihe gespeichert in: ${res.filePath}`);
  }
});

// Hardware Status and Elements
const btnDmmSerialConnect = document.getElementById("btnDmmSerialConnect");
const tagDmmLive = document.getElementById("tagDmmLive");
const boxDmmLiveStatus = document.getElementById("boxDmmLiveStatus");
const lblDmmHwPort = document.getElementById("lblDmmHwPort");
const lblDmmHwMsg = document.getElementById("lblDmmHwMsg");

let serialPort = null;
let serialReader = null;
let isLiveSerialConnected = false;
// Apply Reading to OLED UI, Stats & Logger
function applyDmmReadingToUi(reading) {
  const now = new Date();
  if (dmmClockEl) dmmClockEl.innerText = now.toTimeString().split(' ')[0];

  if (!dmmHold) {
    if (dmmSignEl) dmmSignEl.innerText = reading.sign || '';
    if (dmmValueEl) dmmValueEl.innerText = reading.formatted;
    if (dmmBargraphFill) dmmBargraphFill.style.width = `${Math.min(100, Math.max(0, reading.barPercent))}%`;

    // Compute stats
    if (reading.status !== 'OVERLOAD' && reading.status !== 'OPEN' && reading.formatted !== '0.L') {
      const num = reading.val;
      if (dmmStats.min === null || num < dmmStats.min) dmmStats.min = num;
      if (dmmStats.max === null || num > dmmStats.max) dmmStats.max = num;
      dmmStats.count++;
      dmmStats.sum += num;

      if (dmmStatMinEl) dmmStatMinEl.innerText = dmmStats.min.toFixed(3);
      if (dmmStatMaxEl) dmmStatMaxEl.innerText = dmmStats.max.toFixed(3);
      if (dmmStatAvgEl) dmmStatAvgEl.innerText = (dmmStats.sum / dmmStats.count).toFixed(3);

      if (dmmRel && dmmStatRelEl) {
        const delta = num - dmmRelBaseline;
        dmmStatRelEl.innerText = (delta >= 0 ? '+' : '') + delta.toFixed(3);
      }
    }
  }

  // Push to Logger if active
  if (dmmLoggerRunning && !dmmHold) {
    dmmLogCounter++;
    const entry = {
      id: dmmLogCounter,
      time: now.getTime(),
      timeStr: now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0'),
      mode: dmmMode,
      value: reading.val,
      displayStr: reading.formatted,
      unit: dmmUnit,
      status: reading.status
    };

    dmmHistory.push(entry);

    const maxEntries = 2000;
    if (dmmHistory.length > maxEntries) {
      dmmHistory.shift();
    }

    if (lblLogCount) lblLogCount.innerText = dmmHistory.length;

    // Add row to table (prepend latest)
    if (dmmTableBody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${entry.id}</td>
        <td>${entry.timeStr}</td>
        <td>${entry.mode}</td>
        <td class="val-cyan">${entry.displayStr}</td>
        <td>${entry.unit}</td>
        <td><span class="badge" style="font-size:10px; padding:1px 5px;">${entry.status}</span></td>
      `;
      dmmTableBody.insertBefore(tr, dmmTableBody.firstChild);
      if (dmmTableBody.children.length > 100) {
        dmmTableBody.removeChild(dmmTableBody.lastChild);
      }
    }

    renderDmmCanvas();
  }
}

// Render Real-time Trend Canvas
function renderDmmCanvas() {
  if (!dmmCanvas || !dmmCtx) return;
  const w = dmmCanvas.width;
  const h = dmmCanvas.height;

  // Clear Background
  dmmCtx.fillStyle = '#050813';
  dmmCtx.fillRect(0, 0, w, h);

  // Draw Grid
  dmmCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  dmmCtx.lineWidth = 1;

  for (let x = 0; x < w; x += 50) {
    dmmCtx.beginPath();
    dmmCtx.moveTo(x, 0);
    dmmCtx.lineTo(x, h);
    dmmCtx.stroke();
  }

  for (let y = 0; y < h; y += 40) {
    dmmCtx.beginPath();
    dmmCtx.moveTo(0, y);
    dmmCtx.lineTo(w, y);
    dmmCtx.stroke();
  }

  if (dmmHistory.length < 2) {
    dmmCtx.fillStyle = "#64748b";
    dmmCtx.font = "13px \"Cascadia Code\", Consolas, monospace";
    dmmCtx.textAlign = "center";
    if (isLiveSerialConnected) {
      dmmCtx.fillText("Warte auf Messdaten vom 2C23T Multimeter...", w / 2, h / 2);
    } else {
      dmmCtx.fillText("Keine Live-Verbindung • Bitte oben auf \"LIVE USB VERBINDEN\" klicken", w / 2, h / 2);
    }
    dmmCtx.textAlign = "left";
    return;
  }

  // Filter history to current time window
  const now = Date.now();
  const windowMs = dmmTimeWindow * 1000;
  const visible = dmmHistory.filter(pt => (now - pt.time) <= windowMs);

  if (visible.length < 2) return;

  // Determine min & max for auto-scaling
  let minVal = Infinity;
  let maxVal = -Infinity;
  visible.forEach(pt => {
    if (pt.value < minVal) minVal = pt.value;
    if (pt.value > maxVal) maxVal = pt.value;
  });

  const range = maxVal - minVal;
  const pad = range === 0 ? 1 : range * 0.15;
  const plotMin = minVal - pad;
  const plotMax = maxVal + pad;
  const plotRange = plotMax - plotMin;

  // Labels
  dmmCtx.fillStyle = '#64748b';
  dmmCtx.font = '10px "Cascadia Code", Consolas, monospace';
  dmmCtx.fillText(`Max: ${maxVal.toFixed(3)} ${dmmUnit}`, 10, 16);
  dmmCtx.fillText(`Min: ${minVal.toFixed(3)} ${dmmUnit}`, 10, h - 8);

  // Path
  dmmCtx.beginPath();
  visible.forEach((pt, idx) => {
    const timeDelta = now - pt.time;
    const x = w - (timeDelta / windowMs) * (w - 40);
    const y = h - ((pt.value - plotMin) / plotRange) * (h - 40) - 20;

    if (idx === 0) dmmCtx.moveTo(x, y);
    else dmmCtx.lineTo(x, y);
  });

  // Glowing line
  dmmCtx.strokeStyle = '#00f2fe';
  dmmCtx.lineWidth = 2.2;
  dmmCtx.shadowColor = 'rgba(0, 242, 254, 0.7)';
  dmmCtx.shadowBlur = 10;
  dmmCtx.stroke();

  // Gradient fill area
  const lastX = w;
  const firstPtTime = now - visible[0].time;
  const firstX = w - (firstPtTime / windowMs) * (w - 40);

  dmmCtx.lineTo(lastX, h);
  dmmCtx.lineTo(firstX, h);
  dmmCtx.closePath();

  const grad = dmmCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0, 242, 254, 0.25)');
  grad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
  dmmCtx.fillStyle = grad;
  dmmCtx.fill();

  dmmCtx.shadowBlur = 0;

  // Current point glow dot
  const latest = visible[visible.length - 1];
  const curY = h - ((latest.value - plotMin) / plotRange) * (h - 40) - 20;
  dmmCtx.beginPath();
  dmmCtx.arc(w - 10, curY, 4, 0, Math.PI * 2);
  dmmCtx.fillStyle = '#fb923c';
  dmmCtx.shadowColor = 'rgba(251, 146, 60, 0.8)';
  dmmCtx.shadowBlur = 8;
  dmmCtx.fill();
  dmmCtx.shadowBlur = 0;
}

// ==========================================
// 0.1 LIVE USB-CDC SERIAL TELEMETRY STREAM
// ==========================================

function updateSerialConnectionUI(connected, port) {
  isLiveSerialConnected = connected;
  if (connected) {
    if (tagDmmLive) {
      tagDmmLive.innerText = 'LIVE USB';
      tagDmmLive.style.borderColor = '#10b981';
      tagDmmLive.style.color = '#10b981';
      tagDmmLive.style.background = 'rgba(16, 185, 129, 0.15)';
    }
    if (btnDmmSerialConnect) {
      btnDmmSerialConnect.innerText = '● LIVE NEU VERBINDEN';
      btnDmmSerialConnect.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btnDmmSerialConnect.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.3)';
    }
    if (boxDmmLiveStatus) {
      boxDmmLiveStatus.style.display = 'block';
      boxDmmLiveStatus.innerText = `● LIVE TELEMETRIE AKTIV (${port || 'COM4'})`;
    }
    if (lblDmmHwMsg) lblDmmHwMsg.innerText = 'Live-Messwerte werden empfangen.';
  } else {
    if (tagDmmLive) {
      tagDmmLive.innerText = 'WARTE AUF GERÄT';
      tagDmmLive.style.borderColor = '#64748b';
      tagDmmLive.style.color = '#94a3b8';
      tagDmmLive.style.background = '';
    }
    if (btnDmmSerialConnect) {
      btnDmmSerialConnect.innerText = '● LIVE USB VERBINDEN';
      btnDmmSerialConnect.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btnDmmSerialConnect.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.3)';
    }
    if (boxDmmLiveStatus) boxDmmLiveStatus.style.display = 'none';
    if (lblDmmHwMsg) lblDmmHwMsg.innerText = 'Warte auf Verbindung... Gerät anstecken und auf DMM stellen.';
  }
}

function processLiveDmmLine(line) {
  // Telemetry Format: $DMM,mode,val,unit,status
  // Example: $DMM,ACV,230.1,V,OK  or  $DMM,RES,4.72,KOHM,OK
  const parts = line.split(',');
  if (parts.length < 5) return;

  const modeTag = parts[1].trim().toUpperCase();
  let rawVal = parts[2].trim();
  let rawUnit = parts[3].trim().toUpperCase();
  const rawValid = parts[4].trim();

  let detectedMode = dmmMode;
  let cleanUnit = dmmUnit || 'V';
  let subtype = dmmSubtype || 'DC';

  // 1. Direct explicit mode matching from OpenScope firmware
  switch (modeTag) {
    case 'ACV':
      detectedMode = 'ACV';
      cleanUnit = 'V';
      subtype = 'AC TRMS';
      break;
    case 'DCV':
      detectedMode = 'DCV';
      cleanUnit = 'V';
      subtype = 'DC';
      break;
    case 'ACA':
      detectedMode = 'ACA';
      cleanUnit = 'A';
      subtype = 'AC TRMS';
      break;
    case 'DCA':
      detectedMode = 'DCA';
      cleanUnit = 'A';
      subtype = 'DC';
      break;
    case 'ACMA':
      detectedMode = 'MA';
      cleanUnit = 'mA';
      subtype = 'AC TRMS';
      break;
    case 'DCMA':
      detectedMode = 'MA';
      cleanUnit = 'mA';
      subtype = 'DC';
      break;
    case 'RES':
      detectedMode = 'RES';
      subtype = 'RES';
      cleanUnit = rawUnit.replace('KOHM', 'kΩ').replace('MOHM', 'MΩ').replace('OHM', 'Ω');
      break;
    case 'CONT':
      detectedMode = 'CONT';
      subtype = 'CONT';
      cleanUnit = 'Ω';
      break;
    case 'DIODE':
      detectedMode = 'DIODE';
      subtype = 'DIODE';
      cleanUnit = 'V';
      break;
    case 'CAP':
      detectedMode = 'CAP';
      subtype = 'CAP';
      cleanUnit = rawUnit.replace('NF', 'nF').replace('UF', 'µF').replace('PF', 'pF').replace('MF', 'mF');
      break;
    case 'TEMP':
      detectedMode = 'TEMP';
      subtype = 'TEMP';
      cleanUnit = '°C';
      break;
    case 'LIVE':
      detectedMode = 'DCV';
      subtype = 'LIVE';
      cleanUnit = 'V';
      break;
    default:
      // Fallback for legacy telemetry formats
      if (rawUnit === 'V') {
        detectedMode = (dmmMode === 'ACV' || modeTag.includes('AC')) ? 'ACV' : 'DCV';
        cleanUnit = 'V';
        subtype = detectedMode === 'ACV' ? 'AC TRMS' : 'DC';
      } else if (rawUnit === 'MV') {
        detectedMode = 'DCMV';
        cleanUnit = 'mV';
        subtype = 'DC';
      } else if (rawUnit === 'A') {
        detectedMode = (dmmMode === 'ACA' || modeTag.includes('AC')) ? 'ACA' : 'DCA';
        cleanUnit = 'A';
        subtype = detectedMode === 'ACA' ? 'AC TRMS' : 'DC';
      } else if (rawUnit === 'MA') {
        detectedMode = 'MA';
        cleanUnit = 'mA';
        subtype = modeTag.includes('AC') ? 'AC TRMS' : 'DC';
      } else if (rawUnit.includes('OHM') || rawUnit.includes('Ω')) {
        cleanUnit = rawUnit.replace('KOHM', 'kΩ').replace('MOHM', 'MΩ').replace('OHM', 'Ω');
        detectedMode = (dmmMode === 'CONT' || modeTag === 'CONT') ? 'CONT' : 'RES';
        subtype = detectedMode === 'CONT' ? 'CONT' : 'RES';
      } else if (rawUnit.includes('F')) {
        detectedMode = 'CAP';
        cleanUnit = rawUnit.replace('NF', 'nF').replace('UF', 'µF').replace('PF', 'pF');
        subtype = 'CAP';
      } else if (rawUnit.includes('DEG') || rawUnit.includes('C')) {
        detectedMode = 'TEMP';
        cleanUnit = '°C';
        subtype = 'TEMP';
      } else if (rawUnit.includes('HZ')) {
        detectedMode = 'FREQ';
        cleanUnit = rawUnit.includes('KHZ') ? 'kHz' : 'Hz';
        subtype = 'FREQ';
      }
      break;
  }

  // Synchronize UI active button when hardware mode changes
  if (detectedMode !== dmmMode) {
    dmmMode = detectedMode;
    document.querySelectorAll('.btn-dmm-mode').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === dmmMode);
    });
  }

  dmmUnit = cleanUnit;
  dmmSubtype = subtype;
  if (dmmUnitEl) dmmUnitEl.innerText = cleanUnit;
  if (tagDmmSubtype) tagDmmSubtype.innerText = subtype;

  // Format value & sign
  let numVal = 0;
  let formatted = rawVal;
  let sign = '';
  let status = rawValid === 'OK' ? 'OK' : 'HOLD';

  if (rawVal.startsWith('-')) {
    sign = '-';
    rawVal = rawVal.substring(1);
  }

  if (rawVal === 'OPEN' || rawVal === 'O.L' || rawVal === '0.L') {
    formatted = '0.L';
    status = 'OVERLOAD';
    numVal = 0;
    stopBuzzer();
  } else {
    numVal = parseFloat(rawVal) || 0;
    formatted = rawVal;

    // Buzzer only in continuity mode
    if (dmmMode === 'CONT') {
      if (numVal < 50 && rawVal !== 'OPEN' && status !== 'OVERLOAD') {
        playBuzzer(2400);
        status = 'BUZZ';
      } else {
        stopBuzzer();
      }
    } else {
      stopBuzzer();
    }
  }

  // Calculate bargraph fill (0 to 100%)
  const maxRef = numVal > 100 ? 500 : (numVal > 10 ? 50 : 10);
  const barPercent = Math.min(100, Math.max(0, (Math.abs(numVal) / maxRef) * 100));

  applyDmmReadingToUi({
    val: numVal,
    formatted,
    sign,
    barPercent,
    status
  });
}


// Wire up automatic Main-Process Serial IPC streaming
function updateScopeMetadataUI() {
  const btnRun = document.getElementById('btnScopeRun');
  if (btnRun) {
    scopeRunning = liveScopeMeta.running;
    btnRun.innerText = scopeRunning ? 'STOP' : 'RUN';
    btnRun.style.color = scopeRunning ? '' : '#ef4444';
  }

  const statCh1Vpp = document.getElementById('statCh1Vpp');
  const statCh1Freq = document.getElementById('statCh1Freq');
  const statCh1Vrms = document.getElementById('statCh1Vrms');
  const lblCh1Scale = document.getElementById('lblCh1Scale');

  if (statCh1Vpp) {
    const vppV = (liveScopeMeta.vpp1 / 1000).toFixed(2);
    statCh1Vpp.innerText = `${vppV} Vpp`;
    if (statCh1Vrms) statCh1Vrms.innerText = `${(vppV * 0.35355).toFixed(2)} Vrms`;
  }
  if (statCh1Freq) {
    if (liveScopeMeta.f1 >= 1000000) {
      statCh1Freq.innerText = `${(liveScopeMeta.f1 / 1000000).toFixed(3)} MHz`;
    } else if (liveScopeMeta.f1 >= 1000) {
      statCh1Freq.innerText = `${(liveScopeMeta.f1 / 1000).toFixed(2)} kHz`;
    } else {
      statCh1Freq.innerText = `${liveScopeMeta.f1} Hz`;
    }
  }
  if (lblCh1Scale && liveScopeMeta.v1) lblCh1Scale.innerText = `${liveScopeMeta.v1}/div`;

  const statCh2Vpp = document.getElementById('statCh2Vpp');
  const statCh2Freq = document.getElementById('statCh2Freq');
  const statCh2Vrms = document.getElementById('statCh2Vrms');
  const lblCh2Scale = document.getElementById('lblCh2Scale');

  if (statCh2Vpp) {
    const vppV2 = (liveScopeMeta.vpp2 / 1000).toFixed(2);
    statCh2Vpp.innerText = `${vppV2} Vpp`;
    if (statCh2Vrms) statCh2Vrms.innerText = `${(vppV2 * 0.35355).toFixed(2)} Vrms`;
  }
  if (statCh2Freq) {
    if (liveScopeMeta.f2 >= 1000000) {
      statCh2Freq.innerText = `${(liveScopeMeta.f2 / 1000000).toFixed(3)} MHz`;
    } else if (liveScopeMeta.f2 >= 1000) {
      statCh2Freq.innerText = `${(liveScopeMeta.f2 / 1000).toFixed(2)} kHz`;
    } else {
      statCh2Freq.innerText = `${liveScopeMeta.f2} Hz`;
    }
  }
  if (lblCh2Scale && liveScopeMeta.v2) lblCh2Scale.innerText = `${liveScopeMeta.v2}/div`;
}

function processLiveSerialLine(line) {
  if (!line || typeof line !== 'string') return;
  line = line.trim();

  // Mode announcement
  if (line.startsWith('$MODE,')) {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const mode = parts[1].trim().toUpperCase();
      if (mode === 'SCOPE') {
        switchTab('scope');
      } else if (mode === 'DMM') {
        switchTab('dmm');
      } else if (mode === 'GEN') {
        switchTab('generator');
      }
    }
    return;
  }

  // DMM telemetry
  if (line.startsWith('$DMM,')) {
    processLiveDmmLine(line);
    const activeTab = document.querySelector('.nav-item.active');
    if (activeTab && activeTab.dataset.tab === 'scope') {
      switchTab('dmm');
    }
    return;
  }

  // Scope Metadata: $SCOPE,<tb>,<v1>,<v2>,<f1>,<vpp1>,<f2>,<vpp2>,<run>,<ch1_en>,<ch2_en>
  if (line.startsWith('$SCOPE,')) {
    const parts = line.split(',');
    if (parts.length >= 11) {
      liveScopeMeta.tb = parts[1].trim();
      liveScopeMeta.v1 = parts[2].trim();
      liveScopeMeta.v2 = parts[3].trim();
      liveScopeMeta.f1 = parseInt(parts[4], 10) || 0;
      liveScopeMeta.vpp1 = parseInt(parts[5], 10) || 0;
      liveScopeMeta.f2 = parseInt(parts[6], 10) || 0;
      liveScopeMeta.vpp2 = parseInt(parts[7], 10) || 0;
      liveScopeMeta.running = parts[8] === '1';
      liveScopeMeta.ch1En = parts[9] === '1';
      liveScopeMeta.ch2En = parts[10] === '1';

      updateScopeMetadataUI();

      const activeTab = document.querySelector('.nav-item.active');
      if (activeTab && activeTab.dataset.tab === 'dmm') {
        switchTab('scope');
      }
    }
    return;
  }

  // Scope Waveform: $WAVE,<ch>,<hex>
  if (line.startsWith('$WAVE,')) {
    const parts = line.split(',');
    if (parts.length >= 3) {
      const ch = parts[1].trim();
      const hex = parts[2].trim();
      const numPoints = hex.length / 2;
      const samples = new Uint8Array(numPoints);
      for (let i = 0; i < numPoints; i++) {
        samples[i] = parseInt(hex.substr(i * 2, 2), 16);
      }

      if (ch === '1') {
        liveScopeWave1 = samples;
      } else if (ch === '2') {
        liveScopeWave2 = samples;
      }
      lastScopeWaveTime = Date.now();

      const activeTab = document.querySelector('.nav-item.active');
      if (activeTab && activeTab.dataset.tab === 'dmm') {
        switchTab('scope');
      }
    }
    return;
  }
}

// Wire up automatic Main-Process Serial IPC streaming
if (window.api && window.api.onDmmLine) {
  window.api.onDmmLine((line) => {
    processLiveSerialLine(line);
  });
}
if (window.api && window.api.onDmmStatus) {
  window.api.onDmmStatus((status) => {
    updateSerialConnectionUI(status.connected, status.port);
  });
}

// Raw Serial Monitor & Telemetry Inspector
const txtDmmSerialLog = document.getElementById('txtDmmSerialLog');
const chkDmmLogAutoScroll = document.getElementById('chkDmmLogAutoScroll');
const btnDmmCopyRawLog = document.getElementById('btnDmmCopyRawLog');
const btnDmmSaveRawLog = document.getElementById('btnDmmSaveRawLog');
const btnDmmClearRawLog = document.getElementById('btnDmmClearRawLog');
const inputDmmSerialCmd = document.getElementById('inputDmmSerialCmd');
const btnDmmSendSerialCmd = document.getElementById('btnDmmSendSerialCmd');

let rawSerialLogLines = [];

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appendRawSerialLog(type, text, time) {
  if (!txtDmmSerialLog) return;
  const t = time || (new Date().toLocaleTimeString() + '.' + String(new Date().getMilliseconds()).padStart(3, '0'));
  
  let color = '#38bdf8';
  let prefix = 'INFO';
  if (type === 'rx') {
    color = '#4ade80';
    prefix = 'RX ←';
  } else if (type === 'tx') {
    color = '#facc15';
    prefix = 'TX →';
  } else if (type === 'error') {
    color = '#f87171';
    prefix = 'ERR ';
  }

  const lineHtml = `<div style="color:${color}"><span style="color:#64748b;">[${t}]</span> <strong style="color:${color}; font-weight:bold;">${prefix}</strong> ${escapeHtml(text)}</div>`;
  const plainText = `[${t}] ${prefix} ${text}`;
  
  rawSerialLogLines.push(plainText);
  if (rawSerialLogLines.length > 2000) rawSerialLogLines.shift();

  txtDmmSerialLog.insertAdjacentHTML('beforeend', lineHtml);
  if (txtDmmSerialLog.children.length > 2000) {
    txtDmmSerialLog.removeChild(txtDmmSerialLog.firstChild);
  }

  if (chkDmmLogAutoScroll && chkDmmLogAutoScroll.checked) {
    txtDmmSerialLog.scrollTop = txtDmmSerialLog.scrollHeight;
  }
}

if (window.api && window.api.onDmmLog) {
  window.api.onDmmLog((logEvent) => {
    appendRawSerialLog(logEvent.type, logEvent.text, logEvent.time);
  });
}

btnDmmSendSerialCmd?.addEventListener('click', async () => {
  const cmd = inputDmmSerialCmd.value.trim();
  if (!cmd) return;
  appendRawSerialLog('tx', cmd);
  if (window.api && window.api.sendDmmCommand) {
    const res = await window.api.sendDmmCommand(cmd);
    if (!res.success) {
      appendRawSerialLog('error', 'Senden fehlgeschlagen: ' + (res.error || 'Unbekannt'));
    }
  }
  inputDmmSerialCmd.value = '';
});

inputDmmSerialCmd?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnDmmSendSerialCmd?.click();
  }
});

btnDmmCopyRawLog?.addEventListener('click', () => {
  const text = rawSerialLogLines.join('\r\n');
  navigator.clipboard.writeText(text);
  showToast('Serial-Log in Zwischenablage kopiert');
});

btnDmmClearRawLog?.addEventListener('click', () => {
  rawSerialLogLines = [];
  if (txtDmmSerialLog) txtDmmSerialLog.innerHTML = '';
  showToast('Serial-Log geleert');
});

btnDmmSaveRawLog?.addEventListener('click', async () => {
  if (rawSerialLogLines.length === 0) {
    showToast('Keine Log-Einträge vorhanden');
    return;
  }
  const filename = `DMM_Serial_Log_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  const content = rawSerialLogLines.join('\r\n');
  const res = await window.api.saveCsv(filename, content);
  if (res && res.success) {
    showToast(`Serial-Log gespeichert: ${res.filePath}`);
  }
});

btnDmmSerialConnect?.addEventListener('click', async () => {
  showToast('Suche & verbinde 2C23T COM-Port...');
  if (window.api && window.api.reconnectSerial) {
    await window.api.reconnectSerial();
  }
});


// ==========================================
// 1. OSZILLOSKOP SIMULATOR & LABOR
// ==========================================
const scopeCanvas = document.getElementById('scopeCanvas');
const scopeCtx = scopeCanvas.getContext('2d');
let timebaseVal = 1.0;
let ch1Scale = 1.0;
let ch2Scale = 1.0;
let genFreq = 1000;
let genWave = 'sine';
let scopePhase = 0;

document.getElementById('btnScopeRun').addEventListener('click', (e) => {
  scopeRunning = !scopeRunning;
  e.target.innerText = scopeRunning ? 'STOP' : 'RUN';
  e.target.style.color = scopeRunning ? '' : '#ef4444';
  if (window.api && window.api.sendDmmCommand) {
    window.api.sendDmmCommand(scopeRunning ? 'SCOPE:RUN\n' : 'SCOPE:STOP\n');
  }
});

const btnScopeAuto = document.getElementById('btnScopeAuto');
if (btnScopeAuto) {
  btnScopeAuto.addEventListener('click', () => {
    if (window.api && window.api.sendDmmCommand) {
      window.api.sendDmmCommand('SCOPE:AUTO\n');
    }
  });
}

document.querySelectorAll('[data-timebase]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-timebase]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    timebaseVal = parseFloat(btn.dataset.timebase);
  });
});

document.getElementById('rngCh1Scale').addEventListener('input', (e) => {
  ch1Scale = parseFloat(e.target.value);
  document.getElementById('lblCh1Scale').innerText = `${ch1Scale.toFixed(1)} V/div`;
});

document.getElementById('rngCh2Scale').addEventListener('input', (e) => {
  ch2Scale = parseFloat(e.target.value);
  document.getElementById('lblCh2Scale').innerText = `${ch2Scale.toFixed(1)} V/div`;
});

document.querySelectorAll('.sig-presets button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sig-presets button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    genWave = btn.dataset.wave;
  });
});

document.getElementById('rngGenFreq').addEventListener('input', (e) => {
  genFreq = parseInt(e.target.value);
  document.getElementById('lblGenFreq').innerText = genFreq >= 1000 ? `${(genFreq/1000).toFixed(1)} kHz` : `${genFreq} Hz`;
});

function renderScope() {
  const width = scopeCanvas.width;
  const height = scopeCanvas.height;
  const centerY = height / 2;

  const persist = document.getElementById('chkPersist').checked;
  if (persist) {
    scopeCtx.fillStyle = 'rgba(3, 6, 16, 0.22)';
    scopeCtx.fillRect(0, 0, width, height);
  } else {
    scopeCtx.fillStyle = '#030610';
    scopeCtx.fillRect(0, 0, width, height);
  }

  // Draw Grid
  scopeCtx.strokeStyle = 'rgba(0, 242, 254, 0.12)';
  scopeCtx.lineWidth = 1;
  const divX = width / 10;
  const divY = height / 8;

  for (let x = 0; x <= width; x += divX) {
    scopeCtx.beginPath();
    scopeCtx.moveTo(x, 0);
    scopeCtx.lineTo(x, height);
    scopeCtx.stroke();
  }
  for (let y = 0; y <= height; y += divY) {
    scopeCtx.beginPath();
    scopeCtx.moveTo(0, y);
    scopeCtx.lineTo(width, y);
    scopeCtx.stroke();
  }

  // Center axes with tick marks
  scopeCtx.strokeStyle = 'rgba(0, 242, 254, 0.25)';
  scopeCtx.beginPath();
  scopeCtx.moveTo(0, centerY);
  scopeCtx.lineTo(width, centerY);
  scopeCtx.moveTo(width / 2, 0);
  scopeCtx.lineTo(width / 2, height);
  scopeCtx.stroke();

    const hasHardwareWave = (Date.now() - lastScopeWaveTime < 2500) && (liveScopeWave1 || liveScopeWave2);

  // Live status badge on canvas (unten links, damit keine Kollision mit den Messwert-Badges oben entsteht)
  scopeCtx.font = '11px Cascadia Code, monospace';
  if (hasHardwareWave) {
    scopeCtx.fillStyle = '#10b981';
    scopeCtx.fillText(`● HARDWARE LIVE TELEMETRIE [${liveScopeMeta.tb} | CH1:${liveScopeMeta.v1} | CH2:${liveScopeMeta.v2}]`, 14, height - 12);
  } else {
    scopeCtx.fillStyle = '#64748b';
    scopeCtx.fillText('○ SIMULATOR MODUS (Warte auf USB Telemetrie...)', 14, height - 12);
  }

  const showCh1 = document.getElementById('chkCh1').checked;
  const showCh2 = document.getElementById('chkCh2').checked;
  const showFft = document.getElementById('chkFft').checked;

  const dualChannel = showCh1 && showCh2;
  const ch1CenterY = dualChannel ? centerY - divY * 1.5 : centerY;
  const ch2CenterY = dualChannel ? centerY + divY * 1.5 : centerY;

  // Ground Reference Markers (wie auf der echten Hardware)
  if (showCh1) {
    scopeCtx.fillStyle = '#facc15';
    scopeCtx.beginPath();
    scopeCtx.moveTo(0, ch1CenterY - 6);
    scopeCtx.lineTo(9, ch1CenterY);
    scopeCtx.lineTo(0, ch1CenterY + 6);
    scopeCtx.fill();
  }
  if (showCh2) {
    scopeCtx.fillStyle = '#00f2fe';
    scopeCtx.beginPath();
    scopeCtx.moveTo(0, ch2CenterY - 6);
    scopeCtx.lineTo(9, ch2CenterY);
    scopeCtx.lineTo(0, ch2CenterY + 6);
    scopeCtx.fill();
  }

  if (hasHardwareWave) {
    // REAL HARDWARE CH1 WAVE (Gelb, Hardware-Kanal 1 oben)
    if (showCh1 && liveScopeWave1 && liveScopeWave1.length > 1) {
      scopeCtx.strokeStyle = '#facc15';
      scopeCtx.lineWidth = 2.5;
      scopeCtx.shadowColor = '#facc15';
      scopeCtx.shadowBlur = 8;
      scopeCtx.beginPath();
      const n = liveScopeWave1.length;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const raw = liveScopeWave1[i];
        const delta = raw - 128;
        const y = ch1CenterY - (delta / 32) * divY;
        if (i === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();
      scopeCtx.shadowBlur = 0;
    }

    // REAL HARDWARE CH2 WAVE (Cyan/Blau, Hardware-Kanal 2 unten)
    if (showCh2 && liveScopeWave2 && liveScopeWave2.length > 1) {
      scopeCtx.strokeStyle = '#00f2fe';
      scopeCtx.lineWidth = 2.2;
      scopeCtx.shadowColor = '#00f2fe';
      scopeCtx.shadowBlur = 8;
      scopeCtx.beginPath();
      const n = liveScopeWave2.length;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const raw = liveScopeWave2[i];
        const delta = raw - 128;
        const y = ch2CenterY - (delta / 32) * divY;
        if (i === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();
      scopeCtx.shadowBlur = 0;
    }
  } else {
    if (scopeRunning) {
      scopePhase += 0.05 * (genFreq / 1000) * timebaseVal;
    }

    // CH1 Wave (Gelb, oben)
    if (showCh1) {
      scopeCtx.strokeStyle = '#facc15';
      scopeCtx.lineWidth = 2.5;
      scopeCtx.shadowColor = '#facc15';
      scopeCtx.shadowBlur = 8;
      scopeCtx.beginPath();

      for (let x = 0; x < width; x++) {
        const t = (x / width) * Math.PI * 4 * timebaseVal + scopePhase;
        let val = Math.sin(t);
        if (genWave === 'square') val = Math.sin(t) >= 0 ? 1 : -1;
        else if (genWave === 'tri') val = (2 / Math.PI) * Math.asin(Math.sin(t));
        else if (genWave === 'ecg') {
          const mod = (t % (Math.PI * 2));
          val = mod > 1.0 && mod < 1.4 ? Math.sin((mod - 1.0) * Math.PI * 5) * 1.8 : Math.sin(t * 0.5) * 0.2;
        }

        const y = ch1CenterY - (val * divY * 1.5) / ch1Scale;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();
      scopeCtx.shadowBlur = 0;
    }

    // CH2 Wave (Cyan/Blau, unten)
    if (showCh2) {
      scopeCtx.strokeStyle = '#00f2fe';
      scopeCtx.lineWidth = 2.2;
      scopeCtx.shadowColor = '#00f2fe';
      scopeCtx.shadowBlur = 8;
      scopeCtx.beginPath();

      for (let x = 0; x < width; x++) {
        const t = (x / width) * Math.PI * 6 * timebaseVal + (scopePhase * 1.3);
        const val = Math.cos(t);
        const y = ch2CenterY - (val * divY * 1.2) / ch2Scale;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();
      scopeCtx.shadowBlur = 0;
    }

    // Update Simulated Stats
    const vpp1 = (3.3 * (1 / ch1Scale)).toFixed(2);
    const vrms1 = (vpp1 * 0.35355).toFixed(2);
    document.getElementById('statCh1Vpp').innerText = `${vpp1} Vpp`;
    document.getElementById('statCh1Vrms').innerText = `${vrms1} Vrms`;
    document.getElementById('statCh1Freq').innerText = `${genFreq} Hz`;
  }

  requestAnimationFrame(renderScope);
}
requestAnimationFrame(renderScope);

// ==========================================
// 2. SCREENSHOT-GALERIE
// ==========================================
async function loadScreenshots() {
  const galleryList = document.getElementById('galleryList');
  const emptyState = document.getElementById('galleryEmpty');
  const badge = document.getElementById('badgeGalleryCount');

  try {
    const list = await window.api.getScreenshots();
    badge.innerText = list.length;

    if (list.length === 0) {
      galleryList.innerHTML = '';
      galleryList.appendChild(emptyState);
      return;
    }

    galleryList.innerHTML = '';
    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const dateStr = new Date(item.mtime).toLocaleString('de-DE');
      card.innerHTML = `
        <img class="gallery-thumb" src="${item.previewBase64}" alt="${item.filename}">
        <div class="gallery-card-meta">
          <span class="filename">${item.filename}</span>
          <span class="date">${dateStr}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        document.querySelectorAll('.gallery-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        showScreenshotPreview(item);
      });
      galleryList.appendChild(card);
    });

    if (list.length > 0) {
      showScreenshotPreview(list[0]);
    }
  } catch (e) {
    console.error('Error loading screenshots:', e);
  }
}

function showScreenshotPreview(item) {
  const pane = document.getElementById('galleryPreviewPane');
  pane.style.display = 'flex';
  document.getElementById('previewTitle').innerText = item.filename;
  document.getElementById('previewImage').src = item.previewBase64;

  document.getElementById('btnOpenInApp').onclick = () => {
    window.api.openFile(item.fullPath);
  };
}

document.getElementById('btnSyncScreenshots').addEventListener('click', () => {
  loadScreenshots();
  showToast('Screenshots synchronisiert!');
});

document.getElementById('btnOpenScreenshotFolder').addEventListener('click', () => {
  if (currentDeviceStatus && currentDeviceStatus.driveLetter) {
    window.api.openInExplorer(currentDeviceStatus.driveLetter);
  }
});

// ==========================================
// 3. ARBITRARY WAVEFORM STUDIO
// ==========================================
const desCanvas = document.getElementById('designerCanvas');
const desCtx = desCanvas.getContext('2d');

function initWavePreset(preset) {
  activeWavePreset = preset;
  customPoints = [];
  const n = wavePoints;

  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    let y = 0.5;

    if (preset === 'sine') {
      y = 0.5 - Math.sin(t) * 0.45;
    } else if (preset === 'halfsine') {
      y = 0.9 - Math.abs(Math.sin(t)) * 0.8;
    } else if (preset === 'square') {
      y = i < n / 2 ? 0.1 : 0.9;
    } else if (preset === 'sawtooth') {
      y = 0.9 - (i / n) * 0.8;
    } else if (preset === 'triangle') {
      y = i < n / 2 ? 0.9 - (i / (n / 2)) * 0.8 : 0.1 + ((i - n / 2) / (n / 2)) * 0.8;
    } else if (preset === 'ecg') {
      const ph = i / n;
      if (ph > 0.4 && ph < 0.45) y = 0.6;
      else if (ph >= 0.45 && ph < 0.52) y = 0.05;
      else if (ph >= 0.52 && ph < 0.58) y = 0.95;
      else if (ph >= 0.65 && ph < 0.8) y = 0.35;
      else y = 0.5;
    } else if (preset === 'exp') {
      y = 0.9 - Math.exp((i / n) * 3) / Math.exp(3) * 0.8;
    } else if (preset === 'noise') {
      y = 0.2 + Math.random() * 0.6;
    }
    customPoints.push(Math.round((1.0 - y) * maxMv));
  }
  drawDesigner();
}

function drawDesigner() {
  const w = desCanvas.width;
  const h = desCanvas.height;
  desCtx.fillStyle = '#060a16';
  desCtx.fillRect(0, 0, w, h);

  // Grid
  desCtx.strokeStyle = 'rgba(0, 242, 254, 0.1)';
  for (let x = 0; x < w; x += w / 8) {
    desCtx.beginPath();
    desCtx.moveTo(x, 0);
    desCtx.lineTo(x, h);
    desCtx.stroke();
  }
  for (let y = 0; y < h; y += h / 6) {
    desCtx.beginPath();
    desCtx.moveTo(0, y);
    desCtx.lineTo(w, y);
    desCtx.stroke();
  }

  // Draw Wave
  if (customPoints.length > 0) {
    desCtx.strokeStyle = '#00f2fe';
    desCtx.lineWidth = 3;
    desCtx.shadowColor = '#00f2fe';
    desCtx.shadowBlur = 10;
    desCtx.beginPath();

    const stepX = w / (customPoints.length - 1);
    for (let i = 0; i < customPoints.length; i++) {
      const valNorm = customPoints[i] / maxMv;
      const x = i * stepX;
      const y = h - (valNorm * (h - 40) + 20);

      if (i === 0) desCtx.moveTo(x, y);
      else desCtx.lineTo(x, y);
    }
    desCtx.stroke();
    desCtx.shadowBlur = 0;

    // Draw dots
    desCtx.fillStyle = '#38bdf8';
    for (let i = 0; i < customPoints.length; i++) {
      const valNorm = customPoints[i] / maxMv;
      const x = i * stepX;
      const y = h - (valNorm * (h - 40) + 20);
      desCtx.beginPath();
      desCtx.arc(x, y, 3, 0, Math.PI * 2);
      desCtx.fill();
    }
  }
}

// Preset clicks
document.querySelectorAll('.btn-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    initWavePreset(btn.dataset.preset);
  });
});

document.getElementById('rngWavePoints').addEventListener('input', (e) => {
  wavePoints = parseInt(e.target.value);
  document.getElementById('lblWavePoints').innerText = `${wavePoints} Punkte`;
  document.getElementById('lblPointsCount').innerText = `${wavePoints} Punkte`;
  initWavePreset(activeWavePreset);
});

document.getElementById('rngWaveMv').addEventListener('input', (e) => {
  maxMv = parseInt(e.target.value);
  document.getElementById('lblWaveMv').innerText = `${maxMv} mV`;
  document.getElementById('lblMaxAmplitude').innerText = `${maxMv} mV`;
  initWavePreset(activeWavePreset);
});

// Interactive drawing
desCanvas.addEventListener('mousedown', (e) => {
  isDrawingWave = true;
  handleCanvasDraw(e);
});
window.addEventListener('mouseup', () => isDrawingWave = false);
desCanvas.addEventListener('mousemove', (e) => {
  if (isDrawingWave) handleCanvasDraw(e);
});

function handleCanvasDraw(e) {
  const rect = desCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const idx = Math.min(customPoints.length - 1, Math.max(0, Math.round((mouseX / rect.width) * (customPoints.length - 1))));
  const normY = 1.0 - Math.min(1.0, Math.max(0, mouseY / rect.height));
  customPoints[idx] = Math.round(normY * maxMv);
  drawDesigner();
}

initWavePreset('sine');

// Export CSV Waveform to 2C23T
document.getElementById('btnExportWaveform').addEventListener('click', async () => {
  const name = document.getElementById('txtWaveName').value.trim() || 'WAVE1';
  try {
    const res = await window.api.saveWaveformCsv(name, customPoints);
    showToast(`Wellenform ${res.name} erfolgreich auf 2C23T gespeichert!`);
  } catch (err) {
    alert(err.message || 'Fehler beim Speichern');
  }
});
