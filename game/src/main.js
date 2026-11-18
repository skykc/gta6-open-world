// main.js — SOLMAR HEAT: bootstrap, game loop, camera rig, crime wiring,
// menus, save/load, and the deterministic ?shot= screenshot mode.

import * as THREE from 'three';
import { clamp, lerp, angleLerp, urlParams, mulberry32 } from './utils.js';
import { buildCity, districtAt } from './city.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { Player } from './player.js';
import { TrafficSystem, spawnParkedCars, updatePlayerCar } from './vehicles.js';
import { PedSystem } from './pedestrians.js';
import { PoliceSystem } from './police.js';
import { MissionSystem } from './missions.js';
import { StashSystem } from './collectibles.js';
import { HUD } from './hud.js';
import { applyShot } from './shots.js';

const SAVE_KEY = 'solmar-heat-v1';
const SPAWN = { x: 0, z: 40 };

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s !== 'object' || s === null) return null;
    return { money: typeof s.money === 'number' ? s.money : 0, done: Array.isArray(s.done) ? s.done : [] };
  } catch { return null; }
}

function writeSave(money, done) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ money, done: [...done] }));
  } catch { /* private mode: progress just lives for the session */ }
}

const params = urlParams();
const SHOT_MODE = params.shot !== '';
const SEED = params.seed || 20261118;

// ---- renderer / scene / camera ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Filmic sunset grade: warm highlights, deeper shadows, punchier colour.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById('game-root').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 6, 52);

const city = buildCity(scene, SEED);
const input = new Input();
const audio = new AudioSys();
const hud = new HUD();
const player = new Player(scene);
const traffic = new TrafficSystem(scene, city, mulberry32(SEED + 7));
const parked = spawnParkedCars(scene, city, mulberry32(SEED + 21), 22);
const peds = new PedSystem(scene, city, mulberry32(SEED + 33));
const stash = new StashSystem(scene, {
  onCollect: (spot, found) => {
    player.money += 250;
    player.addRespect(2);
    audio.chime();
    hud.toast(`Stash found! +$250 · RESPECT +2  (${found}/8)`);
    if (found >= 8) hud.banner('ALL 8 STASHES FOUND — SOLMAR IS YOURS');
  },
  onSmg: () => {
    player.giveSmg();
    audio.chime();
    hud.toast('SMG unlocked! Press 3 to equip — 32 rounds, full auto.');
  },
});
const missions = new MissionSystem(scene, city, mulberry32(SEED + 55), {
  onToast: (t) => hud.toast(t),
  onReward: (amount, title) => {
    player.money += amount;
    player.addRespect(10);
    audio.sting();
    hud.banner(`${title} COMPLETE  +$${amount.toLocaleString('en-US')}`);
    hud.toast(`Banked $${amount.toLocaleString('en-US')}. RESPECT +10. Next job unlocked.`);
    writeSave(player.money, missions.completed);
  },
  onComplete: () => { refreshMenuMissions(); },
  onFail: (msg) => { hud.toast(msg, 5000); audio.siren(false); },
  onDialogue: (name, text) => hud.dialogue(name, text),
  onHeat: (n) => { police.addHeat(n, 'mission'); },
  onClearHeat: () => { police.clearHeat(); },
  onSpecialCar: (car) => { world.cars.push(car); },
});
const police = new PoliceSystem(scene, city, mulberry32(SEED + 77), {
  onCaught: () => endRun('CAUGHT', 'The Solmar PD boxed you in. They took 20% of your cash — but Mara walks free. The jobs are still waiting.'),
  onDown: () => endRun('MARA IS DOWN', 'Mara is down. The city chews up drivers who push too hard — but she always gets back up.'),
});
police.onHeat = (n, reason) => {
  if (n > 0) {
    hud.toast(`WANTED LEVEL ${n} — ${reason}`);
    police._peakWanted = Math.max(police._peakWanted || 0, n);
  } else {
    hud.toast('You lost the heat… for now.');
    // Escaping a 3+ star chase earns street cred.
    if ((police._peakWanted || 0) >= 3) {
      player.addRespect(5);
      hud.toast('Clean getaway — RESPECT +5');
    }
    police._peakWanted = 0;
  }
};
police._peakWanted = 0;
police.onCrash = () => { audio.crash(); shake(0.5); };
police.onPunch = () => { audio.punch(); shake(0.3); };

const world = {
  scene, city, rng: mulberry32(SEED + 99),
  player, traffic, peds, police, missions, hud, audio, stash,
  cars: [...parked],
  camera: { yaw: Math.PI, pitch: 0.32, dist: 9 },
  shotName: '', shotObjective: null, shotTarget: null,
};
window.__game = world;
window.__shotReady = false;

// Restore progress.
const save = loadSave();
if (save) {
  player.money = save.money;
  for (const id of save.done) missions.completed.add(id);
}

