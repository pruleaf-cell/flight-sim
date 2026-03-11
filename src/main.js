const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');

const ui = {
  hud: document.getElementById('hud'),
  ias: document.getElementById('ias'), alt: document.getElementById('alt'), vs: document.getElementById('vs'), hdg: document.getElementById('hdg'),
  thr: document.getElementById('thr'), flp: document.getElementById('flp'), trm: document.getElementById('trm'), wnd: document.getElementById('wnd'),
  warnings: document.getElementById('warnings'), status: document.getElementById('status-strip'),
  start: document.getElementById('start-screen'), pause: document.getElementById('pause-menu'), settings: document.getElementById('settings-panel'),
  controls: document.getElementById('controls-panel'), centerMessage: document.getElementById('center-message'),
  best: document.getElementById('best-score')
};

const SETTINGS_KEY = 'runway-circuit-settings-v1';
const BEST_KEY = 'runway-circuit-best-v1';

const defaultSettings = { windStrength: 8, trainingHints: true, audioEnabled: true, flightPathCue: true };
let settings = loadLocal(SETTINGS_KEY, defaultSettings);
let bestScore = Number(localStorage.getItem(BEST_KEY) || 0);
ui.best.textContent = `Best landing score: ${bestScore || '--'}`;

document.getElementById('wind-strength').value = settings.windStrength;
document.getElementById('hint-toggle').checked = settings.trainingHints;
document.getElementById('audio-toggle').checked = settings.audioEnabled;
document.getElementById('fpa-toggle').checked = settings.flightPathCue;

class Simulator {
  constructor(mode = 'free') {
    this.mode = mode;
    this.cameraMode = 'cockpit';
    this.t = 0;
    this.phase = 'taxi';
    this.messageTimer = 0;
    this.lastTouchdownRate = 0;
    this.score = null;
    this.wind = { dir: radians(220), speed: settings.windStrength };
    this.keys = new Set();
    this.paused = false;
    this.ended = false;
    this.state = this.initialState();
    this.prevOnGround = true;
    this.audio = new AudioController(settings.audioEnabled);
  }

  initialState() {
    return {
      x: 0, z: -420, y: 1.1,
      roll: 0, pitch: 0, heading: radians(0),
      rollRate: 0, pitchRate: 0, yawRate: 0,
      airspeed: 0, vs: 0,
      throttleCmd: 0.38,
      enginePower: 0.35,
      flap: 0,
      trim: 0,
      rudder: 0,
      brake: 0,
      onGround: true,
      crashed: false,
      rpm: 950,
    };
  }

  reset(mode = this.mode) {
    this.mode = mode;
    this.phase = 'taxi';
    this.ended = false;
    this.score = null;
    this.state = this.initialState();
    this.message('Taxi to centerline, apply power, and rotate near 55 kt.');
  }

  setPaused(v) {
    this.paused = v;
    this.audio.setMute(v || !settings.audioEnabled);
  }

