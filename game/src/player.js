// player.js — Mara Voss on foot: run, punch, shoot, steal cars.
// Driving physics live in vehicles.js; this file owns the person.

import * as THREE from 'three';
import { clamp, angleLerp, dist2d } from './utils.js';
import { resolveCircleVsBuildings } from './city.js';
import { syncCarMesh } from './vehicles.js';

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.x = 0; this.z = 40;
    this.heading = Math.PI; // facing north, up the avenue
    this.speed = 0;
    this.health = 100;
    this.money = 0;
    this.ammo = 12; // magazine
    this.reserve = Infinity;
    this.car = null; // the car currently driven, or null
    this.punchCooldown = 0;
    this.shootCooldown = 0;
    this.reloadTimer = 0;
    this.invulnerable = 0;
    this.mesh = this.buildMesh();
    scene.add(this.mesh);
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe27a })
    );
    this.flash.visible = false;
    scene.add(this.flash);
  }

  buildMesh() {
    const g = new THREE.Group();
    const jacket = new THREE.MeshLambertMaterial({ color: 0xc22e2e });
    const jeans = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xe0ac69 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.0, 8), jacket);
    torso.position.y = 1.0;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin);
    head.position.y = 1.78;
    g.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    hair.position.set(0, 1.86, -0.06);
    hair.scale.set(1, 0.7, 1);
    g.add(hair);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), jeans);
    legL.position.set(-0.15, 0.28, 0);
    const legR = legL.clone();
    legR.position.x = 0.15;
    g.add(legL, legR);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), jacket);
    armL.position.set(-0.48, 1.05, 0);
    const armR = armL.clone();
    armR.position.x = 0.48;
    g.add(armL, armR);
    g.userData = { legL, legR, armR };
    return g;
  }

  get pos() { return this.car ? { x: this.car.x, z: this.car.z } : { x: this.x, z: this.z }; }
  get isDriving() { return this.car !== null; }

  takeDamage(amount) {
    if (this.invulnerable > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = 0.4;
  }

  /** Try to enter the nearest car within 4.5m. Returns the car or null. */
  tryEnterCar(cars) {
    let best = null, bd = 4.5;
    for (const c of cars) {
      if (c.gone) continue;
      const d = dist2d(this.x, this.z, c.x, c.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    this.car = best;
    best.kind = best.kind === 'parked' ? 'player-parked' : best.kind;
    this.mesh.visible = false;
    return best;
  }

  exitCar() {
    if (!this.car) return;
    const side = this.car.heading + Math.PI / 2;
    this.x = this.car.x + Math.sin(side) * 2.6;
    this.z = this.car.z + Math.cos(side) * 2.6;
    this.heading = this.car.heading;
    this.car.speed = 0;
    this.car = null;
    this.mesh.visible = true;
  }

  /** Punch: hits a ped or cop standing in front of Mara. Returns the victim or null. */
  punch(targets) {
    if (this.punchCooldown > 0 || this.car) return null;
    this.punchCooldown = 0.45;
    const px = this.x + Math.sin(this.heading) * 1.2;
    const pz = this.z + Math.cos(this.heading) * 1.2;
    for (const t of targets) {
      if (t.down || t.gone) continue;
      if (dist2d(px, pz, t.x, t.z) < 1.6) return t;
    }
    return null;
  }

  /** Shoot along the camera ray. Returns {kind, target, point} or null. */
  shoot(camera, targets) {
    if (this.shootCooldown > 0 || this.reloadTimer > 0 || this.car) return null;
    if (this.ammo <= 0) {
      this.reload();
      return { kind: 'dry', target: null, point: null };
    }
    this.shootCooldown = 0.22;
    this.ammo--;
    // Muzzle flash at Mara's right hand.
    const hand = new THREE.Vector3(0.55, 1.35, 0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    this.flash.position.set(this.x + hand.x, hand.y, this.z + hand.z);
    this.flash.visible = true;
    window.setTimeout(() => { this.flash.visible = false; }, 60);
    // Ray from the camera through the crosshair.
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    let best = null, bestT = 70;
    for (const t of targets) {
      if (t.down || t.gone) continue;
      const cx = t.x, cz = t.z, cy = t.y || 1.2;
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const along = ox * dir.x + oy * dir.y + oz * dir.z;
      if (along < 0 || along > bestT) continue;
      const px = origin.x + dir.x * along, py = origin.y + dir.y * along, pz = origin.z + dir.z * along;
      const miss = Math.hypot(px - cx, py - cy, pz - cz);
      const radius = t.hitRadius || 0.9;
      if (miss < radius) { best = t; bestT = along; }
    }
    if (best) return { kind: 'hit', target: best, point: { x: best.x, z: best.z } };
    return { kind: 'miss', target: null, point: null };
  }

  reload() {
    if (this.reloadTimer > 0 || this.ammo === 12) return;
    this.reloadTimer = 0.9;
  }

  update(dt, input, camYaw, city, cars, onCrime) {
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.ammo = 12;
    }
    if (this.car) return; // driving is handled by vehicles.updatePlayerCar
    // Move relative to the camera yaw.
    const fwd = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const run = input.run ? 1.75 : 1;
    const mx = Math.sin(camYaw) * fwd + Math.cos(camYaw) * strafe;
    const mz = Math.cos(camYaw) * fwd - Math.sin(camYaw) * strafe;
    const moving = fwd !== 0 || strafe !== 0;
    const targetSpeed = moving ? 4.4 * run : 0;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 10);
    if (moving) {
      const len = Math.hypot(mx, mz) || 1;
      const wantHeading = Math.atan2(mx / len, mz / len);
      this.heading = angleLerp(this.heading, wantHeading, Math.min(1, dt * 12));
      const nx = this.x + Math.sin(this.heading) * this.speed * dt;
      const nz = this.z + Math.cos(this.heading) * this.speed * dt;
      const fixed = resolveCircleVsBuildings(nx, nz, 0.6, city.colliders);
      // Soft push out of cars.
      let px = fixed.x, pz = fixed.z;
      for (const c of cars) {
        if (c.gone) continue;
        const d = dist2d(px, pz, c.x, c.z);
        if (d < 2.6 && d > 0.01) {
          px = c.x + ((px - c.x) / d) * 2.6;
          pz = c.z + ((pz - c.z) / d) * 2.6;
        }
      }
      this.x = clamp(px, -250, 250);
      this.z = clamp(pz, -250, 318);
    }
    // Walk-cycle swing.
    const swing = Math.sin(performance.now() * 0.012 * Math.max(1, this.speed)) * clamp(this.speed / 4, 0, 1) * 0.6;
    this.mesh.userData.legL.rotation.x = swing;
    this.mesh.userData.legR.rotation.x = -swing;
    this.mesh.userData.armR.rotation.x = this.shootCooldown > 0.1 ? -1.3 : 0;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    // Slow health regen out of trouble.
    if (this.health > 0 && this.health < 100) this.health = Math.min(100, this.health + dt * 1.5);
    void onCrime;
  }
}
