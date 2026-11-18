// missions.js — Mara's three jobs: the pickup, the hot wheels, the heat.
// Each mission is stages with a glowing marker; finishing one pays cash,
// saves progress, and unlocks the next.

import * as THREE from 'three';
import { dist2d, randRange } from './utils.js';
import { makeCarMesh, syncCarMesh } from './vehicles.js';

function makeMarker() {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 30, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd60a, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  beam.position.y = 15;
  group.add(beam);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xffd60a })
  );
  gem.position.y = 5;
  group.add(gem);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.1, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  group.userData = { gem, beam };
  return group;
}

export class MissionSystem {
  constructor(scene, city, rng, callbacks) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.cb = callbacks; // { onToast, onReward, onComplete, onFail, onHeat, onClearHeat }
    this.completed = new Set();
    this.current = null; // { def, stageIndex, stage, timer }
    this.marker = makeMarker();
    this.marker.visible = false;
    scene.add(this.marker);
    this.specialCar = null;
    // Fixed story spots, spread across the map so every mission is a drive.
    this.spots = {
      docks: { x: 112, z: 236 },
      safehouse: { x: -168, z: -168 },
      chopShop: { x: 224, z: -112 },
      hideout: { x: -224, z: 168 },
      goldCar: { x: -56, z: 56 },
    };
    this.defs = [
      {
        id: 0, title: 'JOB 1 — THE PICKUP', reward: 1500,
        brief: 'A package is waiting at the docks. Collect it and bring it to the safehouse. No trouble, no heat.',
        stages: [
          { text: 'Drive to the DOCKS and collect the package', target: this.spots.docks, radius: 6 },
          { text: 'Package collected! Deliver it to the SAFEHOUSE', target: this.spots.safehouse, radius: 6 },
        ],
      },
      {
        id: 1, title: 'JOB 2 — HOT WHEELS', reward: 3000,
        brief: 'A gold Aurora GT is parked uptown. Steal it and deliver it to the chop shop. The owner will call the cops — expect heat.',
        stages: [
          { text: 'Steal the GOLD AURORA GT parked uptown', target: this.spots.goldCar, radius: 5, needsCar: true },
          { text: 'Deliver the Aurora to the CHOP SHOP — lose the cops if you can', target: this.spots.chopShop, radius: 6 },
        ],
      },
      {
        id: 2, title: 'JOB 3 — THE HEAT IS ON', reward: 5000,
        brief: 'The whole Solmar PD is on you — 3 stars. Reach the hideout across town before they box you in. Survive.',
        stages: [
          { text: '3 STARS! Reach the HIDEOUT before the PD boxes you in', target: this.spots.hideout, radius: 7, timer: 150 },
        ],
      },
    ];
  }

  get active() { return this.current !== null; }
  get objectiveText() {
    if (this.current) return this.current.stage.text;
    if (this.completed.size >= 3) return 'All jobs done — Solmar is yours. Free roam, Mara.';
    const next = this.defs.find((d) => !this.completed.has(d.id));
    return next ? `Next job available: ${next.title} — press PLAY from the menu, or keep cruising.` : 'Free roam.';
  }
  get target() { return this.current ? this.current.stage.target : null; }

  startMission(id) {
    const def = this.defs[id];
    if (!def || this.completed.has(id) || this.current) return false;
    if (id === 1) this.spawnGoldCar();
    if (id === 2 && this.cb.onHeat) this.cb.onHeat(3, 'the whole PD is on you');
    this.current = { def, stageIndex: 0, stage: def.stages[0], timer: def.stages[0].timer || 0 };
    this.marker.visible = true;
    this.marker.position.set(this.current.stage.target.x, 0, this.current.stage.target.z);
    if (this.cb.onToast) this.cb.onToast(`${def.title} — ${def.brief}`);
    return true;
  }

  spawnGoldCar() {
    if (this.specialCar) return;
    const mesh = makeCarMesh(0xffd700);
    this.scene.add(mesh.group);
    const car = {
      kind: 'parked', ...mesh, x: this.spots.goldCar.x, z: this.spots.goldCar.z,
      heading: Math.PI / 2, speed: 0, gone: false, steerVis: 0, gold: true,
    };
    syncCarMesh(car);
    this.specialCar = car;
    if (this.cb.onSpecialCar) this.cb.onSpecialCar(car);
  }

  advanceStage() {
    const cur = this.current;
    if (cur.stageIndex + 1 < cur.def.stages.length) {
      cur.stageIndex++;
      cur.stage = cur.def.stages[cur.stageIndex];
      cur.timer = cur.stage.timer || 0;
      this.marker.position.set(cur.stage.target.x, 0, cur.stage.target.z);
      if (this.cb.onToast) this.cb.onToast(cur.stage.text);
      if (cur.def.id === 1 && cur.stageIndex === 1 && this.cb.onHeat) {
        this.cb.onHeat(2, 'the owner called the cops');
      }
      return;
    }
    this.completeMission();
  }

  completeMission() {
    const cur = this.current;
    this.completed.add(cur.def.id);
    this.current = null;
    this.marker.visible = false;
    if (this.cb.onReward) this.cb.onReward(cur.def.reward, cur.def.title);
    if (this.cb.onComplete) this.cb.onComplete(cur.def.id);
  }

  failMission(reason) {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.marker.visible = false;
    if (this.cb.onFail) this.cb.onFail(`${cur.def.title} FAILED — ${reason}`);
  }

  update(dt, player) {
    // Marker spin + pulse, and a slow bob for the gem.
    if (this.marker.visible) {
      const t = performance.now() / 1000;
      this.marker.userData.gem.rotation.y = t * 1.6;
      this.marker.userData.gem.position.y = 5 + Math.sin(t * 2) * 0.6;
      this.marker.userData.beam.material.opacity = 0.22 + Math.sin(t * 3) * 0.08;
    }
    if (!this.current) return;
    const cur = this.current;
    if (cur.timer > 0) {
      cur.timer -= dt;
      if (cur.timer <= 0) {
        this.failMission('time ran out');
        return;
      }
    }
    const p = player.pos;
    const t = cur.stage.target;
    if (cur.stage.needsCar) {
      // Stage 1 of job 2 only counts in the gold Aurora itself: arriving in
      // any other car, or on foot, does not advance the job.
      if (!player.isDriving) return;
      if (player.car && player.car.gold) {
        if (this.cb.onToast) this.cb.onToast('The Aurora is yours — GO!');
        this.advanceStage();
      }
      return;
    }
    const arrived = dist2d(p.x, p.z, t.x, t.z) < cur.stage.radius;
    if (arrived) {
      if (cur.stageIndex === 0 && cur.def.id === 0 && this.cb.onToast) {
        this.cb.onToast('Package secured.');
      }
      this.advanceStage();
    }
  }
}
