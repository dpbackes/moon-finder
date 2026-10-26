/**
 * renderer.js
 * High-DPI Canvas renderer for 2D Sky Radar and Live Camera AR View.
 * Works directly via file:// in browsers and in Node.js tests.
 */
(function (root) {
  'use strict';

  const Astronomy =
    root.MoonAstronomy ||
    (typeof require === 'function' ? require('./astronomy.js') : null);
  const { shortestAngleDelta } = Astronomy;

  const RAD = Math.PI / 180;

  class SkyRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.width = 0;
      this.height = 0;
      this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.pulsePhase = 0;

      this.stars = this._generateStars(95);

      this.resize();
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('resize', () => this.resize());
      }
    }

    _generateStars(count) {
      const stars = [];
      let seed = 421337;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
      for (let i = 0; i < count; i++) {
        stars.push({
          az: rand() * 360,
          alt: rand() * 88 + 1,
          size: rand() * 1.4 + 0.5,
          alpha: rand() * 0.55 + 0.2,
        });
      }
      return stars;
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.dpr = Math.min(
        (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
        2.5
      );
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
    }

    render(frameData) {
      const ctx = this.ctx;
      this.pulsePhase = (this.pulsePhase + 0.05) % (Math.PI * 2);

      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, this.width, this.height);

      if (frameData.viewMode === 'ar') {
        this._renderARView(ctx, frameData);
      } else {
        this._renderRadarView(ctx, frameData);
      }

      ctx.restore();
    }

    _altitudeToRadius(altDeg, horizonRadius, outerRadius) {
      const clamped = Math.max(-90, Math.min(90, altDeg));
      if (clamped >= 0) {
        return ((90 - clamped) / 90) * horizonRadius;
      } else {
        const subSpan = outerRadius - horizonRadius;
        return horizonRadius + (Math.abs(clamped) / 90) * subSpan;
      }
    }

    _renderRadarView(ctx, data) {
      const { deviceAz, deviceAlt, moonPos, moonIllum, guidance } = data;
      const cx = this.width / 2;
      const cy = this.height / 2;
      const maxDim = Math.min(this.width, this.height);
      const outerRadius = Math.max(110, maxDim * 0.43);
      const horizonRadius = outerRadius * 0.76;

      const skyGrad = ctx.createRadialGradient(
        cx,
        cy,
        2,
        cx,
        cy,
        outerRadius * 1.08
      );
      if (guidance.isLockedOn) {
        skyGrad.addColorStop(0, 'rgba(16, 48, 62, 0.95)');
        skyGrad.addColorStop(0.75, 'rgba(9, 22, 38, 0.95)');
        skyGrad.addColorStop(1, 'rgba(5, 10, 20, 0.98)');
      } else {
        skyGrad.addColorStop(0, 'rgba(15, 28, 55, 0.92)');
        skyGrad.addColorStop(0.75, 'rgba(8, 15, 32, 0.95)');
        skyGrad.addColorStop(1, 'rgba(4, 8, 18, 0.98)');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = skyGrad;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.arc(cx, cy, horizonRadius, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(4, 7, 15, 0.62)';
      ctx.fill();
      ctx.restore();

      for (const star of this.stars) {
        const relAzRad = (star.az - deviceAz - 90) * RAD;
        const r = this._altitudeToRadius(star.alt, horizonRadius, outerRadius);
        const sx = cx + r * Math.cos(relAzRad);
        const sy = cy + r * Math.sin(relAzRad);
        ctx.beginPath();
        ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(210, 230, 255, ${star.alpha})`;
        ctx.fill();
      }

      const rings = [
        { alt: 60, label: '60°', dashed: true },
        { alt: 30, label: '30°', dashed: true },
        { alt: 0, label: 'HORIZON 0°', dashed: false, isHorizon: true },
      ];

      for (const ring of rings) {
        const r = this._altitudeToRadius(ring.alt, horizonRadius, outerRadius);
        ctx.save();
        ctx.beginPath();
        if (ring.dashed) ctx.setLineDash([4, 6]);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = ring.isHorizon
          ? 'rgba(56, 189, 248, 0.55)'
          : 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = ring.isHorizon ? 1.8 : 1;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = ring.isHorizon
          ? 'rgba(125, 211, 252, 0.75)'
          : 'rgba(148, 163, 184, 0.45)';
        ctx.font = ring.isHorizon
          ? '600 10px system-ui, -apple-system, sans-serif'
          : '500 10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ring.label, cx, cy - r + 12);
      }

      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = guidance.isLockedOn
        ? 'rgba(52, 211, 153, 0.7)'
        : 'rgba(100, 116, 139, 0.4)';
      ctx.lineWidth = guidance.isLockedOn ? 2.5 : 1.5;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(cx + 6, cy);
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx, cy + 6);
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy - outerRadius);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      for (let deg = 0; deg < 360; deg += 10) {
        const relRad = (deg - deviceAz - 90) * RAD;
        const isCardinal = deg % 90 === 0;
        const isIntercardinal = deg % 45 === 0 && !isCardinal;
        const tickInner =
          outerRadius - (isCardinal ? 10 : isIntercardinal ? 7 : 4);

        ctx.beginPath();
        ctx.moveTo(
          cx + tickInner * Math.cos(relRad),
          cy + tickInner * Math.sin(relRad)
        );
        ctx.lineTo(
          cx + outerRadius * Math.cos(relRad),
          cy + outerRadius * Math.sin(relRad)
        );
        ctx.strokeStyle =
          deg === 0
            ? '#f87171'
            : isCardinal
            ? 'rgba(226, 232, 240, 0.85)'
            : 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = isCardinal ? 2 : 1;
        ctx.stroke();
      }

      const cardinals = [
        { deg: 0, label: 'N', color: '#f87171', font: '700 13px system-ui' },
        { deg: 45, label: 'NE', color: 'rgba(148,163,184,0.7)', font: '600 10px system-ui' },
        { deg: 90, label: 'E', color: '#e2e8f0', font: '700 12px system-ui' },
        { deg: 135, label: 'SE', color: 'rgba(148,163,184,0.7)', font: '600 10px system-ui' },
        { deg: 180, label: 'S', color: '#e2e8f0', font: '700 12px system-ui' },
        { deg: 225, label: 'SW', color: 'rgba(148,163,184,0.7)', font: '600 10px system-ui' },
        { deg: 270, label: 'W', color: '#e2e8f0', font: '700 12px system-ui' },
        { deg: 315, label: 'NW', color: 'rgba(148,163,184,0.7)', font: '600 10px system-ui' },
      ];

      const labelRadius = outerRadius + 16;
      for (const c of cardinals) {
        const relRad = (c.deg - deviceAz - 90) * RAD;
        const lx = cx + labelRadius * Math.cos(relRad);
        const ly = cy + labelRadius * Math.sin(relRad);
        ctx.font = c.font;
        ctx.fillStyle = c.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.label, lx, ly);
      }

      ctx.beginPath();
      ctx.moveTo(cx, cy - outerRadius - 3);
      ctx.lineTo(cx - 6, cy - outerRadius - 12);
      ctx.lineTo(cx + 6, cy - outerRadius - 12);
      ctx.closePath();
      ctx.fillStyle = '#38bdf8';
      ctx.fill();

      const phoneRadius = this._altitudeToRadius(
        deviceAlt,
        horizonRadius,
        outerRadius
      );
      const phoneX = cx;
      const phoneY = cy - phoneRadius;

      const moonRelRad = (moonPos.azimuth - deviceAz - 90) * RAD;
      const moonRadius = this._altitudeToRadius(
        moonPos.altitude,
        horizonRadius,
        outerRadius
      );
      const moonX = cx + moonRadius * Math.cos(moonRelRad);
      const moonY = cy + moonRadius * Math.sin(moonRelRad);

      const distPx = Math.hypot(moonX - phoneX, moonY - phoneY);
      if (distPx > 18 && !guidance.isLockedOn) {
        const dirX = (moonX - phoneX) / distPx;
        const dirY = (moonY - phoneY) / distPx;
        const startX = phoneX + dirX * 14;
        const startY = phoneY + dirY * 14;
        const endX = moonX - dirX * 22;
        const endY = moonY - dirY * 22;

        ctx.save();
        const lineGrad = ctx.createLinearGradient(startX, startY, endX, endY);
        lineGrad.addColorStop(0, 'rgba(56, 189, 248, 0.85)');
        lineGrad.addColorStop(1, 'rgba(250, 204, 21, 0.95)');

        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();

        const angle = Math.atan2(dirY, dirX);
        ctx.save();
        ctx.translate(endX, endY);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-8, -5.5);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-8, 5.5);
        ctx.closePath();
        ctx.fillStyle = '#facc15';
        ctx.fill();
        ctx.restore();
      }

      this._drawMoonDisc(
        ctx,
        moonX,
        moonY,
        16,
        moonIllum.phase,
        moonPos.isAboveHorizon,
        guidance.isLockedOn
      );

      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = moonPos.isAboveHorizon ? '#fef08a' : '#94a3b8';
      ctx.fillText(
        moonPos.isAboveHorizon ? 'MOON' : 'MOON (Below Horizon)',
        moonX,
        moonY + 28
      );

      const reticleColor = guidance.isLockedOn ? '#34d399' : '#38bdf8';
      const pulseR = 16 + Math.sin(this.pulsePhase) * 3;

      ctx.save();
      ctx.beginPath();
      ctx.arc(phoneX, phoneY, pulseR, 0, Math.PI * 2);
      ctx.strokeStyle = guidance.isLockedOn
        ? 'rgba(52, 211, 153, 0.7)'
        : 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(phoneX, phoneY, 4, 0, Math.PI * 2);
      ctx.fillStyle = reticleColor;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(phoneX - 11, phoneY);
      ctx.lineTo(phoneX - 5, phoneY);
      ctx.moveTo(phoneX + 5, phoneY);
      ctx.lineTo(phoneX + 11, phoneY);
      ctx.moveTo(phoneX, phoneY - 11);
      ctx.lineTo(phoneX, phoneY - 5);
      ctx.moveTo(phoneX, phoneY + 5);
      ctx.lineTo(phoneX, phoneY + 11);
      ctx.strokeStyle = reticleColor;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.restore();
    }

    _renderARView(ctx, data) {
      const { deviceAz, deviceAlt, deviceRoll, moonPos, moonIllum, guidance } =
        data;
      const cx = this.width / 2;
      const cy = this.height / 2;

      const fovDeg = 60;
      const pxPerDeg = Math.min(this.width, this.height) / fovDeg;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-deviceRoll || 0) * RAD);

      const horizonOffsetY = deviceAlt * pxPerDeg;
      if (Math.abs(horizonOffsetY) < this.height) {
        ctx.beginPath();
        ctx.setLineDash([8, 6]);
        ctx.moveTo(-this.width, horizonOffsetY);
        ctx.lineTo(this.width, horizonOffsetY);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = 'rgba(125, 211, 252, 0.75)';
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('HORIZON 0°', -cx + 16, horizonOffsetY - 6);
      }

      const dAz = shortestAngleDelta(moonPos.azimuth, deviceAz);
      const dAlt = moonPos.altitude - deviceAlt;
      const moonScreenX = dAz * pxPerDeg;
      const moonScreenY = -dAlt * pxPerDeg;

      const maxGuideRadius = Math.min(cx, cy) * 0.72;
      const isInsideFOV =
        Math.abs(moonScreenX) < cx - 32 &&
        Math.abs(moonScreenY) < cy - 60 &&
        guidance.angularDistance < 85;

      if (isInsideFOV) {
        if (!guidance.isLockedOn) {
          ctx.beginPath();
          ctx.setLineDash([5, 5]);
          ctx.moveTo(0, 0);
          ctx.lineTo(moonScreenX, moonScreenY);
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
          ctx.lineWidth = 1.8;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const bracketSize = 32 + Math.sin(this.pulsePhase) * 3;
        ctx.strokeStyle = guidance.isLockedOn ? '#34d399' : '#facc15';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(moonScreenX, moonScreenY, bracketSize, 0, Math.PI * 2);
        ctx.stroke();

        this._drawMoonDisc(
          ctx,
          moonScreenX,
          moonScreenY,
          22,
          moonIllum.phase,
          moonPos.isAboveHorizon,
          guidance.isLockedOn
        );

        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillStyle = guidance.isLockedOn ? '#6ee7b7' : '#fef08a';
        ctx.textAlign = 'center';
        ctx.fillText(
          `MOON (${guidance.angularDistance.toFixed(1)}°)`,
          moonScreenX,
          moonScreenY + 46
        );
      } else {
        const angle = Math.atan2(moonScreenY, moonScreenX);
        const arrowX = Math.cos(angle) * maxGuideRadius;
        const arrowY = Math.sin(angle) * maxGuideRadius;

        ctx.beginPath();
        ctx.setLineDash([4, 6]);
        ctx.arc(0, 0, maxGuideRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.save();
        ctx.translate(arrowX, arrowY);
        ctx.rotate(angle);

        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-10, -11);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-10, 11);
        ctx.closePath();
        ctx.fillStyle = '#facc15';
        ctx.shadowColor = 'rgba(250, 204, 21, 0.8)';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.restore();

        const labelX = Math.cos(angle) * (maxGuideRadius - 34);
        const labelY = Math.sin(angle) * (maxGuideRadius - 34);
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(guidance.angularDistance)}°`, labelX, labelY);
      }

      ctx.restore();

      const crossColor = guidance.isLockedOn
        ? '#34d399'
        : 'rgba(56, 189, 248, 0.85)';
      ctx.save();
      ctx.strokeStyle = crossColor;
      ctx.lineWidth = guidance.isLockedOn ? 2.5 : 1.8;

      ctx.beginPath();
      ctx.arc(cx, cy, guidance.isLockedOn ? 28 : 22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx - 32, cy);
      ctx.lineTo(cx - 14, cy);
      ctx.moveTo(cx + 14, cy);
      ctx.lineTo(cx + 32, cy);
      ctx.moveTo(cx, cy - 32);
      ctx.lineTo(cx, cy - 14);
      ctx.moveTo(cx, cy + 14);
      ctx.lineTo(cx, cy + 32);
      ctx.stroke();
      ctx.restore();
    }

    _drawMoonDisc(ctx, x, y, radius, phase, isAboveHorizon, isLockedOn) {
      ctx.save();
      ctx.translate(x, y);

      const glowRadius = radius * (isLockedOn ? 2.6 : 2.1);
      const glow = ctx.createRadialGradient(
        0,
        0,
        radius * 0.4,
        0,
        0,
        glowRadius
      );
      if (isLockedOn) {
        glow.addColorStop(0, 'rgba(52, 211, 153, 0.65)');
        glow.addColorStop(0.5, 'rgba(250, 204, 21, 0.35)');
        glow.addColorStop(1, 'rgba(52, 211, 153, 0)');
      } else if (isAboveHorizon) {
        glow.addColorStop(0, 'rgba(254, 240, 138, 0.55)');
        glow.addColorStop(0.6, 'rgba(250, 204, 21, 0.2)');
        glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
      } else {
        glow.addColorStop(0, 'rgba(148, 163, 184, 0.3)');
        glow.addColorStop(1, 'rgba(148, 163, 184, 0)');
      }

      ctx.beginPath();
      ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = isAboveHorizon ? '#1e293b' : '#0f172a';
      ctx.fill();

      const litColor = isAboveHorizon ? '#fef9c3' : '#94a3b8';
      ctx.fillStyle = litColor;

      const isWaxing = phase <= 0.5;
      const k = isWaxing ? phase * 2 : (phase - 0.5) * 2;
      const terminatorRx = Math.abs(Math.cos(k * Math.PI)) * radius;

      ctx.beginPath();
      if (isWaxing) {
        ctx.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2, false);
        ctx.ellipse(
          0,
          0,
          terminatorRx,
          radius,
          0,
          Math.PI / 2,
          -Math.PI / 2,
          k < 0.5
        );
      } else {
        ctx.arc(0, 0, radius, Math.PI / 2, -Math.PI / 2, false);
        ctx.ellipse(
          0,
          0,
          terminatorRx,
          radius,
          0,
          -Math.PI / 2,
          Math.PI / 2,
          k >= 0.5
        );
      }
      ctx.closePath();
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(71, 85, 105, 0.22)';
      ctx.beginPath();
      ctx.arc(-radius * 0.28, -radius * 0.2, radius * 0.26, 0, Math.PI * 2);
      ctx.arc(radius * 0.22, -radius * 0.15, radius * 0.2, 0, Math.PI * 2);
      ctx.arc(radius * 0.1, radius * 0.3, radius * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = isAboveHorizon
        ? 'rgba(254, 240, 138, 0.8)'
        : 'rgba(148, 163, 184, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.restore();
    }
  }

  const exportsObj = { SkyRenderer };
  root.MoonRenderer = exportsObj;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
