// hud.js — the HUD: money, health, wanted stars, speed, mission objective,
// and a live minimap of Solmar (roads, player, police, mission marker).

import { clamp } from './utils.js';

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      money: document.getElementById('money'),
      healthFill: document.getElementById('health-fill'),
      healthText: document.getElementById('health-text'),
      ammo: document.getElementById('ammo'),
      wanted: document.getElementById('wanted'),
      objectiveTitle: document.getElementById('objective-title'),
      objectiveText: document.getElementById('objective-text'),
      speedo: document.getElementById('speedo'),
      speed: document.getElementById('speed'),
      minimap: document.getElementById('minimap'),
      toast: document.getElementById('toast'),
      crosshair: document.getElementById('crosshair'),
      vignette: document.getElementById('vignette'),
      banner: document.getElementById('center-banner'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.toastTimer = null;
    this.bannerTimer = null;
    this.lastWanted = -1;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  toast(text, ms = 3600) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = '1';
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.el.toast.style.opacity = '0'; }, ms);
  }

  banner(text, ms = 2200) {
    this.el.banner.textContent = text;
    this.el.banner.classList.remove('hidden');
    if (this.bannerTimer) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.el.banner.classList.add('hidden'), ms);
  }

  setVignette(opacity) { this.el.vignette.style.opacity = String(clamp(opacity, 0, 1)); }

  update(s) {
    this.el.money.textContent = `$${Math.floor(s.money).toLocaleString('en-US')}`;
    this.el.healthFill.style.width = `${clamp(s.health, 0, 100)}%`;
    this.el.healthText.textContent = String(Math.ceil(s.health));
    this.el.ammo.textContent = s.driving
      ? 'DRIVING — SPACE handbrake'
      : `PISTOL — ${s.ammo} / ∞${s.reloading ? '  ·  RELOADING…' : ''}`;
    if (s.wanted !== this.lastWanted) {
      this.lastWanted = s.wanted;
      let stars = '';
      for (let i = 0; i < 5; i++) stars += `<span class="star${i < s.wanted ? '' : ' off'}">★</span>`;
      this.el.wanted.innerHTML = stars;
    }
    this.el.objectiveTitle.textContent = s.objectiveTitle;
    this.el.objectiveText.textContent = s.objectiveText;
    if (s.driving) {
      this.el.speedo.classList.remove('hidden');
      this.el.speed.textContent = String(Math.round(Math.abs(s.speed) * 2.237));
    } else {
      this.el.speedo.classList.add('hidden');
    }
    this.el.crosshair.classList.toggle('hidden', s.driving || s.inMenu);
    this.setVignette(s.health < 35 ? 0.55 + Math.sin(performance.now() / 180) * 0.2 : (s.bustMeter > 0 ? s.bustMeter * 0.35 : 0));
    this.drawMinimap(s);
  }

  drawMinimap(s) {
    const ctx = this.mapCtx;
    const W = 220, H = 220;
    ctx.clearRect(0, 0, W, H);
    // Map world [-260, 260] x [-260, 330] onto the 220px disc.
    const px = (x) => ((x + 260) / 520) * W;
    const py = (z) => ((z + 260) / 590) * H;
    // Sea + sand at the bottom (south).
    ctx.fillStyle = '#2e7fb8';
    ctx.fillRect(0, py(312), W, H - py(312));
    ctx.fillStyle = '#e8d5a3';
    ctx.fillRect(0, py(252), W, py(312) - py(252));
    // City blocks.
    ctx.fillStyle = '#3d4a55';
    ctx.fillRect(0, 0, W, py(252));
    // Roads.
    ctx.strokeStyle = '#8a8f96';
    ctx.lineWidth = 4;
    const streets = [-224, -168, -112, -56, 0, 56, 112, 168, 224];
    for (const v of streets) {
      ctx.beginPath(); ctx.moveTo(px(v), 0); ctx.lineTo(px(v), py(252)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, py(v)); ctx.lineTo(W, py(v)); ctx.stroke();
    }
    // Mission target: big pulsing yellow diamond.
    if (s.missionTarget) {
      const pulse = 6 + Math.sin(performance.now() / 200) * 2;
      ctx.fillStyle = '#ffd60a';
      const tx = px(s.missionTarget.x), ty = py(s.missionTarget.z);
      ctx.beginPath();
      ctx.moveTo(tx, ty - pulse); ctx.lineTo(tx + pulse, ty);
      ctx.lineTo(tx, ty + pulse); ctx.lineTo(tx - pulse, ty);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Gold car (job 2) when it exists.
    if (s.goldCar) {
      ctx.fillStyle = '#ffd700';
      ctx.beginPath(); ctx.arc(px(s.goldCar.x), py(s.goldCar.z), 4, 0, Math.PI * 2); ctx.fill();
    }
    // Traffic dots.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const c of s.traffic || []) {
      ctx.fillRect(px(c.x) - 1.5, py(c.z) - 1.5, 3, 3);
    }
    // Police: red dots with a dark ring.
    for (const c of s.police || []) {
      ctx.fillStyle = '#ff2a22';
      ctx.beginPath(); ctx.arc(px(c.x), py(c.z), 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Player: white arrow, rotated by heading.
    ctx.save();
    ctx.translate(px(s.playerX), py(s.playerZ));
    ctx.rotate(s.heading);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