// ---- menus ----
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause-menu');
const endEl = document.getElementById('end-screen');
let paused = true;
let inMenu = true;
let shakeAmt = 0;
function shake(a) { shakeAmt = Math.max(shakeAmt, a); }

function refreshMenuMissions() {
  const box = document.getElementById('menu-missions');
  box.innerHTML = '';
  for (const def of missions.defs) {
    const done = missions.completed.has(def.id);
    const div = document.createElement('div');
    div.innerHTML = done
      ? `<span class="done">✓ ${def.title} — DONE (+$${def.reward.toLocaleString('en-US')})</span>`
      : `${def.title} — $${def.reward.toLocaleString('en-US')} &nbsp; <button class="btn-secondary" style="padding:6px 14px;font-size:14px" data-mission="${def.id}">START JOB</button>`;
    box.appendChild(div);
  }
  box.querySelectorAll('[data-mission]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.mission, 10);
      startPlaying();
      missions.startMission(id);
    });
  });
  const cont = document.getElementById('btn-continue');
  if (save && (save.money > 0 || save.done.length > 0)) {
    cont.classList.remove('hidden');
    document.getElementById('continue-label').textContent =
      `$${save.money.toLocaleString('en-US')} · ${save.done.length}/4 jobs`;
  }
}
refreshMenuMissions();

function startPlaying() {
  inMenu = false;
  paused = false;
  // Swallow the click that opened the game so it does not fire the pistol.
  input.takeClick();
  input.takeMouseDelta();
  menuEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  endEl.classList.add('hidden');
  hud.show();
  audio.ensure();
  if (!missions.active && missions.completed.size < 4) {
    const next = missions.defs.find((d) => !missions.completed.has(d.id));
    hud.toast(`${next.title} — ${next.brief}`, 6000);
  }
}
function endRun(title, text) {
  paused = true;
  police.clearHeat();
  if (missions.current) missions.failMission(title === 'CAUGHT' ? 'caught by the PD' : 'taken down on the streets');
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-text').textContent = text;
  endEl.classList.remove('hidden');
}
function respawn() {
  if (player.car) {
    player.car.speed = 0;
    player.car = null;
    player.mesh.visible = true;
  }
  player.money = Math.floor(player.money * 0.8);
  player.health = 100;
  player.ammo = 12;
  player.x = SPAWN.x; player.z = SPAWN.z;
  player.heading = Math.PI;
  player.mesh.position.set(SPAWN.x, 0, SPAWN.z);
  writeSave(player.money, missions.completed);
  endEl.classList.add('hidden');
  paused = false;
  hud.toast('Back on the streets, Mara. The city is still yours to take.');
}