  update(dt) {
    if (this.paused || this.ended) return;
    this.t += dt;
    const s = this.state;
    this.readControls(dt);

    const mass = 1040;
    const wingArea = 16.2;
    const rho = 1.225 * Math.exp(-s.y / 9000);
    const g = 9.81;
    const flapLift = [0, 0.22, 0.38, 0.5][s.flap];
    const flapDrag = [0.024, 0.038, 0.052, 0.078][s.flap];

    const windX = Math.sin(this.wind.dir) * this.wind.speed;
    const windZ = Math.cos(this.wind.dir) * this.wind.speed;

    const gamma = Math.atan2(s.vs, Math.max(0.1, s.airspeed));
    const aoa = clamp((s.pitch + s.trim * 0.08) - gamma, radians(-12), radians(20));
    const stall = Math.abs(aoa) > radians(15);
    let cl = aoa * 5.2 + flapLift;
    if (stall) cl *= 0.65;

    const q = 0.5 * rho * s.airspeed * s.airspeed;
    const groundEffect = s.onGround ? 1.2 : 1 + clamp(4 / Math.max(2, s.y), 0, 0.3);
    const lift = q * wingArea * cl * groundEffect;
    const cd = 0.026 + flapDrag + Math.pow(cl, 2) / (Math.PI * 8.5 * 0.76);
    const drag = q * wingArea * cd;

    s.enginePower += (s.throttleCmd - s.enginePower) * clamp(dt * 1.8, 0, 1);
    const maxThrust = 3300;
    const thrust = maxThrust * s.enginePower * clamp(1 - s.y / 17000, 0.62, 1);

    const accel = (thrust - drag) / mass - g * Math.sin(gamma);
    s.airspeed = clamp(s.airspeed + accel * dt, 0, 95);

    const liftVertical = (lift * Math.cos(s.roll)) / mass;
    const thrustVertical = thrust * Math.sin(s.pitch) / mass;
    const verticalAccel = liftVertical + thrustVertical - g;

    if (s.onGround) {
      const rotateTendency = clamp((s.airspeed - 26) / 35, 0, 1);
      if (rotateTendency > 0.2) s.vs += verticalAccel * dt * rotateTendency;
      const taxiFriction = 0.02 + s.brake * 0.22;
      s.airspeed = Math.max(0, s.airspeed - taxiFriction * g * dt);
      s.pitch += (-s.pitch) * dt * 2.8;
      s.roll += (-s.roll) * dt * 3.2;
      const steer = (s.rudder * 0.65 + s.roll * 0.3) * (0.4 + s.airspeed / 45);
      s.heading += steer * dt;
    } else {
      s.vs += verticalAccel * dt;
      const turnRate = (g * Math.tan(s.roll)) / Math.max(12, s.airspeed) + s.rudder * 0.12;
      s.heading += turnRate * dt;
    }

    s.rollRate += (this.inputRoll * 1.7 - s.rollRate * 1.9) * dt;
    s.pitchRate += ((this.inputPitch + s.trim * 0.34) * 1.35 - s.pitchRate * 1.8) * dt;
    s.yawRate += (s.rudder * 1.05 - s.yawRate * 1.5) * dt;

    s.roll = clamp(s.roll + s.rollRate * dt, radians(-62), radians(62));
    s.pitch = clamp(s.pitch + s.pitchRate * dt, radians(-22), radians(24));
    if (!s.onGround) s.heading += s.yawRate * dt * 0.22;

    const horiz = Math.sqrt(Math.max(0, s.airspeed * s.airspeed - s.vs * s.vs));
    const vx = Math.sin(s.heading) * horiz + windX;
    const vz = Math.cos(s.heading) * horiz + windZ;

    s.x += vx * dt;
    s.z += vz * dt;
    s.y = Math.max(0.2, s.y + s.vs * dt);

    const terrain = terrainHeight(s.x, s.z);
    const wheelHeight = 1.08;
    if (s.y <= terrain + wheelHeight) {
      if (!this.prevOnGround) this.handleTouchdown(Math.abs(s.vs), horiz);
      s.y = terrain + wheelHeight;
      s.vs = 0;
      s.onGround = true;
      if (Math.abs(s.roll) > radians(35) || Math.abs(s.pitch) > radians(21)) this.crash('Structural impact');
    } else {
      s.onGround = false;
    }
    this.prevOnGround = s.onGround;

    s.rpm = 700 + s.enginePower * 2100;
    this.audio.update(s, stall, s.onGround);

    this.updatePhase(stall);
  }

  handleTouchdown(rate, groundSpeed) {
    this.lastTouchdownRate = rate;
    const runway = runwayMetrics(this.state.x, this.state.z, this.state.heading);
    if (!runway.onRunway) {
      this.crash('Runway excursion');
      return;
    }

    if (rate > 5.2 || groundSpeed > 48) {
      this.crash('Hard landing');
      return;
    }

    if (this.phase === 'approach' || this.phase === 'airborne') {
      const sinkScore = Math.max(0, 45 - rate * 8);
      const alignScore = Math.max(0, 30 - runway.headingError * 260);
      const centerScore = Math.max(0, 25 - Math.abs(runway.centerOffset) * 3.5);
      const total = Math.round(sinkScore + alignScore + centerScore);
      this.score = total;
      if (total > bestScore) {
        bestScore = total;
        localStorage.setItem(BEST_KEY, String(total));
        ui.best.textContent = `Best landing score: ${total}`;
      }
      this.phase = 'rollout';
      this.message(`Touchdown ${Math.round(rate * 196.85)} fpm | Landing score ${total}`);
    }
  }

