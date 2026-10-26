import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  getMoonPosition,
  getMoonIllumination,
  getMoonTimes,
  computeGuidance,
  shortestAngleDelta,
  normalizeDegrees,
  azimuthToCardinal,
} = require('../js/astronomy.js');
const { computeOrientationFromEuler } = require('../js/sensors.js');

describe('Astronomy Ephemeris Engine', () => {
  test('normalizeDegrees and shortestAngleDelta handle 0/360 wraparound properly', () => {
    assert.equal(normalizeDegrees(-15), 345);
    assert.equal(normalizeDegrees(370), 10);
    assert.equal(shortestAngleDelta(10, 350), 20);
    assert.equal(shortestAngleDelta(350, 10), -20);
    assert.equal(azimuthToCardinal(0), 'N');
    assert.equal(azimuthToCardinal(90), 'E');
    assert.equal(azimuthToCardinal(225), 'SW');
  });

  test('getMoonPosition returns valid topocentric coordinates and realistic distance', () => {
    const date = new Date('2026-10-26T23:08:09Z');
    const pos = getMoonPosition(date, 37.7749, -122.4194);

    assert.ok(pos.azimuth >= 0 && pos.azimuth < 360, 'Azimuth in [0, 360)');
    assert.ok(
      pos.altitude >= -90 && pos.altitude <= 90,
      'Altitude in [-90, 90]'
    );
    // Lunar perigee ~356,400 km, apogee ~406,700 km
    assert.ok(
      pos.distanceKm >= 355000 && pos.distanceKm <= 408000,
      `Distance ${pos.distanceKm} km should be within lunar orbit bounds`
    );
    assert.equal(pos.isAboveHorizon, pos.altitude >= 0);
  });

  test('getMoonIllumination accurately identifies Full Moon and New Moon epochs', () => {
    // Full Moon on 2026-10-26 ~04:12 UTC
    const fullMoonDate = new Date('2026-10-26T04:12:00Z');
    const fullIllum = getMoonIllumination(fullMoonDate);
    assert.ok(
      fullIllum.percentage >= 98,
      `Expected >=98% illumination at Full Moon, got ${fullIllum.percentage}%`
    );
    assert.equal(fullIllum.phaseName, 'Full Moon');

    // New Moon on 2026-10-10 ~15:50 UTC
    const newMoonDate = new Date('2026-10-10T15:50:00Z');
    const newIllum = getMoonIllumination(newMoonDate);
    assert.ok(
      newIllum.percentage <= 2,
      `Expected <=2% illumination at New Moon, got ${newIllum.percentage}%`
    );
    assert.equal(newIllum.phaseName, 'New Moon');
  });

  test('getMoonTimes finds accurate next moonrise and moonset where altitude crosses horizon', () => {
    const start = new Date('2026-10-26T12:00:00Z');
    const lat = 40.7128; // New York
    const lon = -74.006;
    const times = getMoonTimes(start, lat, lon);

    assert.ok(times.nextRise instanceof Date, 'Should find next moonrise');
    assert.ok(times.nextSet instanceof Date, 'Should find next moonset');
    assert.ok(times.nextRise.getTime() >= start.getTime());
    assert.ok(times.nextSet.getTime() >= start.getTime());

    // Verify Moon altitude at predicted rise time is very close to horizon (~0.125°)
    const risePos = getMoonPosition(times.nextRise, lat, lon);
    assert.ok(
      Math.abs(risePos.altitude - 0.125) < 0.35,
      `Moon altitude at rise (${risePos.altitude.toFixed(2)}°) should be near horizon`
    );
  });

  test('computeGuidance calculates great-circle distance and lock-on threshold', () => {
    // Exact alignment across North wraparound (359° vs 1°, same altitude)
    const g1 = computeGuidance(359, 30, 1, 30);
    assert.ok(g1.angularDistance < 2.0);
    assert.equal(g1.isLockedOn, true);
    assert.equal(g1.deltaAz, 2);

    // 90 degrees apart along horizon
    const g2 = computeGuidance(0, 0, 90, 0);
    assert.ok(Math.abs(g2.angularDistance - 90) < 1e-6);
    assert.equal(g2.isLockedOn, false);
  });
});

