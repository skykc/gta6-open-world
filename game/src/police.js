// police.js — the Solmar PD: wanted stars, pursuing cruisers, foot cops,
// and the bust meter that ends a run when the heat closes in.

import * as THREE from 'three';
import { clamp, angleLerp, randRange, pick, dist2d } from './utils.js';
import { resolveCircleVsBuildings } from './city.js';
import { makeCarMesh, syncCarMesh } from './vehicles.js';

const MAX_WANTED = 5;
const DECAY_QUIET_SECONDS = 18;
// Solmar PD unit callsigns — coastal birds and rays, handed out in order
// so the HUD's unit list can name every cruiser in the pursuit.
const CALLSIGNS = [
  'GULL-12', 'PELICAN-04', 'OSPREY-22', 'HERON-09', 'MANTA-31',
  'EGRET-17', 'TERN-08', 'CORMORANT-25', 'ALBATROSS-03', 'KESTREL-19',
];

function makeCopMesh() {
  const g = new THREE.Group();
  const navy = new THREE.MeshLambertMaterial({ color: 0x1c2f57 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0ac69 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.05, 8), navy);
  body.position.y = 0.95;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skin);
  head.position.y = 1.72;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 10), navy);
  cap.position.y = 1.94;
  g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.22), new THREE.MeshLambertMaterial({ color: 0x0d1526 }));
  brim.position.set(0, 1.9, 0.28);
  g.add(brim);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x101c33 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), legMat);
  legL.position.set(-0.14, 0.25, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legL, legR);
  g.userData = { legL, legR };
  return g;
}

function makeHeliMesh() {
  const g = new THREE.Group();
  const navy = new THREE.MeshLambertMaterial({ color: 0x1c2f57 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1a2733 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 3.4), navy);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 1.0), glass);
  nose.position.set(0, -0.1, 1.9);
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 2.6), navy);
  tail.position.set(0, 0.2, -2.8);
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.7), navy);
  fin.position.set(0, 0.8, -3.9);
  g.add(fin);
  const skidMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  for (const s of [-0.8, 0.8]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.8), skidMat);
    skid.position.set(s, -0.85, 0.2);
    g.add(skid);
  }
  const rotor = new THREE.Group();
  rotor.position.y = 0.85;
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0x222831 });
  for (const a of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.07, 0.4), bladeMat);
    blade.rotation.y = a;
    rotor.add(blade);
  }
  g.add(rotor);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.35, 0.8, -3.9);
  for (const a of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.4, 0.16), bladeMat);
    blade.rotation.x = a;
    tailRotor.add(blade);
  }
  g.add(tailRotor);
  // Searchlight cone: apex at the belly, widening down to the street.
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(4.5, 28, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2b0, transparent: true, opacity: 0.09,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  cone.position.y = -14.5;
  g.add(cone);
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  red.position.set(-0.6, -0.7, 0.6);
  const blue = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2050ff }));
  blue.position.set(0.6, -0.7, 0.6);
  g.add(red, blue);
  g.userData = { rotor, tailRotor, red, blue };
  return { group: g };
}

