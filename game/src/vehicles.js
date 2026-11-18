// vehicles.js — box-built cars, arcade driving physics, traffic that follows
// the city road graph, and parked cars waiting to be stolen.

import * as THREE from 'three';
import { clamp, lerp, angleLerp, randRange, pick, dist2d } from './utils.js';
import { resolveCircleVsBuildings, ROAD_HALF } from './city.js';

export const CAR_COLORS = [0xc23b2e, 0x2e6fc2, 0xe8b93b, 0x3aa655, 0x8a5fc2, 0xd8d8d8, 0x222831, 0xe07b39, 0x4fc2c2];
const WHEEL_GEO = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
const WHEEL_MAT = new THREE.MeshLambertMaterial({ color: 0x141414 });

/** Build a car mesh. `police` adds a red/blue light bar; `sport` adds a rear wing. Returns { group, wheels, lightBar }. */
export function makeCarMesh(color, police = false, sport = false) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2733 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 2.2), glassMat);
  cabin.position.set(0, 1.1, -0.2);
  group.add(cabin);
  if (sport) {
    // Rear wing on two struts, like the Aurora GT in the reference chase.
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x14141c });
    for (const s of [-0.7, 0.7]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), wingMat);
      strut.position.set(s, 1.05, -2.0);
      group.add(strut);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 0.55), wingMat);
    wing.position.set(0, 1.28, -2.0);
    group.add(wing);
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const s of [-0.65, 0.65]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.1), headMat);
    h.position.set(s, 0.6, 2.21);
    group.add(h);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.16, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff2a22 })
    );
    tail.position.set(s, 0.6, -2.21);
    group.add(tail);
  }
  const wheels = {};
  const spots = { fl: [-0.95, 1.45], fr: [0.95, 1.45], rl: [-0.95, -1.45], rr: [0.95, -1.45] };
  for (const [key, [x, z]] of Object.entries(spots)) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const wheel = new THREE.Mesh(WHEEL_GEO, WHEEL_MAT);
    wheel.rotation.z = Math.PI / 2;
    pivot.add(wheel);
    group.add(pivot);
    wheels[key] = pivot;
  }
  let lightBar = null;
  if (police) {
    lightBar = new THREE.Group();
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.18, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff2020 })
    );
    red.position.x = -0.4;
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.18, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x2050ff })
    );
    blue.position.x = 0.4;
    lightBar.add(red, blue);
    lightBar.position.set(0, 1.5, -0.2);
    lightBar.userData = { red, blue };
    group.add(lightBar);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { group, wheels, lightBar };
}

/** Sync a mesh to a car's logical state (x, z, heading). */
export function syncCarMesh(car) {
  car.group.position.set(car.x, 0, car.z);
  car.group.rotation.y = car.heading;
  const steerVis = car.steerVis || 0;
  if (car.wheels) {
    car.wheels.fl.rotation.y = steerVis;
    car.wheels.fr.rotation.y = steerVis;
    const spin = (car.speed || 0) * 0.016 / 0.36;
    for (const w of Object.values(car.wheels)) w.children[0].rotation.x += spin;
  }
}

/** Arcade driving: throttle, brake, steering, handbrake, building + car collisions. */
export function updatePlayerCar(car, input, dt, city, others) {
  const accelIn = (input.up ? 1 : 0) - (input.down ? 0.55 : 0);
  const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const handbrake = !!input.handbrake;
  const maxSpeed = 30;
  const maxReverse = 9;
  if (accelIn > 0) car.speed += 15 * dt * accelIn;
  else if (accelIn < 0) {
    if (car.speed > 0.5) car.speed -= 34 * dt;
    else car.speed -= 9 * dt;
  } else {
    car.speed -= Math.sign(car.speed) * 6 * dt;
    if (Math.abs(car.speed) < 0.4) car.speed = 0;
  }
  if (handbrake) {
    car.speed -= Math.sign(car.speed) * 22 * dt;
    if (Math.abs(car.speed) < 1) car.speed = 0;
  }
  car.speed = clamp(car.speed, -maxReverse, maxSpeed);
  const steerAuthority = clamp(Math.abs(car.speed) / 7, 0, 1) * (car.speed >= 0 ? 1 : -1);
  const turnRate = steerIn * 2.1 * steerAuthority * (handbrake ? 1.5 : 1);
  car.heading += turnRate * dt;
  car.steerVis = lerp(car.steerVis || 0, steerIn * 0.42, Math.min(1, dt * 10));
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const hitWall = resolveCircleVsBuildings(nx, nz, 2.0, city.colliders);
  const pushed = hitWall.x !== nx || hitWall.z !== nz;
  car.x = clamp(hitWall.x, -250, 250);
  car.z = clamp(hitWall.z, -250, 318);
  if (pushed) {
    if (Math.abs(car.speed) > 6) car.crashed = true;
    car.speed *= 0.45;
  }
  // Soft car-vs-car shove.
  for (const o of others) {
    if (o === car || o.gone) continue;
    const d = dist2d(car.x, car.z, o.x, o.z);
    if (d < 4.4 && d > 0.01) {
      const push = (4.4 - d) / 2;
      const ux = (car.x - o.x) / d, uz = (car.z - o.z) / d;
      car.x += ux * push; car.z += uz * push;
      if (o.kind === 'traffic' || o.kind === 'parked') {
        o.x -= ux * push; o.z -= uz * push;
        if (o.kind === 'traffic') o.speed = Math.max(0, o.speed - 4);
      }
      if (Math.abs(car.speed) > 8) car.crashed = true;
      car.speed *= 0.7;
    }
  }
  syncCarMesh(car);
}

