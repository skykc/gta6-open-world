// pedestrians.js — Solmar's sidewalk crowd: they stroll, cross at corners,
// and run for their lives when a car screams past or a gun goes off.

import * as THREE from 'three';
import { clamp, randRange, pick, dist2d } from './utils.js';
import { resolveCircleVsBuildings, STREETS } from './city.js';

const SHIRT_COLORS = [0xe84c3d, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xecf0f1, 0xe67e22, 0x1abc9c];
const SKIN_COLORS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];

function makePedMesh(shirt, skin) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.4, 1.05, 8),
    new THREE.MeshLambertMaterial({ color: shirt })
  );
  body.position.y = 0.95;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 8),
    new THREE.MeshLambertMaterial({ color: skin })
  );
  head.position.y = 1.72;
  g.add(head);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), legMat);
  legL.position.set(-0.14, 0.25, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legL, legR);
  g.userData = { legL, legR };
  return g;
}

export class PedSystem {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.peds = [];
    this.maxPeds = 26;
    this.scare = null; // {x, z, t} — a recent gunshot / near-miss cars flee from
  }

  spawnOne(near) {
    // Peds live on sidewalks: 8.5m off a street centre line.
    const street = pick(this.rng, STREETS);
    const along = randRange(this.rng, -224, 224);
    const side = this.rng() < 0.5 ? 8.5 : -8.5;
    const x = this.rng() < 0.5 ? street + side : along;
    const z = this.rng() < 0.5 ? along : street + side;
    const mesh = makePedMesh(pick(this.rng, SHIRT_COLORS), pick(this.rng, SKIN_COLORS));
    this.scene.add(mesh);
    const ped = {
      mesh, x, z, heading: this.rng() * Math.PI * 2,
      speed: randRange(this.rng, 1.1, 1.9),
      target: null, fleeing: false, gone: false, walkPhase: this.rng() * 6,
      down: false,
    };
    this.peds.push(ped);
    return ped;
  }

  scareAt(x, z) { this.scare = { x, z, t: 0 }; }

  update(dt, playerPos, playerCar) {
    while (this.peds.length < this.maxPeds) this.spawnOne(playerPos);
    if (this.scare) {
      this.scare.t += dt;
      if (this.scare.t > 6) this.scare = null;
    }
    for (const ped of this.peds) {
      if (ped.gone) continue;
      if (ped.down) {
        ped.mesh.rotation.x = -Math.PI / 2;
        ped.mesh.position.y = 0.3;
        continue;
      }
      // Flee from a scare point, or from a fast car bearing down on them.
      let flee = null;
      if (this.scare && dist2d(ped.x, ped.z, this.scare.x, this.scare.z) < 26) flee = this.scare;
      if (playerCar && Math.abs(playerCar.speed) > 10 && dist2d(ped.x, ped.z, playerCar.x, playerCar.z) < 12) {
        flee = { x: playerCar.x, z: playerCar.z };
      }
      if (flee) {
        const away = Math.atan2(ped.x - flee.x, ped.z - flee.z);
        ped.heading = away;
        ped.speed = 4.2;
        ped.fleeing = true;
      } else if (ped.fleeing) {
        ped.fleeing = false;
        ped.speed = randRange(this.rng, 1.1, 1.9);
      }
      // Wander: pick a nearby sidewalk point, walk to it, pick another.
      if (!ped.target || dist2d(ped.x, ped.z, ped.target.x, ped.target.z) < 2) {
        const street = pick(this.rng, STREETS);
        const along = clamp(ped.z + randRange(this.rng, -60, 60), -224, 224);
        ped.target = this.rng() < 0.5
          ? { x: street + (this.rng() < 0.5 ? 8.5 : -8.5), z: along }
          : { x: clamp(ped.x + randRange(this.rng, -60, 60), -224, 224), z: street + (this.rng() < 0.5 ? 8.5 : -8.5) };
      }
      if (!ped.fleeing) {
        const want = Math.atan2(ped.target.x - ped.x, ped.target.z - ped.z);
        let d = want - ped.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        ped.heading += clamp(d, -2.4 * dt, 2.4 * dt);
      }
      const nx = ped.x + Math.sin(ped.heading) * ped.speed * dt;
      const nz = ped.z + Math.cos(ped.heading) * ped.speed * dt;
      const fixed = resolveCircleVsBuildings(nx, nz, 0.5, this.city.colliders);
      ped.x = clamp(fixed.x, -250, 250);
      ped.z = clamp(fixed.z, -250, 318);
      ped.walkPhase += dt * ped.speed * 4;
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.rotation.y = ped.heading;
      const swing = Math.sin(ped.walkPhase) * 0.5;
      ped.mesh.userData.legL.rotation.x = swing;
      ped.mesh.userData.legR.rotation.x = -swing;
      // Recycle peds far from the player.
      if (playerPos && dist2d(ped.x, ped.z, playerPos.x, playerPos.z) > 180) {
        this.scene.remove(ped.mesh);
        ped.gone = true;
      }
    }
    this.peds = this.peds.filter((p) => !p.gone);
  }

  /** Knock a ped down (hit by a car / shot). Returns true if it was standing. */
  knockDownAt(x, z, radius = 2.4) {
    let hit = false;
    for (const ped of this.peds) {
      if (!ped.down && dist2d(ped.x, ped.z, x, z) < radius) {
        ped.down = true;
        ped.mesh.rotation.x = -Math.PI / 2;
        ped.mesh.position.y = 0.3;
        hit = true;
      }
    }
    return hit;
  }
}
