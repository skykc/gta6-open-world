// collectibles.js — Solmar stashes: 8 hidden cash packages across the city.
// Walk or drive over one to bank $250 and gain RESPECT. They glow gold and
// spin, so a sharp-eyed driver spots them from the road.

import * as THREE from 'three';
import { dist2d } from './utils.js';

const STASH_SPOTS = [
  { x: -224, z: 250 }, // beach, west end
  { x: 200, z: 252 }, // beach, east end
  { x: 112, z: 236 }, // the docks
  { x: -168, z: -168 }, // safehouse corner
  { x: 224, z: -112 }, // chop shop corner
  { x: -56, z: 112 }, // marina plaza
  { x: 168, z: 56 }, // downtown east
  { x: -112, z: -224 }, // uptown, north edge
];

export class StashSystem {
  constructor(scene, callbacks) {
    this.scene = scene;
    this.cb = callbacks; // { onCollect, onSmg }
    this.stashes = [];
    this.found = 0;
    // The SMG crate: a dark weapons case downtown, red ring. One pickup,
    // then the slot 3 SMG is unlocked for good.
    const smgGroup = new THREE.Group();
    const smgBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.5, 0.7),
      new THREE.MeshLambertMaterial({ color: 0x222831 })
    );
    smgBox.position.y = 0.35;
    smgGroup.add(smgBox);
    const smgGun = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 1.1),
      new THREE.MeshLambertMaterial({ color: 0x111111 })
    );
    smgGun.position.y = 0.75;
    smgGroup.add(smgGun);
    const smgRing = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.8, 24),
      new THREE.MeshBasicMaterial({ color: 0xff2a22, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    smgRing.rotation.x = -Math.PI / 2;
    smgRing.position.y = 0.12;
    smgGroup.add(smgRing);
    smgGroup.position.set(56, 0, -56);
    scene.add(smgGroup);
    this.smg = { x: 56, z: -56, group: smgGroup, ring: smgRing, taken: false };
    for (const s of STASH_SPOTS) {
      const group = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.7, 0.8),
        new THREE.MeshLambertMaterial({ color: 0xffd60a })
      );
      box.position.y = 0.45;
      group.add(box);
      const lid = new THREE.Mesh(
        new THREE.BoxGeometry(1.14, 0.16, 0.84),
        new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
      );
      lid.position.y = 0.85;
      group.add(lid);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.4, 1.8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.12;
      group.add(ring);
      group.position.set(s.x, 0, s.z);
      scene.add(group);
      this.stashes.push({ ...s, group, ring, found: false });
    }
  }

  update(dt, playerPos) {
    const t = performance.now() / 1000;
    if (!this.smg.taken) {
      this.smg.ring.material.opacity = 0.5 + Math.sin(t * 3) * 0.25;
      this.smg.group.rotation.y = t * 0.6;
      if (dist2d(playerPos.x, playerPos.z, this.smg.x, this.smg.z) < 3.5) {
        this.smg.taken = true;
        this.scene.remove(this.smg.group);
        if (this.cb.onSmg) this.cb.onSmg();
      }
    }
    for (const s of this.stashes) {
      if (s.found) continue;
      s.ring.material.opacity = 0.5 + Math.sin(t * 3) * 0.25;
      s.group.rotation.y = t * 0.8;
      if (dist2d(playerPos.x, playerPos.z, s.x, s.z) < 3.5) {
        s.found = true;
        this.found++;
        this.scene.remove(s.group);
        if (this.cb.onCollect) this.cb.onCollect(s, this.found);
      }
    }
  }
}