/** Traffic: cars cruise the road graph on the right-hand lane. */
export class TrafficSystem {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.cars = [];
    this.maxCars = 14;
  }

  spawnOne(near) {
    const p = this.city.randomRoadPoint(this.rng);
    if (near && dist2d(p.x, p.z, near.x, near.z) > 170) return;
    const from = this.nearestNode(p.x, p.z);
    const to = pick(this.rng, this.city.edges.get(from));
    const mesh = makeCarMesh(pick(this.rng, CAR_COLORS));
    this.scene.add(mesh.group);
    const cruiseSpeed = randRange(this.rng, 8, 12);
    const car = {
      kind: 'traffic', ...mesh, x: p.x, z: p.z, heading: 0, speed: cruiseSpeed,
      cruiseSpeed, from, to, t: 0, gone: false, steerVis: 0,
    };
    this.cars.push(car);
    return car;
  }

  nearestNode(x, z) {
    let best = this.city.nodes[0], bd = Infinity;
    for (const n of this.city.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Lane offset: right-hand side of the direction of travel. */
  lanePoint(from, to, t) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len, fz = dz / len;
    const rx = -fz, rz = fx; // right side (x east, z south)
    return {
      x: from.x + dx * t + rx * 3,
      z: from.z + dz * t + rz * 3,
      heading: Math.atan2(fx, fz),
    };
  }

  update(dt, playerPos) {
    while (this.cars.length < this.maxCars) {
      if (!this.spawnOne(playerPos)) break;
    }
    for (const car of this.cars) {
      if (car.gone) continue;
      // Slow down for a car ahead on the same stretch.
      let targetSpeed = car.cruiseSpeed || car.speed;
      for (const o of this.cars) {
        if (o === car || o.gone) continue;
        const d = dist2d(car.x, car.z, o.x, o.z);
        if (d < 9) {
          const ahead = (o.x - car.x) * Math.sin(car.heading) + (o.z - car.z) * Math.cos(car.heading);
          if (ahead > 0) targetSpeed = Math.min(targetSpeed, 3);
        }
      }
      car.speed = lerp(car.speed, targetSpeed, Math.min(1, dt * 2));
      const segLen = Math.hypot(car.to.x - car.from.x, car.to.z - car.from.z) || 1;
      car.t += (car.speed * dt) / segLen;
      if (car.t >= 1) {
        car.from = car.to;
        const next = this.city.edges.get(car.from).filter((n) => n !== car.from);
        const choices = next.filter((n) => !(car.prev && n === car.prev));
        car.prev = car.from;
        car.to = choices.length ? pick(this.rng, choices) : pick(this.rng, next);
        car.t = 0;
      }
      const p = this.lanePoint(car.from, car.to, car.t);
      car.x = p.x; car.z = p.z;
      car.heading = angleLerp(car.heading, p.heading, Math.min(1, dt * 6));
      syncCarMesh(car);
      // Recycle far-away cars near the player so the streets always feel alive.
      if (playerPos && dist2d(car.x, car.z, playerPos.x, playerPos.z) > 190) {
        this.scene.remove(car.group);
        car.gone = true;
      }
    }
    this.cars = this.cars.filter((c) => !c.gone);
  }
}

/** Parked cars on a few blocks: free to steal, no traffic AI attached. */
export function spawnParkedCars(scene, city, rng, count = 10) {
  const cars = [];
  for (let i = 0; i < count; i++) {
    const street = pick(rng, [-224, -168, -112, -56, 0, 56, 112, 168, 224]);
    const along = randRange(rng, -200, 200);
    const vertical = rng() < 0.5;
    const x = vertical ? street + 4.4 : along;
    const z = vertical ? along : street + 4.4;
    const heading = vertical ? 0 : Math.PI / 2;
    const mesh = makeCarMesh(pick(rng, CAR_COLORS));
    scene.add(mesh.group);
    const car = { kind: 'parked', ...mesh, x, z, heading, speed: 0, gone: false, steerVis: 0 };
    syncCarMesh(car);
    cars.push(car);
  }
  return cars;
}
