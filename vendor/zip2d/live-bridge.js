/* Same-origin bridge for parent map focus. Traffic and scenario playback stay in
   the original ZIP simulation engine, preserving its full synthetic network. */
addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'airspace-zip-focus') return;
  const id = String(event.data.id || '');
  if (AP[id]) {
    S.sel = id;
    focusAp(id);
    refreshPanels(true);
  } else if (Number.isFinite(event.data.longitude) && Number.isFinite(event.data.latitude)) {
    cam.x = lon2x(event.data.longitude);
    cam.y = lat2y(event.data.latitude);
    cam.s = Math.max(cam.s, 40);
  }
});

if (new URLSearchParams(location.search).get('mode') === 'demo') {
  document.body.classList.add('portal-demo');
  $('#scenChip').textContent = 'SYNTHETIC TRAFFIC DEMO';
}

/* Publish a bounded, synthetic-only snapshot to the same-origin portal AI. */
const zipMode = new URLSearchParams(location.search).get('mode');
if (zipMode === 'demo' || zipMode === 'simulation') {
  const rad = Math.PI / 180;
  const fromWorld = ([x, y]) => ({ latitude: 50 - y, longitude: x / COSLAT - 125 });
  const trackBetween = (a, b) => {
    const lat1 = a.lat * rad, lat2 = b.lat * rad, dLon = (b.lon - a.lon) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) / rad + 360) % 360;
  };
  const makeSnapshot = () => {
    const sim = S.sim;
    if (!sim || !Array.isArray(LASTHIT)) return;
    const aircraft = LASTHIT.slice(0, 60).map(hit => {
      const f = hit.f, point = fromWorld(hit.p), origin = AP[f.from || f.o], destination = AP[f.d];
      const groundSpeedMs = origin && destination && Number.isFinite(f.dur) && f.dur > 0
        ? distNm(origin, destination) * 1852 / (f.dur * 60)
        : null;
      return {
        id: `zip2d-${f.id}`,
        callsign: f.cs || null,
        latitude: point.latitude,
        longitude: point.longitude,
        altitudeM: null,
        groundSpeedMs,
        trackDeg: origin && destination ? trackBetween(origin, destination) : null,
        status: f.st,
        originAirport: origin?.id ?? null,
        destinationAirport: destination?.id ?? null,
        source: 'AeroFlo ZIP 2D synthetic model',
        positionKind: 'synthetic_demo',
      };
    });
    const activeScenario = S.applied.stack.map(item => ({
      id: item.sid,
      name: SCEN[item.sid]?.name || item.sid,
      startMinute: item.start,
      durationMinutes: item.dur,
      restorationMinutes: item.restore,
    }));
    parent.postMessage({
      type: 'airspace-zip-snapshot',
      source: 'AeroFlo ZIP 2D synthetic model',
      dataKind: 'synthetic_model',
      mode: zipMode,
      mapView: S.view,
      selectedAirport: S.sel,
      currentMinute: sim.t + Math.min(0.999, S.acc),
      activeScenario,
      visibleCount: LASTHIT.length,
      returnedCount: sim.tails.length,
      positionedCount: LASTHIT.length,
      aircraft,
      altitudeAvailability: 'not modeled by the ZIP simulation engine',
      assumptions: [
        'Aircraft schedules, callsigns, and routes are generated deterministically by the ZIP simulation model.',
        'Enroute map positions interpolate linearly between modeled airport coordinates.',
        'Ground speed is estimated from modeled route distance and simulated leg duration.',
        'Altitude is not included in this model.',
      ],
    }, location.origin);
  };
  setInterval(makeSnapshot, 1000);
}
