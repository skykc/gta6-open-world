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
  // Kept mid-grey, not near-black: under the sunset grade + ACES tone
  // mapping a dark asphalt reads as a black void from street level.
  return canvasTexture(THREE, 64, 256, (g, w, h) => {
    g.fillStyle = '#565b64';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f5c542';
    g.fillRect(w / 2 - 2, 20, 4, 60);
    g.fillRect(w / 2 - 2, 148, 4, 60);
    g.fillStyle = 'rgba(255,255,255,0.14)';
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

/** Districts of Solmar Bay, by region — shown under the minimap. */
export function districtAt(x, z) {
  if (z > 252) return 'BEACHFRONT';
  if (z > 168) return x < 0 ? 'BEACHFRONT' : 'DOCKS';
  if (z <= -56) return x <= -56 ? 'OLD TOWN' : 'UPTOWN';
  return x <= -56 ? 'MARINA' : 'DOWNTOWN';
}

function shopSignTexture(THREE, text, color) {
  // Small neon shopfront sign: dark board, glowing letters.
  return canvasTexture(THREE, 256, 64, (g, w, h) => {
    g.fillStyle = '#101018';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = color;
    g.font = '900 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
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

  // ---- buildings: towers in many shapes, not boxes only — round towers
  // with domes, stepped crowns, pyramid roofs, and low shopfront rows with
  // awnings and neon signs. Plazas where the dice say so.
  const bases = ['#c9a184', '#b7c4cc', '#d8c49a', '#a8b8a0', '#c4a3b2', '#9fb2c8'];
  const facades = bases.map((b) => facadeTexture(THREE, mulberry32(seed + b.length * 977), b, 0.16));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a5f66 });
  const domeMat = new THREE.MeshLambertMaterial({ color: 0x9a7b52 });
  const awningMats = [0xff2e88, 0xffd60a, 0x4fc2c2, 0xff7b39, 0x7dff9a].map(
    (c) => new THREE.MeshLambertMaterial({ color: c })
  );
  const shopNames = ['CAFÉ', 'TACOS', 'PIZZA', 'HOTEL', 'BAR', 'DONUTS', 'SURF SHOP', 'NOODLES'];
  let buildingCount = 0;
  const addCollider = (x, z, w, d) => colliders.push({
    minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
  });
  // Water tank / AC boxes / antenna on a rooftop — the skyline's clutter.
  const addRoofProps = (x, z, h, w, d) => {
    const r = rng();
    if (r < 0.3) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.2, 10), roofMat);
      tank.position.set(x + w * 0.2, h + 3.4, z);
      scene.add(tank);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.6, 10), domeMat);
      cap.position.set(x + w * 0.2, h + 5.8, z);
      scene.add(cap);
    } else if (r < 0.6) {
      for (let i = 0; i < 2; i++) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 2.2), roofMat);
        ac.position.set(x + randRange(rng, -w / 4, w / 4), h + 1.1, z + randRange(rng, -d / 4, d / 4));
        scene.add(ac);
      }
    } else if (r < 0.8) {
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, randRange(rng, 6, 14), 6), roofMat
      );
      antenna.position.set(x, h + 6, z);
      scene.add(antenna);
    }
  };
  // A plain box tower, optionally crowned with a pyramid roof or a dome.
  const addBoxTower = (x, z, w, h, d) => {
    const mat = new THREE.MeshLambertMaterial({ map: pick(rng, facades) });
    const b = new THREE.Mesh(boxGeo, mat);
    b.scale.set(w, h, d);
    b.position.set(x, h / 2, z);
    scene.add(b);
    const crown = rng();
    if (crown < 0.22) {
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, randRange(rng, 4, 8), 4), roofMat);
      pyr.position.set(x, h + 2.5, z);
      pyr.rotation.y = Math.PI / 4;
      scene.add(pyr);
    } else if (crown < 0.36) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(Math.max(w, d) * 0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      dome.position.set(x, h, z);
      scene.add(dome);
    } else {
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.scale.set(w * 0.92, 1.2, d * 0.92);
      roof.position.set(x, h + 0.6, z);
      scene.add(roof);
    }
    addRoofProps(x, z, h, w, d);
    addCollider(x, z, w, d);
    buildingCount++;
  };
  // A round tower: cylinder shaft, flat disc or dome on top.
  const addRoundTower = (x, z, r, h) => {
    const mat = new THREE.MeshLambertMaterial({ map: pick(rng, facades) });
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, h, 14), mat);
    t.position.set(x, h / 2, z);
    scene.add(t);
    if (rng() < 0.45) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 0.82, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      dome.position.set(x, h, z);
      scene.add(dome);
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.94, 1.2, 14), roofMat);
      disc.position.set(x, h + 0.6, z);
      scene.add(disc);
    }
    addRoofProps(x, z, h, r * 2, r * 2);
    addCollider(x, z, r * 1.8, r * 1.8);
    buildingCount++;
  };
  // A stepped tower: three shrinking slabs, like a ziggurat.
  const addSteppedTower = (x, z, w, d, h) => {
    const mat = new THREE.MeshLambertMaterial({ map: pick(rng, facades) });
    const slabs = [[w, h * 0.55, d, 0], [w * 0.7, h * 0.3, d * 0.7, h * 0.55], [w * 0.45, h * 0.15, d * 0.45, h * 0.85]];
    for (const [sw, sh, sd, sy] of slabs) {
      const s = new THREE.Mesh(boxGeo, mat);
      s.scale.set(sw, sh, sd);
      s.position.set(x, sy + sh / 2, z);
      scene.add(s);
    }
    addRoofProps(x, z, h, w * 0.45, d * 0.45);
    addCollider(x, z, w, d);
    buildingCount++;
  };
  // A row of three low shopfronts with striped awnings and neon signs.
  const addShops = (cx, cz, horizontal) => {
    for (let i = -1; i <= 1; i++) {
      const x = horizontal ? cx + i * 14 : cx;
      const z = horizontal ? cz : cz + i * 14;
      const w = horizontal ? 13 : 16, d = horizontal ? 16 : 13;
      const h = randRange(rng, 6, 9);
      const mat = new THREE.MeshLambertMaterial({ map: pick(rng, facades) });
      const shop = new THREE.Mesh(boxGeo, mat);
      shop.scale.set(w, h, d);
      shop.position.set(x, h / 2, z);
      scene.add(shop);
      // Awning: a tilted canopy box over the shopfront. A group handles the
      // shop's orientation; the box inside tilts down toward the street.
      const awnGroup = new THREE.Group();
      awnGroup.position.set(x, 0, z);
      awnGroup.rotation.y = horizontal ? 0 : Math.PI / 2;
      const front = horizontal ? w : d;
      const depth = horizontal ? d : w;
      const awn = new THREE.Mesh(
        new THREE.BoxGeometry(front * 0.9, 0.18, 3.2),
        pick(rng, awningMats)
      );
      awn.position.set(0, 3.7, depth / 2 + 1.1);
      awn.rotation.x = -0.45;
      awnGroup.add(awn);
      scene.add(awnGroup);
      // Neon sign above the awning.
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 2.2),
        new THREE.MeshBasicMaterial({ map: shopSignTexture(THREE, pick(rng, shopNames), pick(rng, ['#ff2e88', '#ffd60a', '#4fc2c2', '#ff7b39'])) })
      );
      sign.position.set(horizontal ? x : x + w / 2 + 0.3, h - 1.2, horizontal ? z + d / 2 + 0.3 : z);
      if (!horizontal) sign.rotation.y = Math.PI / 2;
      scene.add(sign);
      addCollider(x, z, w, d);
      buildingCount++;
    }
  };
  for (let bx = 0; bx < 8; bx++) {
    for (let bz = 0; bz < 8; bz++) {
      const cx = STREETS[bx] + PITCH / 2;
      const cz = STREETS[bz] + PITCH / 2;
      const roll = rng();
      if (roll < 0.08) {
        // Plaza: green square + trees instead of towers.
        const lawn = new THREE.Mesh(
          new THREE.PlaneGeometry(44, 44),
          new THREE.MeshLambertMaterial({ color: 0x6fae5f })
        );
        lawn.rotation.x = -Math.PI / 2;
        lawn.position.set(cx, 0.05, cz);
        scene.add(lawn);
        for (let t = 0; t < 6; t++) plantTree(scene, cx + randRange(rng, -16, 16), cz + randRange(rng, -16, 16));
        continue;
      }
      if (roll < 0.2) {
        addRoundTower(cx, cz, randRange(rng, 12, 16), randRange(rng, 22, 64));
      } else if (roll < 0.32) {
        addSteppedTower(cx, cz, randRange(rng, 26, 34), randRange(rng, 26, 34), randRange(rng, 26, 62));
      } else if (roll < 0.44) {
        // A cluster of three small towers, or a 2x2 quad of mid-rises.
        if (rng() < 0.5) {
          for (const dx of [-14, 0, 14]) addBoxTower(cx + dx, cz, 12, randRange(rng, 12, 30), 22);
        } else {
          for (const dx of [-10, 10]) for (const dz of [-10, 10]) addBoxTower(cx + dx, cz + dz, 15, randRange(rng, 14, 34), 15);
        }
      } else if (roll < 0.6) {
        addBoxTower(cx - 11, cz, 20, randRange(rng, 10, 46), 34);
        addBoxTower(cx + 11, cz, 20, randRange(rng, 10, 46), 34);
      } else if (roll < 0.74) {
        addShops(cx, cz, rng() < 0.5);
      } else {
        addBoxTower(cx, cz, 34, randRange(rng, 10, 58), 34);
      }
    }
  }
  // Distant skyline beyond the north edge: dark towers so the city never
  // ends at the grid — they frame the sunset in the chase shot.
  const skyMat = new THREE.MeshLambertMaterial({ color: 0x6b4a63 });
  for (let i = 0; i < 12; i++) {
    const w = randRange(rng, 18, 30), h = randRange(rng, 40, 95), d = randRange(rng, 18, 30);
    const x = -300 + i * 55 + randRange(rng, -12, 12);
    const t = new THREE.Mesh(boxGeo, skyMat);
    t.scale.set(w, h, d);
    t.position.set(x, h / 2, -292 - randRange(rng, 0, 40));
    scene.add(t);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const w = randRange(rng, 18, 28), h = randRange(rng, 35, 80), d = randRange(rng, 18, 28);
      const t = new THREE.Mesh(boxGeo, skyMat);
      t.scale.set(w, h, d);
      t.position.set(side * (292 + randRange(rng, 0, 30)), h / 2, -200 + i * 110 + randRange(rng, -14, 14));
      scene.add(t);
    }
  }

  // ---- street props: palms along every avenue and on the sand, leafy
  // trees on the sidewalks, lamps at corners, traffic lights, beach gear,
  // bus stops, benches, and neon billboards over the main roads.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const palmMat = new THREE.MeshLambertMaterial({ color: 0x2f8f3e });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  let palmCount = 0;
  let treeCount = 0;
  const addPalm = (x, z) => { plantPalm(scene, x, z, trunkMat, palmMat); palmCount++; };
  const addTree = (x, z) => { plantTree(scene, x, z); treeCount++; };
  for (const s of STREETS) {
    for (let k = -3; k <= 3; k++) {
      if (k % 2 === 0) continue;
      addPalm(s + 10.5, k * 56 + 28);
      addPalm(s - 10.5, k * 56);
    }
    // Leafy trees on the sidewalks, alternating sides down the avenue.
    for (let k = -3; k <= 3; k += 2) {
      addTree(s + (k % 4 === -3 ? 10.5 : -10.5), k * 56 + 14);
    }
  }
  // A palm on a random corner of most intersections — the streets feel lined.
  for (const sx of STREETS) {
    for (const sz of STREETS) {
      if (rng() < 0.4) addPalm(sx + (rng() < 0.5 ? 10.5 : -10.5), sz + (rng() < 0.5 ? 10.5 : -10.5));
    }
  }
  // Denser palm row on the sand, facing the beach road.
  for (let x = -240; x <= 240; x += 18) addPalm(x, 258);
  // Beach life: umbrellas in a row + a lifeguard tower.
  const umbrellaMat = new THREE.MeshLambertMaterial({ color: 0xff2e88 });
  const umbrellaMat2 = new THREE.MeshLambertMaterial({ color: 0xffd60a });
  for (let i = 0; i < 8; i++) {
    const x = -196 + i * 56;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6), trunkMat);
    pole.position.set(x, 1.3, 274);
    scene.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 8), i % 2 ? umbrellaMat : umbrellaMat2);
    top.position.set(x, 3, 274);
    scene.add(top);
  }
  const towerMat = new THREE.MeshLambertMaterial({ color: 0xe8e0cc });
  for (const [lx, lz] of [[-140, 276], [140, 276]]) {
    for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.4, 0.25), towerMat);
      leg.position.set(lx + ox, 2.2, lz + oz);
      scene.add(leg);
    }
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2, 3.6), towerMat);
    cab.position.set(lx, 5.2, lz);
    scene.add(cab);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3, 1.4, 4), new THREE.MeshLambertMaterial({ color: 0xc23b2e }));
    roof.position.set(lx, 7, lz);
    roof.rotation.y = Math.PI / 4;
    scene.add(roof);
  }
  // Traffic lights on a checkerboard of intersections.
  const lightFaceTex = canvasTexture(THREE, 32, 96, (g, w, h) => {
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, w, h);
    const cols = ['#ff2020', '#3a3a3a', '#3a3a3a'];
    for (let i = 0; i < 3; i++) {
      g.fillStyle = cols[i];
      g.beginPath(); g.arc(w / 2, 16 + i * 32, 11, 0, Math.PI * 2); g.fill();
    }
  });
  const lightHeadMat = new THREE.MeshBasicMaterial({ map: lightFaceTex });
  for (let ix = 0; ix < STREETS.length; ix++) {
    for (let iz = 0; iz < STREETS.length; iz++) {
      if ((ix + iz) % 2 !== 0) continue;
      const sx = STREETS[ix], sz = STREETS[iz];
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5.6, 6), lampMat);
      pole.position.set(sx + 7.4, 2.8, sz + 7.4);
      scene.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.6), lampMat);
      arm.position.set(sx + 7.4, 5.4, sz + 6.2);
      scene.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.6, 0.4), lightHeadMat);
      head.position.set(sx + 7.4, 4.6, sz + 5.2);
      scene.add(head);
    }
  }
  // Bus stops, benches, hydrants, dumpsters — the small stuff that makes a
  // street feel used instead of empty.
  const shelterMat = new THREE.MeshLambertMaterial({ color: 0x2a6f9e });
  const benchMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const hydrantMat = new THREE.MeshLambertMaterial({ color: 0xc23b2e });
  const dumpMat = new THREE.MeshLambertMaterial({ color: 0x3a6b3f });
  for (let i = 0; i < 6; i++) {
    const street = pick(rng, STREETS);
    const along = randRange(rng, -200, 200);
    const x = rng() < 0.5 ? street + 10.5 : along;
    const z = rng() < 0.5 ? along : street + 10.5;
    for (const s of [-1.4, 1.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.14), lampMat);
      post.position.set(x + s, 1.2, z);
      scene.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 1.6), shelterMat);
    roof.position.set(x, 2.5, z);
    scene.add(roof);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.6), benchMat);
    bench.position.set(x, 0.55, z - 0.3);
    scene.add(bench);
  }
  for (let i = 0; i < 10; i++) {
    const street = pick(rng, STREETS);
    const along = randRange(rng, -200, 200);
    const x = rng() < 0.5 ? street + 10.5 : along;
    const z = rng() < 0.5 ? along : street + 10.5;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.55), benchMat);
    bench.position.set(x, 0.5, z);
    scene.add(bench);
  }
  for (let i = 0; i < 12; i++) {
    const street = pick(rng, STREETS);
    const along = randRange(rng, -200, 200);
    const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.8, 8), hydrantMat);
    hyd.position.set(rng() < 0.5 ? street + 9.4 : along, 0.4, rng() < 0.5 ? along : street + 9.4);
    scene.add(hyd);
  }
  for (let i = 0; i < 8; i++) {
    const street = pick(rng, STREETS);
    const along = randRange(rng, -200, 200);
    const dump = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, 1.2), dumpMat);
    dump.position.set(rng() < 0.5 ? street + 11 : along, 0.65, rng() < 0.5 ? along : street + 11);
    scene.add(dump);
  }
  // Neon billboards: SOLMAR over the main avenue (seen driving north),
  // AURORA GT over the cross avenue, SOLMAR BAY along the beach road,
  // PALMS HOTEL uptown, and the SOLMAR FM 88.1 radio board.
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
  addBillboard(-90, -168, 0, 'PALMS HOTEL', 'OCEAN VIEW • SINCE 1962', '#ff7b39');
  addBillboard(168, 12, Math.PI / 2, 'SOLMAR FM', '88.1 • SUNSET DRIVE', '#7dff9a');
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
  const nodeAt = (ix, iz) => nodes[ix * STREETS.length + iz];
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
    colliders, nodes, edges, buildingCount, palmCount, treeCount,
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
