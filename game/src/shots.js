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

/** Graph node at geometric position (STREETS[ix], STREETS[iz]).
 * (Nodes are pushed ix-major, so the index is ix * 9 + iz.) */
function nodeAt(world, ix, iz) {
  return world.city.nodes[ix * 9 + iz];
}

/** Stage a traffic car on a fixed avenue segment, driving with the traffic
 * system's own lane logic — it keeps moving after staging, so the street
 * reads alive instead of parked. `from`/`to` are city graph nodes; `t` is
 * the progress along the segment at staging time. */
function stageTraffic(world, from, to, t, speed) {
  let car = null;
  for (let i = 0; i < 20 && !car; i++) car = world.traffic.spawnOne(world.player.pos);
  if (!car) return null;
  car.from = from;
  car.to = to;
  car.t = t;
  car.speed = speed;
  car.cruiseSpeed = speed;
  const p = world.traffic.lanePoint(from, to, t);
  car.x = p.x;
  car.z = p.z;
  car.heading = p.heading;
  syncCarMesh(car);
  return car;
}

/** Stage a pedestrian strolling a sidewalk: spawn through the ped system,
 * then pin it (and its stroll target) to a sidewalk spot in frame. */
function stagePed(world, x, z, targetX, targetZ) {
  const ped = world.peds.spawnOne(world.player.pos);
  ped.x = x;
  ped.z = z;
  ped.target = { x: targetX, z: targetZ };
  ped.heading = Math.atan2(targetX - x, targetZ - z);
  ped.mesh.position.set(x, 0, z);
  ped.mesh.rotation.y = ped.heading;
  return ped;
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
    // COVER: pink Aurora at speed down the main avenue, 4 stars, four
    // cruisers in frame — one on the tail, one cutting across ahead, one on
    // the right flank, one roadblocking ahead — the police heli overhead,
    // the sun low ahead, mission objective on the HUD. (The camera sits
    // ~12m behind the car, so a cruiser 7m back reads large at the bottom
    // of the frame.)
    const car = givePlayerCar(world, 0xff2e88, 0, -30, Math.PI, 22, true);
    car.gold = true;
    police.addHeat(4, 'shot');
    // All four cruisers flank or lead — none sits on the camera line behind
    // the Aurora, so the pink car stays the hero of the frame. Frozen, so
    // the chase AI never pulls them back onto the Aurora mid-shot.
    placePolice(world, 5, -16, 25, 'pursuit');
    placePolice(world, -9, -14, 24, 'pursuit');
    placePolice(world, 12, -6, 24, 'ramming');
    placePolice(world, 14, -24, 24, 'roadblock');
    // Two traffic cars on the avenue ahead — the road in front of the Aurora
    // reads busy, not empty. Both drive north, slower than the Aurora, so
    // the gap only closes to ~30m by the shutter and nothing is covered.
    stageTraffic(world, nodeAt(world, 4, 3), nodeAt(world, 4, 2), 0.30, 8);
    stageTraffic(world, nodeAt(world, 4, 2), nodeAt(world, 4, 1), 0.10, 9);
    police.frozen = true;
    // Cinematic heli: far north, low enough to sit in the sky of the frame.
    police.heliOrbitR = 65;
    police.heliOrbitY = 20;
    police.heliAngle0 = -Math.PI / 2;
    police.heliSpin = 0.05;
    world.camera.yaw = Math.PI;
    world.camera.pitch = 0.22;
    world.camera.dist = 11.5;
    world.shotObjective = {
      title: 'JOB 2 — HOT WHEELS',
      text: 'Deliver the Aurora to the CHOP SHOP — lose the cops!',
    };
    world.shotTarget = { x: 224, z: -112 };
    world.hud.dialogue('MARA VOSS — GETAWAY DRIVER', 'Four stars and the whole department on my tail — hold on tight!', 0);
  } else if (name === 'streets') {
    // On foot mid-block on the avenue: traffic, pedestrians, towers, and the
    // mission beacon glowing straight down the avenue, two blocks north.
    // (Mid-block, so no corner lamp post crowds the camera.)
    player.x = -2; player.z = -28;
    player.heading = Math.PI;
    player.mesh.position.set(-2, 0, -28);
    missions.marker.visible = true;
    missions.marker.position.set(0, 0, -112);
    // The avenue in frame must read BUSY: three traffic cars on the road
    // ahead (two northbound, one southbound) and six pedestrians strolling
    // the sidewalks — all staged through the traffic/ped systems, so they
    // keep moving and the street reads alive instead of empty.
    stageTraffic(world, nodeAt(world, 4, 3), nodeAt(world, 4, 2), 0.12, 9);
    stageTraffic(world, nodeAt(world, 4, 3), nodeAt(world, 4, 2), 0.38, 8);
    stageTraffic(world, nodeAt(world, 4, 2), nodeAt(world, 4, 3), 0.15, 10);
    stagePed(world, 8.5, -48, 8.5, -80);
    stagePed(world, -8.5, -62, -8.5, -95);
    stagePed(world, 8.5, -78, 8.5, -105);
    stagePed(world, -8.5, -88, -8.5, -60);
    stagePed(world, 8.5, -100, 8.5, -72);
    stagePed(world, -8.5, -42, -8.5, -75);
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
    // Beach road at speed, ocean on the right, cruisers pulling alongside,
    // the heli overhead, and the 150-second clock running.
    givePlayerCar(world, 0x2e6fc2, -80, 224, Math.PI / 2, 24);
    police.addHeat(3, 'shot');
    // Three cruisers ahead on the flanks (wantCars = 3 at wanted 3), frozen so
    // they stay in frame and never drift between camera and car.
    placePolice(world, 8, -10, 24, 'pursuit');
    placePolice(world, -10, -20, 24, 'pursuit');
    placePolice(world, 4, -28, 24, 'ramming');
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
      text: '3 STARS! Reach the HIDEOUT before the PD boxes you in',
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
