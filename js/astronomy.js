/**
 * astronomy.js
 * Pure client-side lunar ephemeris, illumination, and rise/set solver
 * based on Jean Meeus's "Astronomical Algorithms".
 * Works both directly via file:// in browsers and in Node.js tests.
 */
(function (root) {
  'use strict';

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const DAY_MS = 1000 * 60 * 60 * 24;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const OBLIQUITY = RAD * 23.4397; // Mean obliquity of the Earth at J2000

  function toDays(date) {
    return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  }

  function fromDays(d) {
    return new Date((d + 0.5 - J1970 + J2000) * DAY_MS);
  }

  function normalizeDegrees(deg) {
    return ((deg % 360) + 360) % 360;
  }

  function shortestAngleDelta(targetDeg, currentDeg) {
    let diff = ((targetDeg - currentDeg + 540) % 360) - 180;
    if (diff === -180) diff = 180;
    return diff;
  }

  function rightAscension(l, b) {
    return Math.atan2(
      Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY),
      Math.cos(l)
    );
  }

  function declination(l, b) {
    return Math.asin(
      Math.sin(b) * Math.cos(OBLIQUITY) +
        Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l)
    );
  }

  function siderealTime(d, lw) {
    return RAD * (280.16 + 360.9856235 * d) - lw;
  }

  function sunCoords(d) {
    const M = RAD * (357.5291 + 0.98560028 * d);
    const C =
      RAD *
      (1.9148 * Math.sin(M) +
        0.02 * Math.sin(2 * M) +
        0.0003 * Math.sin(3 * M));
    const L = M + C + RAD * 102.9372 + Math.PI;

    return {
      dec: declination(L, 0),
      ra: rightAscension(L, 0),
    };
  }

  function moonCoords(d) {
    const L = RAD * (218.3164477 + 13.17639648 * d);
    const M = RAD * (134.9633964 + 13.06499295 * d);
    const Ms = RAD * (357.5291092 + 0.98560028 * d);
    const F = RAD * (93.272095 + 13.22935024 * d);
    const D = RAD * (297.8501921 + 12.19074912 * d);

    const dLon =
      6.288774 * Math.sin(M) +
      1.274027 * Math.sin(2 * D - M) +
      0.658314 * Math.sin(2 * D) +
      0.213618 * Math.sin(2 * M) -
      0.185116 * Math.sin(Ms) -
      0.114332 * Math.sin(2 * F) +
      0.058793 * Math.sin(2 * D - 2 * M) +
      0.057066 * Math.sin(2 * D - Ms - M) +
      0.053322 * Math.sin(2 * D + M) +
      0.045758 * Math.sin(2 * D - Ms) -
      0.040923 * Math.sin(Ms - M) -
      0.034720 * Math.sin(D) -
      0.030383 * Math.sin(Ms + M) +
      0.015327 * Math.sin(2 * D - 2 * F);

    const dLat =
      5.128122 * Math.sin(F) +
      0.280602 * Math.sin(M + F) +
      0.277693 * Math.sin(M - F) +
      0.173237 * Math.sin(2 * D - F) +
      0.055413 * Math.sin(2 * D + F - M) +
      0.046271 * Math.sin(2 * D - F - M) +
      0.032573 * Math.sin(2 * D + F);

    const dist =
      385000.56 -
      20905.355 * Math.cos(M) -
      3699.111 * Math.cos(2 * D - M) -
      2955.968 * Math.cos(2 * D) -
      569.925 * Math.cos(2 * M) +
      246.158 * Math.cos(2 * M - 2 * D) -
      204.586 * Math.cos(2 * D - Ms) -
      170.733 * Math.cos(M + 2 * D) -
      152.138 * Math.cos(M + Ms - 2 * D);

    const l = L + RAD * dLon;
    const b = RAD * dLat;

    return {
      ra: rightAscension(l, b),
      dec: declination(l, b),
      dist,
    };
  }

  function getMoonPosition(date, lat, lon) {
    const lw = RAD * -lon;
    const phi = RAD * lat;
    const d = toDays(date);

    const c = moonCoords(d);
    const H = siderealTime(d, lw) - c.ra;

    // Topocentric parallax correction (Meeus Ch. 40)
    const sinPi = 6378.14 / c.dist;
    const u = Math.atan(0.99664719 * Math.tan(phi));
    const rhoSinPhi = 0.99664719 * Math.sin(u);
    const rhoCosPhi = Math.cos(u);

    const deltaRA = Math.atan2(
      -rhoCosPhi * sinPi * Math.sin(H),
      Math.cos(c.dec) - rhoCosPhi * sinPi * Math.cos(H)
    );
    const topocentricRA = c.ra + deltaRA;
    const topocentricH = H - deltaRA;
    const topocentricDec = Math.atan2(
      (Math.sin(c.dec) - rhoSinPhi * sinPi) * Math.cos(deltaRA),
      Math.cos(c.dec) - rhoCosPhi * sinPi * Math.cos(H)
    );

    const azSouthRad = Math.atan2(
      Math.sin(topocentricH),
      Math.cos(topocentricH) * Math.sin(phi) -
        Math.tan(topocentricDec) * Math.cos(phi)
    );
    const azimuth = normalizeDegrees(azSouthRad * DEG + 180);

    const altRad = Math.asin(
      Math.sin(phi) * Math.sin(topocentricDec) +
        Math.cos(phi) * Math.cos(topocentricDec) * Math.cos(topocentricH)
    );

    const altDegRaw = altRad * DEG;
    let refractionDeg = 0;
    if (altDegRaw > -1.0) {
      refractionDeg =
        0.0167 / Math.tan(RAD * (altDegRaw + 10.3 / (altDegRaw + 5.11)));
    }
    const altitude = altDegRaw + refractionDeg;

    const pa = Math.atan2(
      Math.sin(topocentricH),
      Math.tan(phi) * Math.cos(topocentricDec) -
        Math.sin(topocentricDec) * Math.cos(topocentricH)
    );

    return {
      azimuth,
      altitude,
      distanceKm: Math.round(c.dist),
      ra: normalizeDegrees(topocentricRA * DEG),
      dec: topocentricDec * DEG,
      parallacticAngle: pa * DEG,
      isAboveHorizon: altitude >= 0,
    };
  }

  function getPhaseMetadata(phase) {
    if (phase < 0.03 || phase >= 0.97) {
      return { name: 'New Moon', emoji: '🌑' };
    } else if (phase < 0.22) {
      return { name: 'Waxing Crescent', emoji: '🌒' };
    } else if (phase < 0.28) {
      return { name: 'First Quarter', emoji: '🌓' };
    } else if (phase < 0.47) {
      return { name: 'Waxing Gibbous', emoji: '🌔' };
    } else if (phase < 0.53) {
      return { name: 'Full Moon', emoji: '🌕' };
    } else if (phase < 0.72) {
      return { name: 'Waning Gibbous', emoji: '🌖' };
    } else if (phase < 0.78) {
      return { name: 'Last Quarter', emoji: '🌗' };
    } else {
      return { name: 'Waning Crescent', emoji: '🌘' };
    }
  }

  function getMoonIllumination(date) {
    const d = toDays(date);
    const s = sunCoords(d);
    const m = moonCoords(d);

    const sdist = 149598000;

    const phi = Math.acos(
      Math.sin(s.dec) * Math.sin(m.dec) +
        Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
    );
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    const angle = Math.atan2(
      Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) -
        Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
    );

    const fraction = (1 + Math.cos(inc)) / 2;
    const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
    const isWaxing = phase < 0.5;

    const { name, emoji } = getPhaseMetadata(phase);

    return {
      fraction,
      percentage: Math.round(fraction * 100),
      phase,
      phaseName: name,
      phaseEmoji: emoji,
      angle: angle * DEG,
      isWaxing,
    };
  }

  function getMoonTimes(date, lat, lon) {
    const startMs = date.getTime();
    const hourMs = 3600 * 1000;
    const h0 = 0.125;

    const getAlt = (ms) => getMoonPosition(new Date(ms), lat, lon).altitude - h0;

    let yMinus = getAlt(startMs);
    let nextRise = null;
    let nextSet = null;

    for (let i = 1; i <= 36; i += 2) {
      const y0 = getAlt(startMs + i * hourMs);
      const yPlus = getAlt(startMs + (i + 1) * hourMs);

      const a = (yMinus + yPlus) / 2 - y0;
      const b = (yPlus - yMinus) / 2;
      const xe = -b / (2 * a);
      const ye = (a * xe + b) * xe + y0;
      const d = b * b - 4 * a * y0;

      if (d >= 0 && Math.abs(a) > 1e-9) {
        const dx = Math.sqrt(d) / (2 * Math.abs(a));
        let x1 = xe - dx;
        let x2 = xe + dx;
        let roots = 0;
        if (Math.abs(x1) <= 1) roots++;
        if (Math.abs(x2) <= 1) roots++;
        if (x1 < -1) x1 = x2;

        if (roots === 1) {
          const eventMs = startMs + (i + x1) * hourMs;
          if (eventMs >= startMs) {
            if (yMinus < 0 && !nextRise) nextRise = new Date(eventMs);
            else if (yMinus >= 0 && !nextSet) nextSet = new Date(eventMs);
          }
        } else if (roots === 2) {
          const riseX = ye < 0 ? x2 : x1;
          const setX = ye < 0 ? x1 : x2;
          const riseMs = startMs + (i + riseX) * hourMs;
          const setMs = startMs + (i + setX) * hourMs;
          if (riseMs >= startMs && !nextRise) nextRise = new Date(riseMs);
          if (setMs >= startMs && !nextSet) nextSet = new Date(setMs);
        }
      }

      if (nextRise && nextSet) break;
      yMinus = yPlus;
    }

    return {
      nextRise,
      nextSet,
      alwaysUp: !nextRise && !nextSet && yMinus >= 0,
      alwaysDown: !nextRise && !nextSet && yMinus < 0,
    };
  }

  function computeGuidance(deviceAz, deviceAlt, moonAz, moonAlt) {
    const dAz = shortestAngleDelta(moonAz, deviceAz);
    const dAlt = moonAlt - deviceAlt;

    const alt1 = deviceAlt * RAD;
    const alt2 = moonAlt * RAD;
    const dLon = dAz * RAD;

    const cosTheta = Math.max(
      -1,
      Math.min(
        1,
        Math.sin(alt1) * Math.sin(alt2) +
          Math.cos(alt1) * Math.cos(alt2) * Math.cos(dLon)
      )
    );
    const angularDistance = Math.acos(cosTheta) * DEG;

    const bearingOnScreenRad = Math.atan2(
      Math.cos(alt2) * Math.sin(dLon),
      Math.cos(alt1) * Math.sin(alt2) -
        Math.sin(alt1) * Math.cos(alt2) * Math.cos(dLon)
    );

    return {
      angularDistance,
      deltaAz: dAz,
      deltaAlt: dAlt,
      bearingOnScreenRad,
      isLockedOn: angularDistance <= 5.0,
    };
  }

  function azimuthToCardinal(az) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(normalizeDegrees(az) / 45) % 8;
    return dirs[idx];
  }

  const exportsObj = {
    toDays,
    fromDays,
    normalizeDegrees,
    shortestAngleDelta,
    moonCoords,
    getMoonPosition,
    getMoonIllumination,
    getMoonTimes,
    computeGuidance,
    azimuthToCardinal,
  };

  root.MoonAstronomy = exportsObj;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
