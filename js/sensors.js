/**
 * sensors.js
 * Cross-platform GPS & 3D Device Orientation sensor fusion manager.
 * Works directly via file:// in browsers and in Node.js tests.
 */
(function (root) {
  'use strict';

  const Astronomy =
    root.MoonAstronomy ||
    (typeof require === 'function' ? require('./astronomy.js') : null);
  const { normalizeDegrees, shortestAngleDelta } = Astronomy;

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  function computeOrientationFromEuler(
    alpha,
    beta,
    gamma,
    pointingMode = 'wand',
    compassOffsetDeg = 0
  ) {
    const a = (alpha || 0) * RAD;
    const b = (beta || 0) * RAD;
    const g = (gamma || 0) * RAD;

    const cA = Math.cos(a);
    const sA = Math.sin(a);
    const cB = Math.cos(b);
    const sB = Math.sin(b);
    const cG = Math.cos(g);
    const sG = Math.sin(g);

    // Column 0: device +x axis in ENU
    const xU = -cB * sG;

    // Column 1: device +y axis (top edge of phone) in ENU
    const yE = -sA * cB;
    const yN = cA * cB;
    const yU = sB;

    // Column 2: device +z axis (out of front screen) in ENU
    const zE = cA * sG + sA * sB * cG;
    const zN = sA * sG - cA * sB * cG;
    const zU = cB * cG;

    let forwardE, forwardN, forwardU;

    if (pointingMode === 'camera') {
      forwardE = -zE;
      forwardN = -zN;
      forwardU = -zU;

      const horizMag = Math.hypot(forwardE, forwardN);
      if (horizMag < 1e-4) {
        forwardE = yE;
        forwardN = yN;
      }
    } else {
      forwardE = yE;
      forwardN = yN;
      forwardU = yU;

      const horizMag = Math.hypot(forwardE, forwardN);
      if (horizMag < 1e-4) {
        forwardE = -zE;
        forwardN = -zN;
      }
    }

    const rawAzimuth = Math.atan2(forwardE, forwardN) * DEG;
    const azimuth = normalizeDegrees(rawAzimuth + compassOffsetDeg);

    const clampedU = Math.max(-1, Math.min(1, forwardU));
    const altitude = Math.asin(clampedU) * DEG;

    const roll = Math.atan2(xU, yU) * DEG;

    return {
      azimuth,
      altitude,
      roll,
    };
  }

  class SensorManager {
    constructor(onUpdate) {
      this.onUpdate = onUpdate;

      this.state = {
        lat: 37.7749,
        lon: -122.4194,
        gpsStatus: 'pending',
        gpsAccuracyMeters: null,

        azimuth: 180,
        altitude: 25,
        roll: 0,
        orientationStatus: 'waiting',
        isAbsoluteCompass: false,

        viewMode: 'radar',
        pointingModeOverride: 'auto',
        compassOffset: 0,
        isSimulated: false,

        simAzimuth: 180,
        simAltitude: 25,
        simTimeOffsetMinutes: 0,
      };

      this._lastEuler = { alpha: 180, beta: 25, gamma: 0, hasReading: false };
      this._iosAlphaOffset = 0;
      this._watchId = null;
      this._boundOrientationHandler = this._handleOrientation.bind(this);
      this._boundAbsoluteHandler = this._handleAbsoluteOrientation.bind(this);
    }

    static requiresPermissionGesture() {
      return (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      );
    }

    async startSensors() {
      this.startGeolocation();

      if (
        typeof window === 'undefined' ||
        !('DeviceOrientationEvent' in window)
      ) {
        this.state.orientationStatus = 'unsupported';
        this._emit();
        return { granted: false, reason: 'unsupported' };
      }

      try {
        if (SensorManager.requiresPermissionGesture()) {
          const response = await DeviceOrientationEvent.requestPermission();
          if (response !== 'granted') {
            this.state.orientationStatus = 'unsupported';
            this._emit();
            return { granted: false, reason: 'denied' };
          }
        }

        if ('ondeviceorientationabsolute' in window) {
          window.addEventListener(
            'deviceorientationabsolute',
            this._boundAbsoluteHandler,
            true
          );
        }
        window.addEventListener(
          'deviceorientation',
          this._boundOrientationHandler,
          true
        );

        return { granted: true };
      } catch (err) {
        console.warn('Orientation permission request failed:', err);
        this.state.orientationStatus = 'unsupported';
        this._emit();
        return { granted: false, reason: err.message };
      }
    }

    startGeolocation() {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        this.state.gpsStatus = 'error';
        this._emit();
        return;
      }

      if (this._watchId !== null) {
        navigator.geolocation.clearWatch(this._watchId);
      }

      this._watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!this.state.isSimulated) {
            this.state.lat = pos.coords.latitude;
            this.state.lon = pos.coords.longitude;
            this.state.gpsAccuracyMeters = Math.round(pos.coords.accuracy || 0);
            this.state.gpsStatus = 'active';
            this._emit();
          }
        },
        (err) => {
          console.warn('Geolocation warning:', err.message);
          if (this.state.gpsStatus === 'pending') {
            this.state.gpsStatus = 'error';
            this._emit();
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: 12000,
        }
      );
    }

    _handleAbsoluteOrientation(event) {
      if (event.alpha === null && event.beta === null) return;
      this.state.isAbsoluteCompass = true;
      this._processOrientationEvent(event, true);
    }

    _handleOrientation(event) {
      if (
        this.state.isAbsoluteCompass &&
        event.absolute !== true &&
        typeof event.webkitCompassHeading !== 'number'
      ) {
        return;
      }
      this._processOrientationEvent(event, false);
    }

    _processOrientationEvent(event, isFromAbsoluteListener) {
      if (this.state.isSimulated) return;
      if (event.alpha === null && event.beta === null && event.gamma === null) {
        return;
      }

      let alpha = event.alpha ?? 0;
      const beta = event.beta ?? 0;
      const gamma = event.gamma ?? 0;

      if (
        typeof event.webkitCompassHeading === 'number' &&
        !Number.isNaN(event.webkitCompassHeading)
      ) {
        this.state.isAbsoluteCompass = true;
        const targetAlpha = normalizeDegrees(360 - event.webkitCompassHeading);
        if (Math.abs(beta) < 75 && Math.abs(gamma) < 75) {
          this._iosAlphaOffset = shortestAngleDelta(targetAlpha, alpha);
        }
        alpha = normalizeDegrees(alpha + this._iosAlphaOffset);
      } else if (isFromAbsoluteListener || event.absolute === true) {
        this.state.isAbsoluteCompass = true;
      }

      this._lastEuler = { alpha, beta, gamma, hasReading: true };
      this.state.orientationStatus = 'active';
      this._recomputeFromEuler(true);
    }

    _getEffectivePointingMode() {
      if (this.state.pointingModeOverride !== 'auto') {
        return this.state.pointingModeOverride;
      }
      return this.state.viewMode === 'ar' ? 'camera' : 'wand';
    }

    _recomputeFromEuler(applySmoothing = true) {
      if (this.state.isSimulated) {
        this.state.azimuth = normalizeDegrees(
          this.state.simAzimuth + this.state.compassOffset
        );
        this.state.altitude = this.state.simAltitude;
        this.state.roll = 0;
        this._emit();
        return;
      }

      if (!this._lastEuler.hasReading) {
        this._emit();
        return;
      }

      const mode = this._getEffectivePointingMode();
      const { azimuth, altitude, roll } = computeOrientationFromEuler(
        this._lastEuler.alpha,
        this._lastEuler.beta,
        this._lastEuler.gamma,
        mode,
        this.state.compassOffset
      );

      if (applySmoothing) {
        const smoothFactor = 0.28;
        const dAz = shortestAngleDelta(azimuth, this.state.azimuth);
        this.state.azimuth = normalizeDegrees(
          this.state.azimuth + dAz * smoothFactor
        );
        this.state.altitude =
          this.state.altitude + (altitude - this.state.altitude) * smoothFactor;
        const dRoll = shortestAngleDelta(roll, this.state.roll);
        this.state.roll = this.state.roll + dRoll * smoothFactor;
      } else {
        this.state.azimuth = azimuth;
        this.state.altitude = altitude;
        this.state.roll = roll;
      }

      this._emit();
    }

    setViewMode(viewMode) {
      this.state.viewMode = viewMode;
      this._recomputeFromEuler(false);
    }

    setPointingModeOverride(mode) {
      this.state.pointingModeOverride = mode;
      this._recomputeFromEuler(false);
    }

    setCompassOffset(offsetDeg) {
      this.state.compassOffset = Number(offsetDeg) || 0;
      this._recomputeFromEuler(false);
    }

    setSimulationMode(enabled) {
      this.state.isSimulated = Boolean(enabled);
      if (this.state.isSimulated) {
        this.state.orientationStatus = 'simulated';
        this.state.gpsStatus = 'simulated';
        this.state.azimuth = normalizeDegrees(
          this.state.simAzimuth + this.state.compassOffset
        );
        this.state.altitude = this.state.simAltitude;
        this.state.roll = 0;
      } else {
        this.state.orientationStatus = this._lastEuler.hasReading
          ? 'active'
          : 'waiting';
        this._recomputeFromEuler(false);
      }
      this._emit();
    }

    setSimulatedOrientation(azimuth, altitude) {
      this.state.simAzimuth = normalizeDegrees(Number(azimuth) || 0);
      this.state.simAltitude = Math.max(
        -90,
        Math.min(90, Number(altitude) || 0)
      );
      if (!this.state.isSimulated) {
        this.setSimulationMode(true);
      } else {
        this._recomputeFromEuler(false);
      }
    }

    setManualLocation(lat, lon) {
      const parsedLat = Number(lat);
      const parsedLon = Number(lon);
      if (!Number.isNaN(parsedLat) && !Number.isNaN(parsedLon)) {
        this.state.lat = Math.max(-90, Math.min(90, parsedLat));
        this.state.lon = Math.max(-180, Math.min(180, parsedLon));
        if (this.state.gpsStatus !== 'active') {
          this.state.gpsStatus = 'simulated';
        }
        this._emit();
      }
    }

    setTimeOffsetMinutes(minutes) {
      this.state.simTimeOffsetMinutes = Number(minutes) || 0;
      this._emit();
    }

    _emit() {
      if (typeof this.onUpdate === 'function') {
        this.onUpdate({ ...this.state });
      }
    }
  }

  const exportsObj = {
    computeOrientationFromEuler,
    SensorManager,
  };

  root.MoonSensors = exportsObj;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