  updatePhase(stall) {
    const s = this.state;
    const runway = runwayMetrics(s.x, s.z, s.heading);
    if (stall && !s.onGround && s.airspeed < 29) {
      this.message('STALL WARNING - lower nose and add power');
      if (Math.abs(s.roll) > radians(50) && s.y < 25) this.crash('Stall spin near ground');
    }

    if (this.phase === 'taxi' && s.airspeed > 18) this.phase = 'takeoff';
    if (this.phase === 'takeoff' && !s.onGround && s.y > 4) {
      this.phase = 'airborne';
      this.message('Positive rate, climb out and fly the circuit.');
    }
    if (this.phase === 'airborne' && s.y > 80 && s.z > -80) {
      this.phase = 'approach';
      this.message('Return for runway 36. Aim 65 kt on final, flaps 20-30°');
    }
    if (this.phase === 'rollout' && s.onGround && s.airspeed < 7) {
      this.phase = 'complete';
      this.ended = true;
      this.message(`Run complete. Landing score ${this.score ?? '--'}. Press R to retry.`);
    }

    if (!runway.onRunway && s.onGround && s.airspeed > 24 && this.phase !== 'taxi') {
      this.crash('Left paved surface during high-speed roll');
    }

    if (s.y > 900) this.message('Ceiling reached. Start descent and set up approach.');
    if (s.y < 0.5 && !s.onGround) this.crash('Terrain collision');
  }

  crash(reason) {
    if (this.ended) return;
    this.ended = true;
    this.state.crashed = true;
    this.phase = 'crashed';
    this.message(`Crash: ${reason}. Press R to restart.`);
    this.audio.touchdown(true);
  }

  message(text) {
    ui.centerMessage.textContent = text;
    ui.centerMessage.classList.remove('hidden');
    this.messageTimer = 4.5;
  }

  readControls(dt) {
    const s = this.state;
    this.inputPitch = (this.keys.has('KeyS') ? 1 : 0) + (this.keys.has('KeyW') ? -1 : 0);
    this.inputRoll = (this.keys.has('KeyD') ? 1 : 0) + (this.keys.has('KeyA') ? -1 : 0);
    s.rudder = (this.keys.has('KeyE') ? 1 : 0) + (this.keys.has('KeyQ') ? -1 : 0);
    s.brake = this.keys.has('Space') ? 1 : 0;

    if (this.keys.has('ArrowUp')) s.throttleCmd = clamp(s.throttleCmd + dt * 0.45, 0, 1);
    if (this.keys.has('ArrowDown')) s.throttleCmd = clamp(s.throttleCmd - dt * 0.45, 0, 1);
  }
}

class Renderer {
  constructor(sim) { this.sim = sim; }

  draw() {
    const s = this.sim.state;
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cam = this.getCamera();
    this.drawSky(cam);
    this.drawTerrain(cam);
    this.drawRunway(cam);
    this.drawLandmarks(cam);
    this.drawAircraftShadow(cam);
    this.drawHudSymbology(cam);

    if (this.sim.messageTimer > 0) {
      this.sim.messageTimer -= 1 / 60;
    } else {
      ui.centerMessage.classList.add('hidden');
    }

    updateInstruments(this.sim);
  }

  getCamera() {
    const s = this.sim.state;
    if (this.sim.cameraMode === 'chase') {
      return {
        x: s.x - Math.sin(s.heading) * 16,
        y: s.y + 4.8,
        z: s.z - Math.cos(s.heading) * 16,
        yaw: s.heading,
        pitch: radians(-10),
        roll: 0,
        fov: 62
      };
    }
    return {
      x: s.x + Math.sin(s.heading) * 1.3,
      y: s.y + 1.0,
      z: s.z + Math.cos(s.heading) * 1.3,
      yaw: s.heading,
      pitch: s.pitch * 0.75,
      roll: s.roll * 0.45,
      fov: 78
    };
  }

