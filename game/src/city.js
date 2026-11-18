// city.js — builds Solmar Bay: a 9x9 street grid, tower blocks, plazas,
// a beach strip on the south edge, street props and the road graph that
// traffic, police and missions all drive on. Deterministic from one seed.

import * as THREE from 'three';
import { mulberry32, clamp, randRange, pick, canvasTexture } from './utils.js';

export const PITCH = 56; // block (44) + road (12)
export const ROAD_HALF = 6;
export const STREETS = [-224, -168, -112, -56, 0, 56, 112, 168, 224];
export const CITY_BOUND = 252;

/** Push a circle (x, z, radius) out of every building AABB it overlaps. */
export function resolveCircleVsBuildings(x, z, r, colliders) {
  for (const c of colliders) {
    const cx = clamp(x, c.minX, c.maxX);
    const cz = clamp(z, c.minZ, c.maxZ);
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Dead-centre overlap: push along the smallest penetration axis.
        const pushL = x - (c.minX - r), pushR = (c.maxX + r) - x;
        const pushT = z - (c.minZ - r), pushB = (c.maxZ + r) - z;
        const m = Math.min(pushL, pushR, pushT, pushB);
        if (m === pushL) x = c.minX - r;
        else if (m === pushR) x = c.maxX + r;
        else if (m === pushT) z = c.minZ - r;
        else z = c.maxZ + r;
      }
    }
  }
  return { x, z };
}

function facadeTexture(THREE, rng, base, litRatio) {
  // A building face: warm concrete + a grid of windows, some lit gold.
  return canvasTexture(THREE, 128, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 0, w, 10);
    const cols = 6, rows = 14;
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = rng() < litRatio;
        g.fillStyle = lit ? '#ffd97a' : (rng() < 0.5 ? '#1d2f45' : '#27405e');
        g.fillRect(c * cw + 3, r * ch + 4, cw - 6, ch - 8);
      }
    }
  });
}

function roadTexture(THREE) {
  // Asphalt with a dashed centre line, repeated along the strip.
  return canvasTexture(THREE, 64, 256, (g, w, h) => {
    g.fillStyle = '#3a3f47';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f5c542';
    g.fillRect(w / 2 - 2, 20, 4, 60);
    g.fillRect(w / 2 - 2, 148, 4, 60);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, 0, w, 6);
    g.fillRect(0, h - 6, w, 6);
  }, 1, 8);
}

