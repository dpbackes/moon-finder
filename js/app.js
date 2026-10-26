/**
 * app.js
 * Main application controller for MoonPointer.
 * Works directly via file:// off disk and via http://localhost.
 */
(function (root) {
  'use strict';

  const {
    getMoonPosition,
    getMoonIllumination,
    getMoonTimes,
    computeGuidance,
    azimuthToCardinal,
  } = root.MoonAstronomy;
  const { SensorManager } = root.MoonSensors;
  const { SkyRenderer } = root.MoonRenderer;

  class MoonPointerApp {
    constructor() {
      this.canvas = document.getElementById('sky-canvas');
      this.videoEl = document.getElementById('ar-video');
      this.renderer = new SkyRenderer(this.canvas);
      this.cameraStream = null;

      this.sensorState = null;
      this.moonPos = null;
      this.moonIllum = null;
      this.moonTimes = null;
      this.guidance = null;

      this.lastRiseSetCalcKey = '';
      this.wasLockedOn = false;
      this.lastHapticMs = 0;

      this.sensors = new SensorManager((state) => {
        this.sensorState = state;
        this.updateAstronomy();
        this.updateHUD();
      });

      this._bindDOM();
      this._init();
    }

    _bindDOM() {
      this.btnModeRadar = document.getElementById('btn-mode-radar');
      this.btnModeAR = document.getElementById('btn-mode-ar');

      this.btnModeRadar.addEventListener('click', () =>
        this.switchViewMode('radar')
      );
      this.btnModeAR.addEventListener('click', () => this.switchViewMode('ar'));

      this.permissionModal = document.getElementById('permission-modal');
      this.btnEnableSensors = document.getElementById('btn-enable-sensors');
      this.btnUseSimMode = document.getElementById('btn-use-sim-mode');
      this.sensorPill = document.getElementById('sensor-status-pill');

      this.btnEnableSensors.addEventListener('click', async () => {
        this.permissionModal.classList.add('hidden');
        const result = await this.sensors.startSensors();
        if (!result.granted) {
          this.sensors.setSimulationMode(true);
          this.syncDrawerControls();
        }
      });

      this.btnUseSimMode.addEventListener('click', () => {
        this.permissionModal.classList.add('hidden');
        this.sensors.setSimulationMode(true);
        this.syncDrawerControls();
        this.openDrawer();
      });

      this.sensorPill.addEventListener('click', () => {
        if (
          this.sensorState &&
          this.sensorState.orientationStatus !== 'active' &&
          !this.sensorState.isSimulated
        ) {
          this.permissionModal.classList.remove('hidden');
        } else {
          this.toggleDrawer();
        }
      });

      this.drawer = document.getElementById('sim-drawer');
      this.btnToggleDrawer = document.getElementById('btn-toggle-drawer');
      this.btnCloseDrawer = document.getElementById('btn-close-drawer');

      this.btnToggleDrawer.addEventListener('click', () => this.toggleDrawer());
      this.btnCloseDrawer.addEventListener('click', () => this.closeDrawer());

      this.chkSimMode = document.getElementById('chk-sim-mode');
      this.sliderSimAz = document.getElementById('slider-sim-az');
      this.sliderSimAlt = document.getElementById('slider-sim-alt');
      this.valSimAz = document.getElementById('val-sim-az');
      this.valSimAlt = document.getElementById('val-sim-alt');
      this.btnSnapMoon = document.getElementById('btn-snap-moon');

      this.sliderCompassOffset = document.getElementById(
        'slider-compass-offset'
      );
      this.valCompassOffset = document.getElementById('val-compass-offset');
      this.selectPointingMode = document.getElementById('select-pointing-mode');

      this.inputLat = document.getElementById('input-lat');
      this.inputLon = document.getElementById('input-lon');
      this.btnApplyCoords = document.getElementById('btn-apply-coords');

      this.sliderTimeOffset = document.getElementById('slider-time-offset');
      this.valTimeOffset = document.getElementById('val-time-offset');
      this.btnResetTime = document.getElementById('btn-reset-time');

      this.chkSimMode.addEventListener('change', (e) => {
        this.sensors.setSimulationMode(e.target.checked);
        this.syncDrawerControls();
      });

      this.sliderSimAz.addEventListener('input', (e) => {
        const az = Number(e.target.value);
        this.valSimAz.textContent = `${az}°`;
        this.sensors.setSimulatedOrientation(
          az,
          Number(this.sliderSimAlt.value)
        );
        this.chkSimMode.checked = true;
      });

      this.sliderSimAlt.addEventListener('input', (e) => {
        const alt = Number(e.target.value);
        this.valSimAlt.textContent = `${alt > 0 ? '+' : ''}${alt}°`;
        this.sensors.setSimulatedOrientation(
          Number(this.sliderSimAz.value),
          alt
        );
        this.chkSimMode.checked = true;
      });

      this.btnSnapMoon.addEventListener('click', () => {
        if (!this.moonPos) return;
        const targetAz = Math.round(this.moonPos.azimuth);
        const targetAlt = Math.round(this.moonPos.altitude);
        this.chkSimMode.checked = true;
        this.sliderSimAz.value = String(targetAz);
        this.sliderSimAlt.value = String(targetAlt);
        this.valSimAz.textContent = `${targetAz}°`;
        this.valSimAlt.textContent = `${targetAlt > 0 ? '+' : ''}${targetAlt}°`;
        this.sensors.setCompassOffset(0);
        this.sliderCompassOffset.value = '0';
        this.valCompassOffset.textContent = '0°';
        this.sensors.setSimulatedOrientation(targetAz, targetAlt);
      });

      this.sliderCompassOffset.addEventListener('input', (e) => {
        const offset = Number(e.target.value);
        this.valCompassOffset.textContent = `${
          offset > 0 ? '+' : ''
        }${offset}°`;
        this.sensors.setCompassOffset(offset);
      });

      this.selectPointingMode.addEventListener('change', (e) => {
        this.sensors.setPointingModeOverride(e.target.value);
      });

      this.btnApplyCoords.addEventListener('click', () => {
        this.sensors.setManualLocation(
          Number(this.inputLat.value),
          Number(this.inputLon.value)
        );
      });

      this.sliderTimeOffset.addEventListener('input', (e) => {
        const hrs = Number(e.target.value);
        this.valTimeOffset.textContent =
          hrs === 0 ? 'Now' : `${hrs > 0 ? '+' : ''}${hrs}h`;
        this.sensors.setTimeOffsetMinutes(hrs * 60);
      });

      this.btnResetTime.addEventListener('click', () => {
        this.sliderTimeOffset.value = '0';
        this.valTimeOffset.textContent = 'Now';
        this.sensors.setTimeOffsetMinutes(0);
      });

      this._bindCanvasDrag();

      this.elGuidanceBanner = document.getElementById('guidance-banner');
      this.elGuidancePrimary = document.getElementById('guidance-primary');
      this.elGuidanceSub = document.getElementById('guidance-sub');
      this.elCameraNotice = document.getElementById('camera-notice');

      this.elMoonCoords = document.getElementById('val-moon-coords');
      this.elMoonHorizonTag = document.getElementById('val-moon-horizon');
      this.elDeviceCoords = document.getElementById('val-device-coords');
      this.elAngularDelta = document.getElementById('val-angular-delta');

      this.elPhaseEmoji = document.getElementById('val-phase-emoji');
      this.elPhaseName = document.getElementById('val-phase-name');
      this.elIllumination = document.getElementById('val-illumination');
      this.elDistance = document.getElementById('val-distance');
      this.elNextRise = document.getElementById('val-next-rise');
      this.elNextSet = document.getElementById('val-next-set');
      this.elObserverLoc = document.getElementById('val-observer-loc');
    }

    _bindCanvasDrag() {
      let isDragging = false;
      let lastX = 0;
      let lastY = 0;

      this.canvas.addEventListener('pointerdown', (e) => {
        if (
          !this.sensorState.isSimulated &&
          this.sensorState.orientationStatus === 'active'
        ) {
          return;
        }
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        this.canvas.setPointerCapture(e.pointerId);
      });

      this.canvas.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;

        const newAz = (this.sensorState.simAzimuth + dx * 0.45 + 360) % 360;
        const newAlt = Math.max(
          -90,
          Math.min(90, this.sensorState.simAltitude - dy * 0.45)
        );

        this.sensors.setSimulatedOrientation(newAz, newAlt);
        this.syncDrawerControls();
      });

      const stopDrag = () => {
        isDragging = false;
      };
      this.canvas.addEventListener('pointerup', stopDrag);
      this.canvas.addEventListener('pointercancel', stopDrag);
    }

    _init() {
      this.sensorState = this.sensors.state;
      this.updateAstronomy();
      this.updateHUD();
      this.syncDrawerControls();

      if (!SensorManager.requiresPermissionGesture()) {
        this.sensors.startSensors();
      } else {
        this.permissionModal.classList.remove('hidden');
      }

      setInterval(() => {
        this.updateAstronomy();
        this.updateHUD();
      }, 10000);

      const animate = () => {
        if (this.sensorState && this.moonPos && this.moonIllum && this.guidance) {
          this.renderer.render({
            viewMode: this.sensorState.viewMode,
            deviceAz: this.sensorState.azimuth,
            deviceAlt: this.sensorState.altitude,
            deviceRoll: this.sensorState.roll,
            moonPos: this.moonPos,
            moonIllum: this.moonIllum,
            guidance: this.guidance,
          });
        }
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }

    async switchViewMode(mode) {
      this.sensors.setViewMode(mode);
      this.btnModeRadar.classList.toggle('active', mode === 'radar');
      this.btnModeAR.classList.toggle('active', mode === 'ar');
      this.btnModeRadar.setAttribute('aria-selected', String(mode === 'radar'));
      this.btnModeAR.setAttribute('aria-selected', String(mode === 'ar'));

      if (mode === 'ar') {
        await this._startCamera();
      } else {
        this._stopCamera();
        this.elCameraNotice.classList.add('hidden');
      }
    }

    async _startCamera() {
      if (this.cameraStream) return;
      if (
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        this.elCameraNotice.textContent =
          'Camera requires HTTPS or localhost — showing virtual AR sky overlay.';
        this.elCameraNotice.classList.remove('hidden');
        return;
      }

      try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
          },
          audio: false,
        });
        this.videoEl.srcObject = this.cameraStream;
        this.videoEl.classList.remove('hidden');
        await this.videoEl.play();
        this.elCameraNotice.classList.add('hidden');
      } catch (err) {
        console.warn('Camera access unavailable:', err.message);
        this.elCameraNotice.textContent =
          'Camera permission denied or unavailable — showing virtual AR overlay.';
        this.elCameraNotice.classList.remove('hidden');
      }
    }

    _stopCamera() {
      if (this.cameraStream) {
        for (const track of this.cameraStream.getTracks()) {
          track.stop();
        }
        this.cameraStream = null;
      }
      this.videoEl.srcObject = null;
      this.videoEl.classList.add('hidden');
    }

    toggleDrawer() {
      this.drawer.classList.toggle('open');
    }

    openDrawer() {
      this.drawer.classList.add('open');
    }

    closeDrawer() {
      this.drawer.classList.remove('open');
    }

    syncDrawerControls() {
      if (!this.sensorState) return;
      this.chkSimMode.checked = this.sensorState.isSimulated;
      const az = Math.round(this.sensorState.simAzimuth);
      const alt = Math.round(this.sensorState.simAltitude);
      this.sliderSimAz.value = String(az);
      this.sliderSimAlt.value = String(alt);
      this.valSimAz.textContent = `${az}°`;
      this.valSimAlt.textContent = `${alt > 0 ? '+' : ''}${alt}°`;
      this.inputLat.value = this.sensorState.lat.toFixed(4);
      this.inputLon.value = this.sensorState.lon.toFixed(4);
    }

    updateAstronomy() {
      if (!this.sensorState) return;
      const now = new Date(
        Date.now() + this.sensorState.simTimeOffsetMinutes * 60 * 1000
      );
      const { lat, lon, azimuth, altitude } = this.sensorState;

      this.moonPos = getMoonPosition(now, lat, lon);
      this.moonIllum = getMoonIllumination(now);
      this.guidance = computeGuidance(
        azimuth,
        altitude,
        this.moonPos.azimuth,
        this.moonPos.altitude
      );

      const riseSetKey = `${lat.toFixed(2)}_${lon.toFixed(2)}_${Math.floor(
        now.getTime() / (10 * 60 * 1000)
      )}`;
      if (riseSetKey !== this.lastRiseSetCalcKey) {
        this.lastRiseSetCalcKey = riseSetKey;
        this.moonTimes = getMoonTimes(now, lat, lon);
      }

      if (this.guidance.isLockedOn && !this.wasLockedOn) {
        const nowMs = Date.now();
        if (nowMs - this.lastHapticMs > 1500 && 'vibrate' in navigator) {
          try {
            navigator.vibrate([45, 30, 65]);
          } catch {
            // Ignore vibration errors
          }
          this.lastHapticMs = nowMs;
        }
      }
      this.wasLockedOn = this.guidance.isLockedOn;
    }

    updateHUD() {
      if (
        !this.sensorState ||
        !this.moonPos ||
        !this.moonIllum ||
        !this.guidance
      ) {
        return;
      }

      const { orientationStatus, gpsStatus, isSimulated } = this.sensorState;
      if (isSimulated) {
        this.sensorPill.textContent = 'SIMULATION MODE';
        this.sensorPill.className = 'status-pill status-sim';
      } else if (orientationStatus === 'active' && gpsStatus === 'active') {
        this.sensorPill.textContent = 'GPS + IMU LIVE';
        this.sensorPill.className = 'status-pill status-live';
      } else if (orientationStatus === 'active') {
        this.sensorPill.textContent = 'IMU LIVE • GPS DEFAULT';
        this.sensorPill.className = 'status-pill status-partial';
      } else {
        this.sensorPill.textContent = 'DRAG RADAR OR CALIBRATE';
        this.sensorPill.className = 'status-pill status-sim';
      }

      const { isLockedOn, deltaAz, deltaAlt, angularDistance } = this.guidance;
      this.elGuidanceBanner.classList.toggle('locked-on', isLockedOn);
      document.body.classList.toggle('moon-locked', isLockedOn);

      if (isLockedOn) {
        this.elGuidancePrimary.textContent = '🌕 LOCKED ONTO THE MOON!';
        this.elGuidanceSub.textContent = this.moonPos.isAboveHorizon
          ? `Aligned within ${angularDistance.toFixed(1)}° — look directly along your phone`
          : `Aligned within ${angularDistance.toFixed(1)}° (Moon is currently below the horizon)`;
      } else {
        const horizInstruction =
          Math.abs(deltaAz) < 3
            ? 'Heading Aligned'
            : deltaAz > 0
            ? `Turn Right ${Math.round(Math.abs(deltaAz))}°`
            : `Turn Left ${Math.round(Math.abs(deltaAz))}°`;

        const vertInstruction =
          Math.abs(deltaAlt) < 3
            ? 'Tilt Aligned'
            : deltaAlt > 0
            ? `Tilt Up ${Math.round(Math.abs(deltaAlt))}°`
            : `Tilt Down ${Math.round(Math.abs(deltaAlt))}°`;

        this.elGuidancePrimary.textContent = `${horizInstruction}  •  ${vertInstruction}`;
        this.elGuidanceSub.textContent = `${angularDistance.toFixed(1)}° angular separation from Moon (drag radar to rotate)`;
      }

      const moonCard = azimuthToCardinal(this.moonPos.azimuth);
      const devCard = azimuthToCardinal(this.sensorState.azimuth);

      this.elMoonCoords.textContent = `${Math.round(
        this.moonPos.azimuth
      )}° ${moonCard} / ${
        this.moonPos.altitude >= 0 ? '+' : ''
      }${this.moonPos.altitude.toFixed(1)}°`;

      this.elMoonHorizonTag.textContent = this.moonPos.isAboveHorizon
        ? 'Above Horizon'
        : 'Below Horizon';
      this.elMoonHorizonTag.className = this.moonPos.isAboveHorizon
        ? 'badge badge-up'
        : 'badge badge-down';

      this.elDeviceCoords.textContent = `${Math.round(
        this.sensorState.azimuth
      )}° ${devCard} / ${
        this.sensorState.altitude >= 0 ? '+' : ''
      }${this.sensorState.altitude.toFixed(1)}°`;

      this.elAngularDelta.textContent = `${angularDistance.toFixed(1)}° off target`;

      this.elPhaseEmoji.textContent = this.moonIllum.phaseEmoji;
      this.elPhaseName.textContent = this.moonIllum.phaseName;
      this.elIllumination.textContent = `${this.moonIllum.percentage}% Illuminated`;
      this.elDistance.textContent = `${this.moonPos.distanceKm.toLocaleString()} km`;

      if (this.moonTimes) {
        this.elNextRise.textContent = this._formatEventTime(
          this.moonTimes.nextRise
        );
        this.elNextSet.textContent = this._formatEventTime(
          this.moonTimes.nextSet
        );
      }

      const latDir = this.sensorState.lat >= 0 ? 'N' : 'S';
      const lonDir = this.sensorState.lon >= 0 ? 'E' : 'W';
      this.elObserverLoc.textContent = `${Math.abs(
        this.sensorState.lat
      ).toFixed(2)}°${latDir}, ${Math.abs(this.sensorState.lon).toFixed(
        2
      )}°${lonDir}`;
    }

    _formatEventTime(dateObj) {
      if (!dateObj) return '—';
      const now = new Date(
        Date.now() + (this.sensorState?.simTimeOffsetMinutes || 0) * 60 * 1000
      );
      const isTomorrow = dateObj.getDate() !== now.getDate();
      const timeStr = dateObj.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      return isTomorrow ? `${timeStr} (+1d)` : timeStr;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.moonApp = new MoonPointerApp();
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