  drawSky(cam) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#88b9ff');
    g.addColorStop(0.45, '#a6caeb');
    g.addColorStop(0.52, '#6a7b67');
    g.addColorStop(1, '#2f3a2f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const horizonY = canvas.height * (0.5 + cam.pitch * 1.2);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(canvas.width, horizonY);
    ctx.stroke();
  }

  drawTerrain(cam) {
    for (let i = -6; i <= 12; i++) {
      const z = i * 120;
      this.drawSegment(cam, { x: -850, y: 0, z }, { x: 850, y: 0, z }, 'rgba(90,120,90,0.22)', 1);
    }
    for (let i = -10; i <= 10; i++) {
      const x = i * 120;
      this.drawSegment(cam, { x, y: 0, z: -900 }, { x, y: 0, z: 900 }, 'rgba(90,120,90,0.2)', 1);
    }
  }

  drawRunway(cam) {
    drawQuad(cam, [-22,0,-650], [22,0,-650], [22,0,650], [-22,0,650], '#2f2f35');
    drawQuad(cam, [-28,0,-650], [-22,0,-650], [-22,0,650], [-28,0,650], '#3a3b42');
    drawQuad(cam, [22,0,-650], [28,0,-650], [28,0,650], [22,0,650], '#3a3b42');
    drawQuad(cam, [-6,0,-690], [6,0,-690], [6,0,-650], [-6,0,-650], '#fafafa');
    drawQuad(cam, [-6,0,650], [6,0,650], [6,0,690], [-6,0,690], '#fafafa');

    for (let z = -560; z <= 560; z += 80) drawQuad(cam, [-1.2,0,z-20], [1.2,0,z-20], [1.2,0,z+20], [-1.2,0,z+20], '#f8f8f8');
    drawQuad(cam, [-140,0,-520], [-28,0,-520], [-28,0,-460], [-140,0,-460], '#40454e');
    drawQuad(cam, [-220,0,-560], [-140,0,-560], [-140,0,-430], [-220,0,-430], '#515864');
  }

  drawLandmarks(cam) {
    this.drawTower(cam, 160, 0, -220, 26, '#757c8b');
    this.drawTower(cam, -300, 0, 260, 50, '#53606e');
    this.drawTower(cam, 260, 0, 380, 40, '#49586a');
  }

  drawTower(cam, x, y, z, h, color) {
    drawQuad(cam, [x-10,y,z-10],[x+10,y,z-10],[x+10,y+h,z-10],[x-10,y+h,z-10], color);
    drawQuad(cam, [x-10,y,z+10],[x+10,y,z+10],[x+10,y+h,z+10],[x-10,y+h,z+10], color);
    drawQuad(cam, [x-10,y,z-10],[x-10,y,z+10],[x-10,y+h,z+10],[x-10,y+h,z-10], color);
    drawQuad(cam, [x+10,y,z-10],[x+10,y,z+10],[x+10,y+h,z+10],[x+10,y+h,z-10], color);
  }

  drawAircraftShadow(cam) {
    const s = this.sim.state;
    drawQuad(cam, [s.x-1.4,0,s.z-3], [s.x+1.4,0,s.z-3], [s.x+1.4,0,s.z+3], [s.x-1.4,0,s.z+3], 'rgba(0,0,0,0.35)');
  }

  drawHudSymbology() {
    const s = this.sim.state;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.strokeStyle = 'rgba(90,255,180,0.7)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.moveTo(cx - 35, cy); ctx.lineTo(cx - 14, cy);
    ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + 35, cy);
    ctx.stroke();

    if (settings.flightPathCue) {
      const fpY = cy - (s.vs / Math.max(20, s.airspeed)) * 180;
      ctx.strokeStyle = 'rgba(255,220,120,0.8)';
      ctx.strokeRect(cx - 6, fpY - 6, 12, 12);
    }

    if (this.sim.mode === 'training' && settings.trainingHints) {
      const rwy = runwayMetrics(s.x, s.z, s.heading);
      const cue = `Centerline ${(rwy.centerOffset).toFixed(1)} m | Hdg err ${(rwy.headingError * 57.3).toFixed(1)}°`;
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(12, canvas.height - 42, 340, 28);
      ctx.fillStyle = '#d7eeff';
      ctx.fillText(cue, 22, canvas.height - 23);
    }
  }

  drawSegment(cam, a, b, color, width) {
    const pa = project(a, cam);
    const pb = project(b, cam);
    if (!pa || !pb) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
}

