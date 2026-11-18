// shots.js — deterministic screenshot scenes (?shot=chase|streets|mission|getaway).
// Each shot stages the city, the player, the police and the HUD, then main.js
// renders a fixed number of frames and raises window.__shotReady.
// The cover (chase) shows the whole loop in one frame: a getaway drive,
// wanted stars, police on the tail, the minimap and a mission objective.

import { makeCarMesh, syncCarMesh } from './vehicles.js';

/** Put Mara in a car at (x, z) with a speed, and register it with the world. */
function givePlayerCar(world, color, x, z, heading, speed, sport = false) {
  const mesh = makeCarMesh(color, false, sport);
  world.scene.add(mesh.group);
  const car = {
    kind: 'player', ...mesh, x, z, heading, speed,
    gone: false, steerVis: 0, crashed: false,
  };
  syncCarMesh(car);
  world.cars.push(car);
  world.player.car = car;
  world.player.mesh.visible = false;
  world.player.x = x;
  world.player.z = z;
  return car;
}

/** Place a police cruiser at a fixed offset from the player. */
function placePolice(world, dx, dz, speed, mode = 'pursuit') {
  const car = world.police.spawnCarNear({ x: 0, z: 0 });
  const p = world.player.pos;
  car.x = p.x + dx;
  car.z = p.z + dz;
  car.speed = speed;
  car.heading = world.player.car ? world.player.car.heading : 0;
  car.mode = mode;
  car.stagedDx = dx;
  car.stagedDz = dz;
  syncCarMesh(car);
  return car;
}

export function applyShot(world, name) {
  const { player, police, missions } = world;
  world.shotName = name;
  // Every shot starts from a clean slate: no heat, no mission, Mara on foot.
  police.clearHeat();
  if (missions.current) missions.failMission('shot setup');
  player.health = 100;
  player.money = 2450;
  player.ammo = 12;

  if (name === 'chase') {
    // COVER: pink Aurora at speed down the main avenue, 3 stars, three
    // cruisers in frame — one on the tail, one cutting across ahead, one on
    // the right flank — the police heli overhead, the sun low ahead, mission
    // objective on the HUD. (The camera sits ~11m behind the car, so a
    // cruiser 7m back reads large at the bottom of the frame.)
    const car = givePlayerCar(world, 0xff2e88, 0, -30, Math.PI, 22, true);
    car.gold = true;
    police.addHeat(3, 'shot');
    // All three cruisers flank or lead — none sits on the camera line behind
    // the Aurora, so the pink car stays the hero of the frame. Frozen, so
    // the chase AI never pulls them back onto the Aurora mid-shot.
    placePolice(world, 5, -16, 25, 'pursuit');
    placePolice(world, -9, -14, 24, 'pursuit');
    placePolice(world, 12, -6, 24, 'ramming');
    police.frozen = true;
    // Cinematic heli: far north, low enough to sit in the sky of the frame.
    police.heliOrbitR = 65;
    police.heliOrbitY = 20;
    police.heliAngle0 = -Math.PI / 2;
    police.heliSpin = 0.05;
    world.camera.yaw = Math.PI;
    world.camera.pitch = 0.24;
    world.camera.dist = 12.5;
    world.shotObjective = {
      title: 'JOB 2 — HOT WHEELS',
      text: 'Deliver the Aurora to the CHOP SHOP — lose the cops!',
    };
    world.shotTarget = { x: 224, z: -112 };
    world.hud.dialogue('MARA VOSS — GETAWAY DRIVER', 'Three stars and the whole department on my tail — hold on tight!', 0);
  } else if (name === 'streets') {
    // On foot mid-block on the avenue: traffic, pedestrians, towers, and the
    // mission beacon glowing straight down the avenue, two blocks north.
    // (Mid-block, so no corner lamp post crowds the camera.)
    player.x = -2; player.z = -28;
    player.heading = Math.PI;
    player.mesh.position.set(-2, 0, -28);
    missions.marker.visible = true;
    missions.marker.position.set(0, 0, -112);
    world.camera.yaw = Math.PI;
    world.camera.pitch = 0.3;
    world.camera.dist = 8;
    world.shotObjective = {
      title: 'JOB 1 — THE PICKUP',
      text: 'Drive to the DOCKS and collect the package',
    };
    world.shotTarget = { x: 0, z: -112 };
    world.hud.dialogue('MARA VOSS — GETAWAY DRIVER', 'Package is at the docks — two blocks north. Keep it quiet.', 0);
  } else if (name === 'mission') {
    // At the docks: the car waits ON the beach road (x=112) facing south,
    // the package beacon dead ahead with the beach and the sea behind it.
    // (The car cruises forward in shot mode, so it starts 56m back.)
    givePlayerCar(world, 0xc23b2e, 112, 180, 0, 0);
    missions.startMission(0);
    world.camera.yaw = 0;
    world.camera.pitch = 0.36;
    world.camera.dist = 12;
    world.shotObjective = {
      title: 'JOB 1 — THE PICKUP',
      text: 'Drive to the DOCKS and collect the package',
    };
    world.shotTarget = missions.target;
    world.hud.dialogue('MARA VOSS — GETAWAY DRIVER', 'Package is right there under the beam — grab it and go.', 0);
  } else if (name === 'getaway') {
    // Beach road at speed, ocean on the right, a cruiser pulling alongside,
    // the heli overhead, and the 150-second clock running.
    givePlayerCar(world, 0x2e6fc2, -80, 224, Math.PI / 2, 24);
    police.addHeat(2, 'shot');
    // Two cruisers ahead on the flanks (wantCars = 2 at wanted 2), frozen so
    // they stay in frame and never drift between camera and car.
    placePolice(world, 8, -10, 24, 'pursuit');
    placePolice(world, -10, -20, 24, 'pursuit');
    police.frozen = true;
    police.heliOrbitR = 65;
    police.heliOrbitY = 18;
    police.heliAngle0 = 0;
    police.heliSpin = 0.05;
    world.shotTimer = 150;
    world.camera.yaw = Math.PI / 2;
    world.camera.pitch = 0.3;
    world.camera.dist = 11;
    world.shotObjective = {
      title: 'JOB 3 — THE HEAT IS ON',
      text: '2 STARS! Reach the HIDEOUT before the PD boxes you in',
    };
    world.shotTarget = { x: -224, z: 168 };
    world.hud.dialogue('MARA VOSS — GETAWAY DRIVER', 'Two minutes thirty on the clock and the heli is already up — drive!', 0);
  } else {
    // Unknown ?shot=: plain free-roam framing.
    player.x = 0; player.z = 40;
    player.heading = Math.PI;
    world.camera.yaw = Math.PI;
    world.camera.pitch = 0.32;
    world.camera.dist = 9;
  }
}