document.getElementById('btn-play').addEventListener('click', () => {
  audio.ensure();
  startPlaying();
  const next = missions.defs.find((d) => !missions.completed.has(d.id));
  if (next) missions.startMission(next.id);
});
document.getElementById('btn-continue').addEventListener('click', () => {
  audio.ensure();
  startPlaying();
});
document.getElementById('btn-resume').addEventListener('click', () => {
  pauseEl.classList.add('hidden');
  paused = false;
});
document.getElementById('btn-restart-mission').addEventListener('click', () => {
  pauseEl.classList.add('hidden');
  paused = false;
  if (missions.current) {
    const id = missions.current.def.id;
    missions.failMission('restarted');
    missions.startMission(id);
  }
});
document.getElementById('btn-quit-menu').addEventListener('click', () => {
  pauseEl.classList.add('hidden');
  inMenu = true;
  paused = true;
  hud.hide();
  menuEl.classList.remove('hidden');
  refreshMenuMissions();
});
document.getElementById('btn-respawn').addEventListener('click', respawn);
input.onFirstGesture = () => audio.ensure();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- crime wiring: every illegal act feeds the wanted system ----
// Every car in the world, deduplicated: parked + special (world.cars),
// traffic AI cars, police cruisers. The player's current car is in one of
// these lists already, so collisions always see it.
function allCars() {
  const seen = new Set();
  const out = [];
  for (const c of [...world.cars, ...traffic.cars, ...police.cars]) {
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

function tryStealCar() {
  const car = player.tryEnterCar(allCars());
  if (!car) return;
  // A stolen car leaves its AI fleet: traffic stops driving it, the PD
  // stops counting it as a cruiser. It stays in world.cars for collisions.
  const ti = traffic.cars.indexOf(car);
  if (ti >= 0) traffic.cars.splice(ti, 1);
  const pi = police.cars.indexOf(car);
  if (pi >= 0) police.cars.splice(pi, 1);
  if (!world.cars.includes(car)) world.cars.push(car);
  const wasPolice = car.kind === 'police';
  car.kind = 'player';
  audio.steal();
  if (wasPolice) {
    police.addHeat(2, 'you stole a police cruiser');
    hud.toast('You stole a PD cruiser! The whole force is coming.');
  } else {
    police.addHeat(1, 'grand theft auto');
    hud.toast('Car stolen — keep it moving, Mara.');
  }
}

function doPunch() {
  const targets = [...peds.peds, ...police.cops];
  const victim = player.punch(targets);
  if (!victim) return;
  audio.punch();
  if (police.cops.includes(victim)) {
    victim.down = true;
    victim.downT = 0;
    police.addHeat(1, 'you decked a cop');
    hud.toast('You decked a cop! That will cost you.');
  } else {
    victim.down = true;
    peds.scareAt(victim.x, victim.z);
    police.addHeat(1, 'assault on the street');
    hud.toast('That was assault, Mara. Someone called it in.');
  }
}

function doShoot() {
  const targets = [
    ...peds.peds.map((p) => ({ ...p, hitRadius: 0.9, y: 1.2 })),
    ...police.cops.map((c) => ({ ...c, hitRadius: 0.9, y: 1.2 })),
  ];
  const result = player.shoot(camera, targets);
  if (!result) return;
  if (result.kind === 'dry') {
    hud.toast('Reloading…');
    return;
  }
  audio.shot();
  peds.scareAt(player.x + Math.sin(player.heading) * 10, player.z + Math.cos(player.heading) * 10);
  if (result.kind === 'hit') {
    const t = result.target;
    if (police.cops.includes(t)) {
      t.down = true; t.downT = 0;
      police.addHeat(1, 'you shot a cop');
      hud.toast('You shot a cop! Full heat incoming.');
    } else {
      t.down = true;
      police.addHeat(1, 'shots fired on the street');
      hud.toast('Shots fired — the PD is on its way.');
    }
  }
}

// ---- camera rig ----
function updateCamera(dt) {
  const target = player.isDriving ? player.car : player;
  const tx = target.x, tz = target.z;
  const ty = player.isDriving ? 1.6 : 1.7;
  // Driving: the camera swings behind the car; on foot it follows the orbit.
  if (player.isDriving) {
    world.camera.yaw = angleLerp(world.camera.yaw, player.car.heading, Math.min(1, dt * 2.5));
    world.camera.dist = lerp(world.camera.dist, 10.5, Math.min(1, dt * 3));
  } else {
    world.camera.dist = lerp(world.camera.dist, 7.5, Math.min(1, dt * 3));
  }
  const md = input.takeMouseDelta();
  world.camera.yaw -= md.dx * 0.005;
  world.camera.pitch = clamp(world.camera.pitch + md.dy * 0.003, 0.08, 0.85);
  const yaw = world.camera.yaw, pitch = world.camera.pitch, dist = world.camera.dist;
  const cx = tx - Math.sin(yaw) * Math.cos(pitch) * dist;
  const cz = tz - Math.cos(yaw) * Math.cos(pitch) * dist;
  const cy = ty + Math.sin(pitch) * dist;
  let sx = 0, sz = 0;
  if (shakeAmt > 0.01) {
    sx = (Math.random() - 0.5) * shakeAmt;
    sz = (Math.random() - 0.5) * shakeAmt;
    shakeAmt *= Math.max(0, 1 - dt * 5);
  }
  camera.position.set(cx + sx, cy, cz + sz);
  camera.lookAt(tx, ty, tz);
}

// ---- main loop ----
let lastT = performance.now();
let shotFrames = 0;
const clock = { now: 0 };
// In-game clock: Day 1 starts at sunset, 18:52. 1 real second = 15 game-seconds.
let gameMinutes = 18 * 60 + 52;

/** The full HUD payload — also reused for the city-map overlay. */
function hudState() {
  const obj = world.shotObjective || {
    title: missions.active ? missions.current.def.title : 'SOLMAR HEAT',
    text: missions.objectiveText,
  };
  return {
    money: player.money,
    health: player.health,
    ammo: player.ammo,
    reloading: player.reloadTimer > 0,
    weapon: player.weapon,
    hasSmg: player.hasSmg,
    smgMag: player.smgMag,
    smgReserve: player.smgReserve,
    respect: player.respect,
    respectLevel: player.respectLevel,
    gameMinutes,
    district: districtAt(player.pos.x, player.pos.z),
    wanted: police.wanted,
    speed: player.isDriving ? player.car.speed : 0,
    driving: player.isDriving,
    objectiveTitle: obj.title,
    objectiveText: obj.text,
    missionTimer: (missions.current && missions.current.timer > 0)
      ? missions.current.timer : (world.shotTimer || 0),
    policeCops: police.cops.filter((c) => !c.down).length,
    heliActive: !!police.heli,
    playerX: player.pos.x,
    playerZ: player.pos.z,
    heading: player.isDriving ? player.car.heading : player.heading,
    police: police.cars,
    missionTarget: world.shotTarget || missions.target,
    traffic: traffic.cars,
    goldCar: missions.specialCar,
    bustMeter: police.bustMeter,
    inMenu,
    jobsDone: missions.completed.size,
    stashFound: stash.found,
    stashes: stash.stashes,
    smgTaken: stash.smg.taken,
    missionList: missions.defs.map((d) => ({ title: d.title, reward: d.reward, done: missions.completed.has(d.id) })),
  };
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - lastT) / 1000, 0.001, 0.05);
  lastT = now;
  clock.now = now / 1000;

  // City-map toggle works even while paused (the map IS a pause).
  if (!inMenu && input.consume('Tab')) {
    if (hud.mapOpen) {
      hud.hideMap();
      paused = false;
    } else {
      hud.showMap(hudState());
      paused = true;
    }
  }
  if (!inMenu && input.consume('Escape') && hud.mapOpen) {
    hud.hideMap();
    paused = false;
  }

  if (!paused) {
    gameMinutes += dt * 0.25;
    // Edge-triggered actions.
    if (input.consume('KeyE')) {
      if (player.isDriving) player.exitCar();
      else tryStealCar();
    }
    if (input.consume('KeyF')) doPunch();
    if (input.consume('KeyR')) player.reload();
    if (input.consume('Digit1')) player.selectWeapon(1);
    if (input.consume('Digit2')) player.selectWeapon(2);
    if (input.consume('Digit3') && !player.selectWeapon(3)) {
      hud.toast('SMG locked — find the red crate downtown first.');
    }
    if (input.consume('KeyM')) {
      audio.setMuted(!audio.muted);
      hud.toast(audio.muted ? 'Sound muted' : 'Sound on');
    }
    if (input.consume('KeyP') || input.consume('Escape')) {
      paused = true;
      pauseEl.classList.remove('hidden');
    }
    if (input.takeClick() && !player.isDriving && !inMenu) {
      if (player.weapon === 'fist') doPunch();
      else doShoot();
    }

    // Player + driving.
    if (player.isDriving) {
      const others = allCars().filter((c) => c !== player.car);
      updatePlayerCar(player.car, input, dt, city, others);
      if (player.car.crashed) {
        player.car.crashed = false;
        audio.crash();
        shake(0.6);
        player.takeDamage(4);
      }
      // Running over pedestrians in a car is a crime.
      for (const ped of peds.peds) {
        if (!ped.down && Math.hypot(ped.x - player.car.x, ped.z - player.car.z) < 2.6) {
          ped.down = true;
          peds.scareAt(ped.x, ped.z);
          police.addHeat(1, 'you ran over a pedestrian');
          audio.crash();
          hud.toast('You ran over a pedestrian!');
          player.car.speed *= 0.6;
        }
      }
    } else {
      player.update(dt, input, world.camera.yaw, city, allCars());
    }
    traffic.update(dt, player.pos);
    peds.update(dt, player.pos, player.car);
    stash.update(dt, player.pos);
    police.update(dt, player, allCars());
    if (SHOT_MODE) {
      // Screenshot mode: keep the staged chase at speed and the HUD clean —
      // the police ram and the coasting decay would otherwise stop the car
      // before the shutter fires. The real game is untouched by this.
      if (player.isDriving) player.car.speed = Math.max(player.car.speed, 20);
      player.health = 100;
    }
    missions.update(dt, player);
    if (player.health <= 0) endRun('MARA IS DOWN', 'Mara is down. The city chews up drivers who push too hard — but she always gets back up.');

    // Audio beds.
    audio.engine(player.isDriving ? Math.abs(player.car.speed) / 30 : 0, player.isDriving);
    audio.siren(police.wanted >= 2);
  }

  // HUD (also in shot mode, where the menu never opens).
  hud.update(hudState());

  // Menu backdrop: slow orbit around the city centre while the menu is up.
  if (inMenu && !SHOT_MODE) {
    const a = clock.now * 0.05;
    camera.position.set(Math.sin(a) * 190, 95, Math.cos(a) * 190);
    camera.lookAt(0, 10, 0);
  } else {
    updateCamera(dt);
  }

  renderer.render(scene, camera);

  if (SHOT_MODE) {
    shotFrames++;
    if (shotFrames === 45) window.__shotReady = true;
  }
}

// ---- boot ----
if (SHOT_MODE) {
  inMenu = false;
  paused = false;
  menuEl.classList.add('hidden');
  hud.show();
  applyShot(world, params.shot);
  // Traffic + peds need a moment to populate around the staged scene.
  for (let i = 0; i < 3; i++) {
    traffic.update(0.5, player.pos);
    peds.update(0.5, player.pos, player.car);
  }
} else {
  hud.hide();
}
requestAnimationFrame(frame);