export class PoliceSystem {
  constructor(scene, city, rng, callbacks) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.onCaught = callbacks.onCaught;
    this.wanted = 0;
    this.lastCrimeAt = -999;
    this.decayTimer = 0;
    this.bustMeter = 0;
    this.cars = [];
    this.cops = [];
    this.flashT = 0;
    this.heli = null;
    // Cinematic heli overrides (set by the shot stager): orbit radius /
    // height / starting angle / angular speed. Defaults are the gameplay values.
    this.heliOrbitR = 20;
    this.heliOrbitY = 30;
    this.heliAngle0 = undefined;
    this.heliSpin = 0.3;
    // Staged shot: when true, cruisers hold their staged pose (light bars
    // still flash) and the heli holds its angle — deterministic framing.
    this.frozen = false;
    this.callsignIdx = 0;
  }

  nextCallsign() {
    const name = CALLSIGNS[this.callsignIdx % CALLSIGNS.length];
    this.callsignIdx++;
    return name;
  }

  addHeat(n, reason) {
    if (this.wanted >= MAX_WANTED && n > 0) return;
    this.wanted = clamp(this.wanted + n, 0, MAX_WANTED);
    this.lastCrimeAt = performance.now() / 1000;
    this.decayTimer = 0;
    if (this.onHeat) this.onHeat(this.wanted, reason);
  }

  clearHeat() {
    this.wanted = 0;
    this.bustMeter = 0;
    for (const c of this.cars) this.scene.remove(c.group);
    for (const c of this.cops) this.scene.remove(c.mesh);
    this.cars = [];
    this.cops = [];
    this.removeHeli();
  }

  spawnHeli() {
    const mesh = makeHeliMesh();
    this.scene.add(mesh.group);
    this.heli = {
      ...mesh, callsign: 'AIR-1',
      angle: this.heliAngle0 !== undefined ? this.heliAngle0 : this.rng() * Math.PI * 2,
    };
    return this.heli;
  }

  removeHeli() {
    if (!this.heli) return;
    this.scene.remove(this.heli.group);
    this.heli = null;
  }

  spawnCarNear(playerPos) {
    const p = this.city.randomRoadPoint(this.rng);
    // Prefer a spawn 60–110m from the player so the chase arrives, not teleports.
    const mesh = makeCarMesh(0xf2f2f2, true);
    this.scene.add(mesh.group);
    const car = {
      kind: 'police', ...mesh, x: p.x, z: p.z, heading: this.rng() * Math.PI * 2,
      speed: 0, gone: false, steerVis: 0, stuckT: 0, hitRadius: 2.6,
      callsign: this.nextCallsign(), mode: 'pursuit',
    };
    syncCarMesh(car);
    this.cars.push(car);
    return car;
  }

  spawnCopNear(playerPos) {
    const a = this.rng() * Math.PI * 2;
    const x = clamp(playerPos.x + Math.cos(a) * randRange(this.rng, 14, 22), -250, 250);
    const z = clamp(playerPos.z + Math.sin(a) * randRange(this.rng, 14, 22), -250, 318);
    const mesh = makeCopMesh();
    this.scene.add(mesh);
    const cop = {
      mesh, x, z, heading: 0, speed: 5.2, down: false, downT: 0,
      punchCooldown: 0, gone: false, hitRadius: 0.9, y: 1.2,
    };
    this.cops.push(cop);
    return cop;
  }

  update(dt, player, allCars) {
    const now = performance.now() / 1000;
    this.flashT += dt;
    const p = player.pos;
    // Wanted decays after a quiet spell with no police close by.
    if (this.wanted > 0 && now - this.lastCrimeAt > DECAY_QUIET_SECONDS) {
      const nearest = this.nearestPoliceDist(p);
      if (nearest > 45) {
        this.decayTimer += dt;
        if (this.decayTimer > 6) {
          this.wanted--;
          this.decayTimer = 0;
          if (this.onHeat) this.onHeat(this.wanted, 'cooling off');
        }
      } else this.decayTimer = 0;
    }
    // Keep the pursuit sized to the heat.
    const wantCars = this.wanted === 0 ? 0 : Math.min(this.wanted, 4);
    while (this.cars.length < wantCars) this.spawnCarNear(p);
    while (this.cars.length > wantCars) {
      const c = this.cars.pop();
      this.scene.remove(c.group);
    }
    const wantCops = !player.isDriving && this.wanted > 0 ? Math.min(this.wanted, 3) : 0;
    while (this.cops.filter((c) => !c.down).length < wantCops) this.spawnCopNear(p);
    // Chase cars: steer at the player, ram, flash the light bar.
    const flashOn = Math.floor(this.flashT * 4) % 2 === 0;
    for (const car of this.cars) {
      if (car.gone) continue;
      if (this.frozen) {
        // Staged shot: shadow the player at the staged offset (formation),
        // heading with the player — light bars still flash.
        if (car.stagedDx !== undefined) {
          car.x = p.x + car.stagedDx;
          car.z = p.z + car.stagedDz;
          car.heading = player.car ? player.car.heading : player.heading;
        }
        if (car.lightBar) {
          car.lightBar.userData.red.material.color.setHex(flashOn ? 0xff2020 : 0x550000);
          car.lightBar.userData.blue.material.color.setHex(flashOn ? 0x101050 : 0x2050ff);
        }
        syncCarMesh(car);
        continue;
      }
      const dx = p.x - car.x, dz = p.z - car.z;
      const dist = Math.hypot(dx, dz) || 1;
      // Roadblock: at 4+ stars one cruiser parks across the road ahead of
      // the player instead of chasing. It breaks off once the player closes in.
      if (this.wanted >= 4 && !car.roadblock && !this.cars.some((c) => c.roadblock)) {
        const ph = player.isDriving ? player.car.heading : player.heading;
        car.roadblock = {
          x: clamp(p.x + Math.sin(ph) * 42, -250, 250),
          z: clamp(p.z + Math.cos(ph) * 42, -250, 318),
        };
      }
      if (this.wanted < 4) car.roadblock = null;
      let parked = false;
      if (car.roadblock) {
        const rb = car.roadblock;
        const dRb = Math.hypot(rb.x - car.x, rb.z - car.z);
        const dPlayer = Math.hypot(rb.x - p.x, rb.z - p.z);
        if (dPlayer < 30) {
          car.roadblock = null;
        } else if (dRb < 7) {
          // Parked sideways across the road, lights flashing.
          const ph = player.isDriving ? player.car.heading : player.heading;
          car.heading = angleLerp(car.heading, ph + Math.PI / 2, Math.min(1, dt * 3));
          car.speed = Math.max(0, car.speed - 30 * dt);
          car.mode = 'roadblock';
          parked = true;
        } else {
          // Drive to the roadblock point.
          const wh = Math.atan2(rb.x - car.x, rb.z - car.z);
          car.heading = angleLerp(car.heading, wh, Math.min(1, dt * 2.2));
          car.speed += (26 - car.speed) * Math.min(1, dt * 1.2);
          const nx = car.x + Math.sin(car.heading) * car.speed * dt;
          const nz = car.z + Math.cos(car.heading) * car.speed * dt;
          const fixed = resolveCircleVsBuildings(nx, nz, 2.0, this.city.colliders);
          const moved = Math.hypot(fixed.x - car.x, fixed.z - car.z);
          if (moved < car.speed * dt * 0.25) car.stuckT += dt; else car.stuckT = 0;
          car.x = clamp(fixed.x, -250, 250);
          car.z = clamp(fixed.z, -250, 318);
          if (car.stuckT > 2.5) {
            const spot = this.city.randomRoadPoint(this.rng);
            car.x = spot.x; car.z = spot.z; car.stuckT = 0; car.speed = 8;
            car.roadblock = null;
          }
          car.mode = 'roadblock';
        }
      }
      if (!parked && !car.roadblock) {
        // Normal pursuit: steer at the player, close the gap, ram.
        const wantHeading = Math.atan2(dx, dz);
        car.heading = angleLerp(car.heading, wantHeading, Math.min(1, dt * 2.2));
        const targetSpeed = dist > 14 ? 30 : 24;
        car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 1.2);
        const nx = car.x + Math.sin(car.heading) * car.speed * dt;
        const nz = car.z + Math.cos(car.heading) * car.speed * dt;
        const fixed = resolveCircleVsBuildings(nx, nz, 2.0, this.city.colliders);
        const moved = Math.hypot(fixed.x - car.x, fixed.z - car.z);
        if (moved < car.speed * dt * 0.25) car.stuckT += dt; else car.stuckT = 0;
        car.x = clamp(fixed.x, -250, 250);
        car.z = clamp(fixed.z, -250, 318);
        if (car.stuckT > 2.5) {
          // Wedged on a building: pull the cruiser back to a road near the player.
          const spot = this.city.randomRoadPoint(this.rng);
          car.x = spot.x; car.z = spot.z; car.stuckT = 0; car.speed = 8;
        }
        car.mode = dist < 4.6 && player.isDriving ? 'ramming' : 'pursuit';
      }
      // Ram the player's car / run the player down on foot.
      if (dist < 4.6) {
        if (player.isDriving) {
          const pc = player.car;
          pc.speed *= 0.82;
          if (car.speed > 10) {
            player.takeDamage(6);
            if (this.onCrash) this.onCrash();
          }
          // Boxed in while slow: the bust meter climbs.
          if (Math.abs(pc.speed) < 3) this.bustMeter += dt;
        } else if (dist < 2.2) {
          this.bustMeter += dt * 1.4;
        }
      }
      if (car.lightBar) {
        car.lightBar.userData.red.material.color.setHex(flashOn ? 0xff2020 : 0x550000);
        car.lightBar.userData.blue.material.color.setHex(flashOn ? 0x101050 : 0x2050ff);
      }
      syncCarMesh(car);
    }
    // Police helicopter: joins the chase at 2+ stars, circles the player.
    if (this.wanted >= 2 && !this.heli) this.spawnHeli();
    if (this.wanted < 2 && this.heli) this.removeHeli();
    if (this.heli) {
      const h = this.heli;
      if (!this.frozen) h.angle += dt * this.heliSpin;
      const t = performance.now() / 1000;
      h.group.position.set(
        p.x + Math.cos(h.angle) * this.heliOrbitR,
        this.heliOrbitY + Math.sin(t * 0.7) * 2,
        p.z + Math.sin(h.angle) * this.heliOrbitR
      );
      h.group.rotation.y = Math.atan2(p.x - h.group.position.x, p.z - h.group.position.z);
      h.group.userData.rotor.rotation.y += dt * 22;
      h.group.userData.tailRotor.rotation.x += dt * 30;
      h.group.userData.red.material.color.setHex(flashOn ? 0xff2020 : 0x550000);
      h.group.userData.blue.material.color.setHex(flashOn ? 0x101050 : 0x2050ff);
    }
    // Foot cops: run the player down, punch, and hold them for the bust.
    for (const cop of this.cops) {
      if (cop.gone) continue;
      if (cop.down) {
        cop.downT += dt;
        if (cop.downT > 8) {
          this.scene.remove(cop.mesh);
          cop.gone = true;
        }
        continue;
      }
      cop.punchCooldown = Math.max(0, cop.punchCooldown - dt);
      const d = dist2d(cop.x, cop.z, p.x, p.z);
      if (player.isDriving || d > 90) {
        // Too far or the player is in a car: cops give up and melt away.
        if (d > 90) {
          this.scene.remove(cop.mesh);
          cop.gone = true;
          continue;
        }
      }
      const wantHeading = Math.atan2(p.x - cop.x, p.z - cop.z);
      cop.heading = angleLerp(cop.heading, wantHeading, Math.min(1, dt * 8));
      if (d > 1.6) {
        cop.x += Math.sin(cop.heading) * cop.speed * dt;
        cop.z += Math.cos(cop.heading) * cop.speed * dt;
        const fixed = resolveCircleVsBuildings(cop.x, cop.z, 0.5, this.city.colliders);
        cop.x = fixed.x; cop.z = fixed.z;
      } else if (!player.isDriving) {
        this.bustMeter += dt;
        if (cop.punchCooldown <= 0) {
          cop.punchCooldown = 0.9;
          player.takeDamage(7);
          if (this.onPunch) this.onPunch();
        }
      }
      const swing = Math.sin(performance.now() * 0.014) * 0.55;
      cop.mesh.userData.legL.rotation.x = swing;
      cop.mesh.userData.legR.rotation.x = -swing;
      cop.mesh.position.set(cop.x, 0, cop.z);
      cop.mesh.rotation.y = cop.heading;
    }
    this.cops = this.cops.filter((c) => !c.gone);
    this.cars = this.cars.filter((c) => !c.gone);
    // Bust meter decays when the heat backs off; full means caught.
    if (this.bustMeter > 0) {
      const inContact = this.cops.some((c) => !c.down && dist2d(c.x, c.z, p.x, p.z) < 2.2)
        || this.cars.some((c) => dist2d(c.x, c.z, p.x, p.z) < 4.6);
      if (!inContact) this.bustMeter = Math.max(0, this.bustMeter - dt * 0.5);
    }
    if (this.bustMeter >= 2) {
      this.bustMeter = 0;
      this.onCaught();
    }
    void allCars;
  }

  nearestPoliceDist(p) {
    let best = Infinity;
    for (const c of this.cars) best = Math.min(best, dist2d(c.x, c.z, p.x, p.z));
    for (const c of this.cops) if (!c.down) best = Math.min(best, dist2d(c.x, c.z, p.x, p.z));
    return best;
  }
}