class AudioController {
  constructor(enabled) {
    this.enabled = enabled;
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
  }

  ensure() {
    if (!this.enabled || this.ctx) return;
    this.ctx = new AudioContext();
    this.engineOsc = this.ctx.createOscillator();
    this.engineGain = this.ctx.createGain();
    const wobble = this.ctx.createOscillator();
    const wobbleGain = this.ctx.createGain();
    wobble.frequency.value = 14;
    wobbleGain.gain.value = 8;
    wobble.connect(wobbleGain);
    wobbleGain.connect(this.engineOsc.frequency);

    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 90;
    this.engineGain.gain.value = 0.0001;
    this.engineOsc.connect(this.engineGain).connect(this.ctx.destination);
    this.engineOsc.start();
    wobble.start();
  }

  setMute(m) { this.enabled = !m; if (!this.enabled && this.engineGain) this.engineGain.gain.value = 0.0001; }

  update(state, stall, onGround) {
    if (!settings.audioEnabled) return;
    this.ensure();
    if (!this.ctx) return;
    this.engineOsc.frequency.value = 65 + state.rpm * 0.06;
    this.engineGain.gain.value = 0.015 + state.enginePower * 0.04 + (stall ? 0.01 : 0);
    if (onGround && state.brake > 0.4 && state.airspeed > 12) this.engineGain.gain.value += 0.015;
  }

  touchdown(hard = false) {
    if (!this.ctx) return;
    const noise = this.ctx.createBufferSource();
    const len = this.ctx.sampleRate * 0.1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    noise.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = hard ? 0.3 : 0.12;
    noise.connect(g).connect(this.ctx.destination);
    noise.start();
  }
}

const sim = new Simulator('free');
const renderer = new Renderer(sim);
sim.message('Use Arrow keys for throttle, W/S pitch, A/D roll.');

window.addEventListener('keydown', e => {
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyR') sim.reset();
  if (e.code === 'KeyC') sim.cameraMode = sim.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
  if (e.code === 'KeyH') settings.trainingHints = !settings.trainingHints;
  if (e.code === 'KeyF') sim.state.flap = clamp(sim.state.flap + 1, 0, 3);
  if (e.code === 'KeyV') sim.state.flap = clamp(sim.state.flap - 1, 0, 3);
  if (e.code === 'BracketRight') sim.state.trim = clamp(sim.state.trim + 0.06, -0.5, 0.5);
  if (e.code === 'BracketLeft') sim.state.trim = clamp(sim.state.trim - 0.06, -0.5, 0.5);
  sim.keys.add(e.code);
});
window.addEventListener('keyup', e => sim.keys.delete(e.code));

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;
  sim.update(dt);
  renderer.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function togglePause() {
  const next = !sim.paused;
  sim.setPaused(next);
  ui.pause.classList.toggle('hidden', !next);
}

document.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
  sim.reset(btn.dataset.mode);
  sim.mode = btn.dataset.mode;
  ui.start.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  sim.audio.ensure();
}));

for (const [btn, panel] of [['open-settings','settings'], ['pause-settings','settings'], ['open-controls','controls'], ['pause-controls','controls']]) {
  document.getElementById(btn).addEventListener('click', () => ui[panel].classList.remove('hidden'));
}
document.getElementById('close-settings').onclick = () => ui.settings.classList.add('hidden');
document.getElementById('close-controls').onclick = () => ui.controls.classList.add('hidden');
document.getElementById('save-settings').onclick = () => {
  settings.windStrength = Number(document.getElementById('wind-strength').value);
  settings.trainingHints = document.getElementById('hint-toggle').checked;
  settings.audioEnabled = document.getElementById('audio-toggle').checked;
  settings.flightPathCue = document.getElementById('fpa-toggle').checked;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  sim.wind.speed = settings.windStrength;
  ui.settings.classList.add('hidden');
};

document.getElementById('resume-btn').onclick = () => togglePause();
document.getElementById('restart-btn').onclick = () => { sim.reset(); togglePause(); };
document.getElementById('quit-btn').onclick = () => {
  sim.setPaused(false);
  ui.pause.classList.add('hidden');
  ui.hud.classList.add('hidden');
  ui.start.classList.remove('hidden');
};