describe('3D Sensor Orientation Math', () => {
  test('Wand mode (+y axis): flat phone points horizontally, tilted phone points up', () => {
    // alpha=0 (North), beta=0 (flat), gamma=0
    const flatNorth = computeOrientationFromEuler(0, 0, 0, 'wand', 0);
    assert.ok(Math.abs(flatNorth.azimuth - 0) < 1e-6 || Math.abs(flatNorth.azimuth - 360) < 1e-6);
    assert.ok(Math.abs(flatNorth.altitude - 0) < 1e-6);

    // alpha=270 (clockwise 90° = East), beta=45° (tilted up 45°)
    const tiltedEast = computeOrientationFromEuler(270, 45, 0, 'wand', 0);
    assert.ok(Math.abs(tiltedEast.azimuth - 90) < 1e-5);
    assert.ok(Math.abs(tiltedEast.altitude - 45) < 1e-5);
  });

  test('Camera mode (-z axis): upright vertical phone looks at horizon, tilted back looks up at sky', () => {
    // Phone held vertically facing North (alpha=0, beta=90, gamma=0) -> camera points North at 0° horizon
    const uprightNorth = computeOrientationFromEuler(0, 90, 0, 'camera', 0);
    assert.ok(
      Math.abs(uprightNorth.azimuth - 0) < 1e-5 ||
        Math.abs(uprightNorth.azimuth - 360) < 1e-5
    );
    assert.ok(Math.abs(uprightNorth.altitude - 0) < 1e-5);

    // Phone tilted back to look 35° up into the Northern sky (beta = 90 + 35 = 125°)
    const lookingUp = computeOrientationFromEuler(0, 125, 0, 'camera', 0);
    assert.ok(
      Math.abs(lookingUp.azimuth - 0) < 1e-5 ||
        Math.abs(lookingUp.azimuth - 360) < 1e-5
    );
    assert.ok(Math.abs(lookingUp.altitude - 35) < 1e-5);
  });

  test('Compass calibration offset shifts azimuth accurately', () => {
    const res = computeOrientationFromEuler(0, 0, 0, 'wand', 15);
    assert.ok(Math.abs(res.azimuth - 15) < 1e-5);
  });
});

describe('SkyRenderer 2D Radar & Live AR Rendering', () => {
  test('renders both radar and AR frames (unlocked and locked-on) without errors', async () => {
    // Provide minimal window shim for Node environment
    globalThis.window = {
      devicePixelRatio: 2,
      addEventListener: () => {},
    };

    const { SkyRenderer } = require('../js/renderer.js');

    const drawCalls = [];
    const mockCtx = {
      save: () => drawCalls.push('save'),
      restore: () => drawCalls.push('restore'),
      scale: () => {},
      clearRect: () => drawCalls.push('clearRect'),
      beginPath: () => {},
      closePath: () => {},
      arc: () => drawCalls.push('arc'),
      ellipse: () => drawCalls.push('ellipse'),
      fill: () => drawCalls.push('fill'),
      stroke: () => drawCalls.push('stroke'),
      clip: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillText: (txt) => drawCalls.push(`text:${txt}`),
      setLineDash: () => {},
      translate: () => {},
      rotate: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      parentElement: {
        getBoundingClientRect: () => ({ width: 390, height: 520 }),
      },
      getContext: () => mockCtx,
    };

    const renderer = new SkyRenderer(mockCanvas);
    assert.equal(mockCanvas.width, 780);
    assert.equal(mockCanvas.height, 1040);

    const sampleMoonPos = {
      azimuth: 135,
      altitude: 42,
      isAboveHorizon: true,
    };
    const sampleIllum = { phase: 0.48, fraction: 0.99 };

    // 1. Render 2D Radar View (unlocked)
    renderer.render({
      viewMode: 'radar',
      deviceAz: 180,
      deviceAlt: 20,
      deviceRoll: 0,
      moonPos: sampleMoonPos,
      moonIllum: sampleIllum,
      guidance: computeGuidance(180, 20, 135, 42),
    });
    assert.ok(drawCalls.includes('text:MOON'));

    // 2. Render Live AR View (locked-on)
    drawCalls.length = 0;
    renderer.render({
      viewMode: 'ar',
      deviceAz: 135,
      deviceAlt: 42,
      deviceRoll: 5,
      moonPos: sampleMoonPos,
      moonIllum: sampleIllum,
      guidance: computeGuidance(135, 42, 135, 42),
    });
    assert.ok(drawCalls.some((c) => c.startsWith('text:MOON (')));
  });
});