function skyTexture(THREE) {
  // Vertical sunset gradient: magenta dusk up top, hot orange, gold at the horizon.
  return canvasTexture(THREE, 16, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#7a2d5e');
    grad.addColorStop(0.35, '#c65a7d');
    grad.addColorStop(0.62, '#ff8a5c');
    grad.addColorStop(0.82, '#ffb36b');
    grad.addColorStop(1, '#ffd27a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

function billboardTexture(THREE, title, sub, color) {
  // Neon sign face: dark navy, glowing border + big bold letters.
  return canvasTexture(THREE, 512, 224, (g, w, h) => {
    g.fillStyle = '#14092b';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 8;
    g.shadowColor = color;
    g.shadowBlur = 22;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.shadowBlur = 26;
    g.fillStyle = color;
    g.font = '900 84px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, w / 2, h / 2 - 22);
    g.shadowBlur = 12;
    g.fillStyle = '#ffffff';
    g.font = 'bold 34px Arial, sans-serif';
    g.fillText(sub, w / 2, h / 2 + 62);
  });
}

export function buildCity(scene, seed) {
  const rng = mulberry32(seed);
  const colliders = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.BoxGeometry(1, 1, 1);

  // ---- sky, light, fog: a hot Solmar sunset — pink sky, low gold sun.
  scene.background = skyTexture(THREE);
  scene.fog = new THREE.Fog(0xf2a35e, 150, 560);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.6);
  sun.position.set(140, 70, -260);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffd9b0, 0.7));
  const hemi = new THREE.HemisphereLight(0xff9e7d, 0x5a4a3a, 0.6);
  scene.add(hemi);
  // Low sun disc dead ahead of the main avenue (north), so the chase shot
  // drives straight into the sunset.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(36, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false })
  );
  sunDisc.position.set(0, 48, -330);
  sunDisc.lookAt(0, 30, 0);
  scene.add(sunDisc);
  // A warm halo around the sun.
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(70, 24),
    new THREE.MeshBasicMaterial({ color: 0xff9e5e, transparent: true, opacity: 0.35, fog: false })
  );
  halo.position.set(0, 48, -332);
  halo.lookAt(0, 30, 0);
  scene.add(halo);
  // Warm fill from the south so the shadow side of cars (facing the chase
  // camera) is never black.
  const fill = new THREE.DirectionalLight(0xff9e7d, 0.9);
  fill.position.set(0, 100, 300);
  scene.add(fill);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffc9b8, transparent: true, opacity: 0.8, fog: false });
  for (let i = 0; i < 9; i++) {
    const cloud = new THREE.Mesh(new THREE.PlaneGeometry(randRange(rng, 60, 130), randRange(rng, 14, 26)), cloudMat);
    cloud.position.set(randRange(rng, -320, 320), randRange(rng, 120, 190), randRange(rng, -320, 120));
    cloud.lookAt(0, cloud.position.y, 0);
    scene.add(cloud);
  }

  // ---- ground: concrete base, roads, sidewalks, beach + sea.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshLambertMaterial({ color: 0xa89a80 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  const roadTex = roadTexture(THREE);
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  const sideMat = new THREE.MeshLambertMaterial({ color: 0xb9b3a4 });
  for (const s of STREETS) {
    // Vertical + horizontal road strips with dashed centres.
    const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(12, 520), roadMat);
    vRoad.rotation.x = -Math.PI / 2;
    vRoad.position.set(s, 0, 0);
    scene.add(vRoad);
    const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(520, 12), roadMat.clone());
    hRoad.rotation.x = -Math.PI / 2;
    hRoad.rotation.z = Math.PI / 2;
    hRoad.position.set(0, 0.01, s);
    scene.add(hRoad);
    // Sidewalk ribbons flanking each street.
    for (const off of [-8.5, 8.5]) {
      const vWalk = new THREE.Mesh(new THREE.PlaneGeometry(5, 520), sideMat);
      vWalk.rotation.x = -Math.PI / 2;
      vWalk.position.set(s + off, 0.02, 0);
      scene.add(vWalk);
      const hWalk = new THREE.Mesh(new THREE.PlaneGeometry(520, 5), sideMat);
      hWalk.rotation.x = -Math.PI / 2;
      hWalk.position.set(0, 0.03, s + off);
      scene.add(hWalk);
    }
  }
  // Beach sand + sea on the south edge (z beyond the last street).
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 60),
    new THREE.MeshLambertMaterial({ color: 0xe8c98a })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.04, 282);
  scene.add(sand);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 260),
    new THREE.MeshLambertMaterial({ color: 0x2a6f9e })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.02, 440);
  scene.add(sea);

  // ---- buildings: one or two towers per block, plazas where the dice say so.
  const bases = ['#c9a184', '#b7c4cc', '#d8c49a', '#a8b8a0', '#c4a3b2', '#9fb2c8'];
  const facades = bases.map((b) => facadeTexture(THREE, mulberry32(seed + b.length * 977), b, 0.16));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a5f66 });
  let buildingCount = 0;
  for (let bx = 0; bx < 8; bx++) {
    for (let bz = 0; bz < 8; bz++) {
      const cx = STREETS[bx] + PITCH / 2;
      const cz = STREETS[bz] + PITCH / 2;
      const roll = rng();
      if (roll < 0.1) {
        // Plaza: green square + trees instead of towers.
        const lawn = new THREE.Mesh(
          new THREE.PlaneGeometry(44, 44),
          new THREE.MeshLambertMaterial({ color: 0x6fae5f })
        );
        lawn.rotation.x = -Math.PI / 2;
        lawn.position.set(cx, 0.05, cz);
        scene.add(lawn);
        for (let t = 0; t < 5; t++) plantTree(scene, cx + randRange(rng, -16, 16), cz + randRange(rng, -16, 16));
        continue;
      }
      const twins = roll < 0.45;
      const spots = twins
        ? [{ dx: -11, dz: 0, w: 20, d: 34 }, { dx: 11, dz: 0, w: 20, d: 34 }]
        : [{ dx: 0, dz: 0, w: 34, d: 34 }];
      for (const s of spots) {
        const h = randRange(rng, 10, 58) * (twins ? 0.8 : 1);
        const mat = new THREE.MeshLambertMaterial({ map: pick(rng, facades) });
        const b = new THREE.Mesh(boxGeo, mat);
        b.scale.set(s.w, h, s.d);
        b.position.set(cx + s.dx, h / 2, cz + s.dz);
        scene.add(b);
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.scale.set(s.w * 0.92, 1.2, s.d * 0.92);
        roof.position.set(cx + s.dx, h + 0.6, cz + s.dz);
        scene.add(roof);
        if (rng() < 0.35) {
          const antenna = new THREE.Mesh(
            new THREE.CylinderGeometry(0.25, 0.25, randRange(rng, 6, 14), 6),
            roofMat
          );
          antenna.position.set(cx + s.dx, h + 6, cz + s.dz);
          scene.add(antenna);
        }
        colliders.push({
          minX: cx + s.dx - s.w / 2, maxX: cx + s.dx + s.w / 2,
          minZ: cz + s.dz - s.d / 2, maxZ: cz + s.dz + s.d / 2,
        });
        buildingCount++;
      }
    }
  }

  // ---- street props: palms along every avenue, a lush row on the sand,
  // lamps at corners, and neon billboards over the main roads.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const palmMat = new THREE.MeshLambertMaterial({ color: 0x2f8f3e });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const s of STREETS) {
    for (let k = -3; k <= 3; k++) {
      if (k % 2 === 0) continue;
      plantPalm(scene, s + 10.5, k * 56 + 28, trunkMat, palmMat);
      plantPalm(scene, s - 10.5, k * 56, trunkMat, palmMat);
    }
  }
  // Extra palm row on the sand, facing the beach road.
  for (let x = -240; x <= 240; x += 24) plantPalm(scene, x, 258, trunkMat, palmMat);
  // Neon billboards: SOLMAR over the main avenue (seen driving north),
  // AURORA GT over the cross avenue, SOLMAR BAY along the beach road.
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2a2f36 });
  const addBillboard = (x, z, rotY, title, sub, color) => {
    const tex = billboardTexture(THREE, title, sub, color);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 11.4),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    face.position.set(x, 11, z);
    face.rotation.y = rotY;
    scene.add(face);
    // Two posts hold the sign up; cars pass underneath the face (bottom at ~6.8).
    const off = { x: Math.cos(rotY) * 11, z: -Math.sin(rotY) * 11 };
    for (const s of [-1, 1]) {
      const px = x + off.x * s, pz = z + off.z * s;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7, 6), postMat);
      post.position.set(px, 3.5, pz);
      scene.add(post);
      colliders.push({ minX: px - 0.5, maxX: px + 0.5, minZ: pz - 0.5, maxZ: pz + 0.5 });
    }
  };
  addBillboard(12, -168, 0, 'SOLMAR', 'BAY CITY • EST. 1987', '#ff2e88');
  addBillboard(-12, 112, Math.PI, 'AURORA GT', 'SOLMAR MOTORS', '#ffd60a');
  addBillboard(90, 238, -Math.PI / 2, 'SOLMAR BAY', 'SUN • SAND • SPEED', '#4fc2c2');
  for (const sx of STREETS) {
    for (const sz of STREETS) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 6), lampMat);
      pole.position.set(sx + 8.5, 3, sz + 8.5);
      scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), lampGlowMat);
      lamp.position.set(sx + 8.5, 6.1, sz + 8.5);
      scene.add(lamp);
    }
  }

  // ---- road graph: nodes at every intersection, edges to neighbours.
  const nodes = [];
  for (let ix = 0; ix < STREETS.length; ix++) {
    for (let iz = 0; iz < STREETS.length; iz++) {
      nodes.push({ x: STREETS[ix], z: STREETS[iz], ix, iz });
    }
  }
  const nodeAt = (ix, iz) => nodes[iz * STREETS.length + ix];
  const edges = new Map();
  for (const n of nodes) {
    const list = [];
    if (n.ix > 0) list.push(nodeAt(n.ix - 1, n.iz));
    if (n.ix < STREETS.length - 1) list.push(nodeAt(n.ix + 1, n.iz));
    if (n.iz > 0) list.push(nodeAt(n.ix, n.iz - 1));
    if (n.iz < STREETS.length - 1) list.push(nodeAt(n.ix, n.iz + 1));
    edges.set(n, list);
  }

  return {
    colliders, nodes, edges, buildingCount,
    /** Random point on a road, for spawns. */
    randomRoadPoint(r) {
      const street = pick(r, STREETS);
      const along = randRange(r, -224, 224);
      return r() < 0.5 ? { x: street, z: along } : { x: along, z: street };
    },
    /** Is (x, z) on asphalt (within a road strip)? */
    isOnRoad(x, z) {
      const onStreet = (v) => STREETS.some((s) => Math.abs(v - s) <= ROAD_HALF);
      return onStreet(x) || onStreet(z);
    },
  };
}

function plantTree(scene, x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.45, 3, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2a })
  );
  trunk.position.set(x, 1.5, z);
  scene.add(trunk);
  const top = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x4d9e57 })
  );
  top.position.set(x, 4.4, z);
  scene.add(top);
}

function plantPalm(scene, x, z, trunkMat, palmMat) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 7, 6), trunkMat);
  trunk.position.set(x, 3.5, z);
  trunk.rotation.z = 0.08;
  scene.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.4, 4), palmMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(x + Math.cos(a) * 1.5, 7.2, z + Math.sin(a) * 1.5);
    leaf.rotation.z = Math.cos(a) * 1.1;
    leaf.rotation.x = -Math.sin(a) * 1.1;
    scene.add(leaf);
  }
}