function updateInstruments(sim) {
  const s = sim.state;
  ui.ias.textContent = `${Math.round(s.airspeed * 1.9438)} kt`;
  ui.alt.textContent = `${Math.round((s.y - 1.08) * 3.281)} ft`;
  ui.vs.textContent = `${Math.round(s.vs * 196.85)} fpm`;
  ui.hdg.textContent = `${String((Math.round(degrees(normAngle(s.heading))) + 360) % 360).padStart(3, '0')}°`;
  ui.thr.textContent = `${Math.round(s.throttleCmd * 100)}%`;
  ui.flp.textContent = `${s.flap * 10}°`;
  ui.trm.textContent = `${Math.round(s.trim * 100)}%`;
  ui.wnd.textContent = `${Math.round(degrees(sim.wind.dir)).toString().padStart(3, '0')}/${Math.round(sim.wind.speed)} kt`;
  ui.eng.textContent = s.engineOn ? `${Math.round(s.rpm)} RPM` : 'OFF';

  const rwy = runwayMetrics(s.x, s.z, s.heading);
  ui.status.textContent = `${sim.mode.toUpperCase()} | ${sim.phase.toUpperCase()} | Camera ${sim.cameraMode} | PB ${s.parkingBrake ? 'ON' : 'OFF'} | Runway align ${(rwy.headingError * 57.3).toFixed(1)}°`;

  const rwy = runwayMetrics(s.x, s.z, s.heading);
  ui.status.textContent = `${sim.mode.toUpperCase()} | ${sim.phase.toUpperCase()} | Camera ${sim.cameraMode} | Runway align ${(rwy.headingError * 57.3).toFixed(1)}°`;

  const warns = [];
  if (s.airspeed < 26 && !s.onGround) warns.push('LOW AIRSPEED');
  if (Math.abs(s.vs) > 4 && s.y < 20 && !s.onGround) warns.push('HIGH DESCENT RATE');
  if (Math.abs(s.roll) > radians(50) && s.y < 80) warns.push('BANK ANGLE');
  if (sim.state.crashed) warns.push('AIRFRAME DAMAGED');
  ui.warnings.textContent = warns.join(' · ');
}

function runwayMetrics(x, z, heading) {
  const onRunway = Math.abs(x) <= 22 && z >= -650 && z <= 650;
  const centerOffset = x;
  const desired = z < 0 ? radians(0) : radians(180);
  const headingError = Math.abs(normAngle(heading - desired));
  return { onRunway, centerOffset, headingError };
}

function terrainHeight(x, z) {
  if (Math.abs(x) < 28 && z > -700 && z < 700) return 0;
  return 0.4 + Math.sin(x * 0.009) * 0.25 + Math.cos(z * 0.008) * 0.22;
}

function drawQuad(cam, p1, p2, p3, p4, color) {
  const a = project(toObj(p1), cam), b = project(toObj(p2), cam), c = project(toObj(p3), cam), d = project(toObj(p4), cam);
  if (!a || !b || !c || !d) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();
}

function project(p, cam) {
  let dx = p.x - cam.x;
  let dy = p.y - cam.y;
  let dz = p.z - cam.z;

  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  let x = dx * cy - dz * sy;
  let z = dx * sy + dz * cy;

  const cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  let y = dy * cp - z * sp;
  z = dy * sp + z * cp;

  const cr = Math.cos(-cam.roll), sr = Math.sin(-cam.roll);
  const xr = x * cr - y * sr;
  const yr = x * sr + y * cr;

  if (z <= 0.4) return null;
  const f = canvas.height / Math.tan(radians(cam.fov) / 2);
  return { x: canvas.width / 2 + (xr * f) / z, y: canvas.height / 2 - (yr * f) / z };
}

function toObj([x,y,z]) { return {x,y,z}; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function radians(d) { return d * Math.PI / 180; }
function degrees(r) { return r * 180 / Math.PI; }
function normAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; ctx.font = `${14 * dpr}px monospace`; }
}
function loadLocal(key, fallback) { try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key) || '{}')) }; } catch { return fallback; } }
