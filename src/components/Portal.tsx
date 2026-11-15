import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, ChevronDown, FlaskConical, Globe2, Info, Layers3, MapPin, Minus, Pause, Plane, Play, Plus, RotateCcw, Search, X } from "lucide-react";
import { CesiumMap, type MapHandle } from "./CesiumMap";
import { Assistant } from "./Assistant";
import { JFK, findLocation, locations } from "../data/locations";
import { altitudeM, POSITION_UPDATE_INTERVAL_MS } from "../data/flightMath";
import { DEMO_LOOP_SECONDS, demoTrafficAt } from "../data/demoTraffic";
import { GROQ_API_KEYS_URL, isLocalDevelopment, VERCEL_ENVIRONMENT_SETTINGS_URL } from "../data/setup";
import { customScenario, presets, scenarioEstimate, scenarioFromProposal, simulationAircraft, simulationTrails } from "../sim/engine";
import type { Aircraft, AssetStatus, EventType, Location, MapKind, Mode, Scenario, ScenarioProposal, Trails } from "../types";

type Panel = "overview" | "details" | "flights" | "simulation" | "assistant" | "status" | "help";
type ServerStatus = { server: string; ai: { configured: boolean; state: string; provider: string } };
type Zip2DSnapshot = {
  mode: Mode;
  mapView: string;
  selectedAirport: string;
  currentMinute: number;
  visibleCount: number;
  returnedCount: number;
  positionedCount: number;
  aircraft: Array<{ id: string; callsign: string | null; latitude: number; longitude: number; altitudeM: null; groundSpeedMs: number | null; trackDeg: number | null; status: string; originAirport: string | null; destinationAirport: string | null; source: string; positionKind: "synthetic_demo" }>;
  altitudeAvailability: string;
  activeScenario: Array<{ id: string; name: string; startMinute: number; durationMinutes: number; restorationMinutes: number }>;
  assumptions: string[];
};
const eventLabels: Record<EventType, string> = { none: "No event", runway_closure: "Hypothetical runway closure", weather_delay: "Hypothetical weather delay", traffic_surge: "Synthetic traffic surge", generic_disruption: "Generic disruption" };
const formatTime = (value: number | null) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Unavailable";
const defaultAssets: AssetStatus = { imagery: "loading", terrain: "loading", buildings: "loading", model: "loading", message: null };
const initialQuery = new URLSearchParams(window.location.search);

export function Portal() {
  const initialMode: Mode = initialQuery.get("mode") === "simulation" ? "simulation" : "demo";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [mapKind, setMapKind] = useState<MapKind>(initialQuery.get("view") === "us" ? "us" : "local");
  const [panel, setPanel] = useState<Panel>(initialQuery.get("panel") === "status" ? "status" : initialQuery.get("panel") === "help" ? "help" : initialMode === "simulation" ? "simulation" : "overview");
  const [location, setLocation] = useState<Location>(JFK);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [demoPlayhead, setDemoPlayhead] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(true);
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [assets, setAssets] = useState<AssetStatus>(defaultAssets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paths, setPaths] = useState<"all" | "selected" | "off">("selected");
  const [scenarios, setScenarios] = useState<Scenario[]>(presets);
  const [scenario, setScenario] = useState<Scenario>(presets[0]);
  const [compareId, setCompareId] = useState<string>(presets[2].id);
  const [simElapsed, setSimElapsed] = useState(0);
  const [simRunning, setSimRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [customOpen, setCustomOpen] = useState(false);
  const [customLocation, setCustomLocation] = useState("JFK");
  const [customEvent, setCustomEvent] = useState<EventType>("runway_closure");
  const [customDuration, setCustomDuration] = useState(30);
  const [customCount, setCustomCount] = useState(10);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null);
  const [zip2dSnapshot, setZip2dSnapshot] = useState<Zip2DSnapshot | null>(null);
  const mapRef = useRef<MapHandle>(null);
  const zipFrameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== zipFrameRef.current?.contentWindow) return;
      if (event.data?.type === "airspace-zip-selected" && (typeof event.data.id === "string" || event.data.id === null)) setSelectedId(event.data.id);
      const data = event.data;
      if (data?.type === "airspace-zip-snapshot" && data.dataKind === "synthetic_model"
        && (data.mode === "demo" || data.mode === "simulation")
        && Number.isFinite(data.currentMinute) && Number.isInteger(data.visibleCount)
        && Number.isInteger(data.returnedCount) && Number.isInteger(data.positionedCount)
        && Array.isArray(data.aircraft) && data.aircraft.length <= 60
        && data.aircraft.every((plane: Zip2DSnapshot["aircraft"][number]) => typeof plane.id === "string"
          && Number.isFinite(plane.latitude) && plane.latitude >= -90 && plane.latitude <= 90
          && Number.isFinite(plane.longitude) && plane.longitude >= -180 && plane.longitude <= 180
          && (plane.groundSpeedMs === null || Number.isFinite(plane.groundSpeedMs)))
        && Array.isArray(data.activeScenario) && Array.isArray(data.assumptions)) {
        setZip2dSnapshot(data as Zip2DSnapshot);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    fetch("/api/status").then(r => r.json()).then(setServerStatus).catch(() => setServerStatus(null));
  }, []);
  useEffect(() => {
    if (mode !== "demo" || !demoPlaying) return;
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const delta = Math.max(0, now - previous) / 1000 * demoSpeed;
      previous = now;
      if (!document.hidden) setDemoPlayhead(value => (value + delta) % DEMO_LOOP_SECONDS);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode, demoPlaying, demoSpeed]);
  useEffect(() => {
    if (!simRunning || mode !== "simulation") return;
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (!document.hidden) setSimElapsed(value => Math.min(scenario.durationMinutes * 60, value + (now - previous) * simSpeed / 1000));
      previous = now;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [simRunning, simSpeed, mode, scenario.durationMinutes]);
  useEffect(() => { if (simElapsed >= scenario.durationMinutes * 60 && simRunning) setSimRunning(false); }, [simElapsed, simRunning, scenario.durationMinutes]);

  const simulationPositionTime = Math.floor(simElapsed / (POSITION_UPDATE_INTERVAL_MS / 1000)) * (POSITION_UPDATE_INTERVAL_MS / 1000);
  const traffic = useMemo(() => demoTrafficAt(demoPlayhead, mapKind, location), [demoPlayhead, mapKind, location.lat, location.lon, location.id]);
  const aircraft = mode === "simulation" ? simulationAircraft(scenario, simulationPositionTime) : traffic.aircraft;
  const trails: Trails = mode === "simulation" ? simulationTrails(scenario, simulationPositionTime) : traffic.trails;
  const positioned = aircraft.filter(a => a.latitude !== null && a.longitude !== null);
  const visible = visibleIds ? positioned.filter(a => visibleIds.includes(a.id)) : bounds ? positioned.filter(a => a.latitude! >= bounds[0] && a.longitude! >= bounds[1] && a.latitude! <= bounds[2] && a.longitude! <= bounds[3]) : positioned;
  const selected = aircraft.find(a => a.id === selectedId) ?? null;
  const sourceText = mode === "simulation" ? "AeroFlo simulation" : "AeroFlo synthetic demo";
  const dataState = mode === "simulation" ? "simulation" : "synthetic demo";
  const polling = mode === "simulation" ? "simulation controls" : demoPlaying ? "looping · 8-minute demo" : "paused · demo";
  const searchMatches = searchText.trim() ? locations.filter(place => `${place.id} ${place.city} ${place.name}`.toLowerCase().includes(searchText.trim().toLowerCase())).slice(0, 6) : [];

  function changeMode(next: Mode) { setMode(next); setSelectedId(null); setZip2dSnapshot(null); setPanel(mapKind === "us" ? "details" : next === "simulation" ? "simulation" : "overview"); }
  function chooseLocation(place: Location) { setLocation(place); setSearchText(""); setSearchOpen(false); setSearchError(null); mapRef.current?.flyTo(place); zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-focus", id: place.id, latitude: place.lat, longitude: place.lon }, window.location.origin); }
  async function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const known = findLocation(searchText);
    if (known) { chooseLocation(known); return; }
    try {
      const result = await mapRef.current?.search(searchText);
      if (!result) throw new Error("Map search is not ready yet.");
      setLocation({ id: result.label, name: result.label, city: result.label, lat: result.latitude, lon: result.longitude });
      setSearchText(""); setSearchOpen(false); setSearchError(null);
    } catch (error) { setSearchError(error instanceof Error ? error.message : "Search failed."); }
  }
  function go(panelName: Panel, view?: MapKind) {
    if (view) { setMapKind(view); setBounds(null); setPanel("details"); return; }
    if (mapKind === "us" && panelName === "assistant") { setPanel(panelName); return; }
    if (mapKind === "us") setMapKind("local");
    if (panelName === "simulation") { setMode("simulation"); setSelectedId(null); setPanel("simulation"); }
    else setPanel(panelName);
  }
  function selectScenario(next: Scenario) { setScenario(next); setSimElapsed(0); setSimRunning(false); setSelectedId(null); const place = locations.find(x => x.id === next.locationId) ?? JFK; setLocation(place); if (next.pattern === "cross_country") setMapKind("us"); else setMapKind("local"); }
  function runProposal(proposal: ScenarioProposal) { const next = scenarioFromProposal(proposal); setScenarios(previous => [...previous, next]); selectScenario(next); setMode("simulation"); setPanel("simulation"); }
  function createCustom(event: React.FormEvent) { event.preventDefault(); const next = customScenario({ locationId: customLocation, eventType: customEvent, durationMinutes: customDuration, syntheticAircraftCount: customCount }); setScenarios(previous => [...previous, next]); selectScenario(next); setMode("simulation"); setPanel("simulation"); setCustomOpen(false); }
  const contextAircraft = mapKind === "us" ? positioned : visible;
  const localAiContext = { mode, view: mapKind, location: `${location.name} (${location.id})`, sourceTimestamp: null, playbackSeconds: mode === "demo" ? demoPlayhead : null, loopDurationSeconds: mode === "demo" ? DEMO_LOOP_SECONDS : null, dataState, visibleCount: contextAircraft.length, aircraft: contextAircraft.slice(0, 30).map(a => ({ id: a.id, callsign: a.callsign, latitude: a.latitude, longitude: a.longitude, altitudeM: a.geoAltitudeM ?? a.baroAltitudeM, groundSpeedMs: a.groundSpeedMs, trackDeg: a.trackDeg, positionTime: a.positionTime, positionKind: a.positionKind })) };
  const aiContext = mapKind === "us" ? {
    mode, view: "us", location: `${zip2dSnapshot?.selectedAirport ?? "JFK"} · U.S. network`, sourceTimestamp: null,
    dataState: "ZIP 2D synthetic model", visibleCount: zip2dSnapshot?.visibleCount ?? 0,
    returnedCount: zip2dSnapshot?.returnedCount ?? 0, positionedCount: zip2dSnapshot?.positionedCount ?? 0,
    selectedAircraftId: selectedId, selectedAirport: zip2dSnapshot?.selectedAirport ?? "JFK",
    mapView: zip2dSnapshot?.mapView ?? "network", modelMinute: zip2dSnapshot?.currentMinute ?? null,
    altitudeAvailability: zip2dSnapshot?.altitudeAvailability ?? "not modeled by the ZIP simulation engine",
    activeScenario: zip2dSnapshot?.activeScenario ?? [], assumptions: zip2dSnapshot?.assumptions ?? [],
    aircraft: zip2dSnapshot?.aircraft.slice(0, 30) ?? [],
  } : localAiContext;
  const currentEstimate = scenarioEstimate(scenario);
  const comparison = scenarios.find(x => x.id === compareId && x.id !== scenario.id) ?? scenarios.find(x => x.id !== scenario.id)!;
  const comparisonEstimate = scenarioEstimate(comparison);
  const scenarioLocation = locations.find(place => place.id === scenario.locationId) ?? JFK;

  return <div className="portal">
    <aside className="portal-sidebar"><a className="portal-brand" href="/"><span className="brand-glyph"><Plane size={20} fill="currentColor"/></span><span>AeroFlo</span></a><div className="sidebar-caption">FLIGHT RESEARCH</div><nav aria-label="Portal navigation"><button className={panel === "overview" ? "active" : ""} onClick={() => go("overview")}>Overview</button><button className={mapKind === "local" && panel === "details" ? "active" : ""} onClick={() => go("details", "local")}>Local 3D</button><button className={mapKind === "us" && panel === "details" ? "active" : ""} onClick={() => go("details", "us")}>US 2D</button><button className={panel === "flights" ? "active" : ""} onClick={() => go("flights")}>Flights</button><button className={panel === "simulation" ? "active" : ""} onClick={() => go("simulation")}>Simulation</button><button className={panel === "assistant" ? "active" : ""} onClick={() => go("assistant")}>AI Assistant</button><button className={panel === "status" ? "active" : ""} onClick={() => go("status")}>Data Status</button></nav><div className="sidebar-bottom"><button onClick={() => go("help")}>Setup & help</button><a href="/"><ArrowLeft size={16}/> Landing page</a></div></aside>
    <div className="portal-main"><header className="portal-header"><div className="mobile-brand">AeroFlo</div><form className="portal-search" onSubmit={submitSearch}><Search size={18}/><input aria-label="Search airport or city" placeholder="Search airport or city · JFK, New York…" value={searchText} onChange={event => { setSearchText(event.target.value); setSearchOpen(true); setSearchError(null); }}/><button type="submit" aria-label="Search location"><ArrowRight size={17}/></button>{searchOpen && searchMatches.length > 0 && <div className="search-menu">{searchMatches.map(place => <button key={place.id} type="button" onClick={() => chooseLocation(place)}><MapPin size={16}/><span><strong>{place.id}</strong> {place.name}<small>{place.city}</small></span></button>)}</div>}</form><div className="mode-switch" role="group" aria-label="Data mode"><button aria-pressed={mode === "demo"} onClick={() => changeMode("demo")}><span className="mode-indicator"/> Synthetic Demo</button><button aria-pressed={mode === "simulation"} onClick={() => changeMode("simulation")}>Simulation</button></div><button className="top-assistant" onClick={() => setPanel(panel === "assistant" ? "details" : "assistant")} aria-label={panel === "assistant" ? "Close AI assistant" : "Open AI assistant"}><span>Assistant</span></button></header>
      {searchError && <div className="search-error" role="alert">{searchError}<button onClick={() => setSearchError(null)} aria-label="Dismiss search error"><X size={15}/></button></div>}
      {mapKind === "us" ? <iframe key={mode} ref={zipFrameRef} className="zip2d-frame" title="Original ZIP 2D flight workspace" src={`/zip2d/airspace.html?mode=${mode}`} onLoad={() => setZip2dSnapshot(null)}/> : <div className="portal-content"><main className="map-column"><div className="map-shell"><CesiumMap ref={mapRef} kind="local" location={location} aircraft={aircraft} trails={trails} selectedId={selectedId} paths={paths} animatePositions={true} motionRate={mode === "simulation" ? (simRunning ? simSpeed : 0) : 1} onSelect={id => { setSelectedId(id); setPanel("details"); }} onStatus={setAssets} onBounds={setBounds} onVisibleIds={setVisibleIds}/><div className="map-top-left"><span className="eyeline">LOCAL AIRSPACE / 3D</span><h1>{`${location.city} · ${location.id}`}</h1><span className="map-subline">{mode === "simulation" ? <><span className="status-dot purple"/> SIMULATION · synthetic traffic</> : <><span className="status-dot good"/> SYNTHETIC DEMO · 8-minute loop</>}</span></div><div className="map-top-right"><div><strong>{visible.length}</strong><span>aircraft in view</span></div><button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}><Plus size={18}/></button><button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}><Minus size={18}/></button><button aria-label="Reset map view" onClick={() => mapRef.current?.reset()}><RotateCcw size={17}/></button></div>{mode === "simulation" && <span className="map-sim-watermark">SIMULATION</span>}{assets.message && <div className="map-asset-note" role="status"><Info size={15}/>{assets.message}</div>}<div className="map-attribution-note">{assets.imagery === "ion" ? "Cesium aerial imagery" : assets.imagery === "osm" ? <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · street map</a> : assets.imagery === "fallback" ? "Natural Earth fallback · no street detail" : assets.imagery === "error" ? "Imagery unavailable" : "Imagery loading"}{mapKind === "local" && <> · {assets.terrain === "ion" ? "world terrain" : "ellipsoid"}</>}</div></div>
          <div className="map-lower"><div className="map-data-strip"><div><span className="strip-label">SOURCE</span><strong>{sourceText}</strong></div><div><span className="strip-label">{mode === "simulation" ? "SCENARIO TIME" : "DEMO PLAYHEAD"}</span><strong>{mode === "simulation" ? `${Math.floor(simElapsed / 60).toString().padStart(2, "0")}:${Math.floor(simElapsed % 60).toString().padStart(2, "0")}` : `${Math.floor(demoPlayhead / 60).toString().padStart(2, "0")}:${Math.floor(demoPlayhead % 60).toString().padStart(2, "0")} / 08:00`}</strong></div><div><span className="strip-label">{mode === "simulation" ? "STATE" : "PLAYBACK"}</span><strong>{mode === "simulation" ? simRunning ? "Running" : simElapsed ? "Paused" : "Ready" : demoPlaying ? "Looping" : "Paused"}</strong></div><div><span className="strip-label">CLOCK</span><strong>{polling}</strong></div></div><div className="map-legend"><span><Plane size={15}/> Aircraft</span><span><i className="legend-line"/> Path</span><span><i className="legend-dot amber"/> Stale / estimated</span><span><i className="legend-dot purple"/> Simulated</span><span><i className="legend-dot lime"/> Selected</span><div className="path-control"><span>Paths</span><button aria-pressed={paths === "all"} onClick={() => setPaths("all")}>All</button><button aria-pressed={paths === "selected"} onClick={() => setPaths("selected")}>Selected</button><button aria-pressed={paths === "off"} onClick={() => setPaths("off")}>Off</button></div></div>
            {mode === "simulation" ? <div className="timeline"><span className="sim-tag">SIMULATION</span><button className="timeline-play" onClick={() => setSimRunning(value => !value)} aria-label={simRunning ? "Pause simulation" : simElapsed ? "Resume simulation" : "Start simulation"}>{simRunning ? <Pause size={17}/> : <Play size={17} fill="currentColor"/>}</button><input type="range" aria-label="Simulation time" min={0} max={scenario.durationMinutes * 60} step={1} value={simElapsed} onChange={event => { setSimElapsed(Number(event.target.value)); setSimRunning(false); }}/><span className="timeline-time">{Math.floor(simElapsed / 60)} / {scenario.durationMinutes} min</span><select aria-label="Simulation speed" value={simSpeed} onChange={event => setSimSpeed(Number(event.target.value))}>{[0.5, 1, 2, 4, 8].map(x => <option key={x} value={x}>{x}×</option>)}</select><button onClick={() => { setSimElapsed(0); setSimRunning(false); }} aria-label="Reset simulation"><RotateCcw size={17}/></button></div> : <div className="timeline"><span className="demo-tag">SYNTHETIC DEMO</span><button className="timeline-play" aria-label={demoPlaying ? "Pause demo" : "Resume demo"} onClick={() => setDemoPlaying(value => !value)}>{demoPlaying ? <Pause size={17}/> : <Play size={17} fill="currentColor"/>}</button><input type="range" aria-label="Demo playback position" min={0} max={DEMO_LOOP_SECONDS} step={1} value={demoPlayhead} onChange={event => { setDemoPlayhead(Number(event.target.value)); setDemoPlaying(false); }}/><span className="timeline-time">{Math.floor(demoPlayhead / 60).toString().padStart(2, "0")}:{Math.floor(demoPlayhead % 60).toString().padStart(2, "0")} / 08:00</span><select aria-label="Demo playback speed" value={demoSpeed} onChange={event => setDemoSpeed(Number(event.target.value))}>{[0.5, 1, 2, 4].map(x => <option key={x} value={x}>{x}×</option>)}</select><button onClick={() => { setDemoPlayhead(0); setDemoPlaying(false); }} aria-label="Reset demo"><RotateCcw size={17}/></button></div>}
          </div><div className="operational-note">Synthetic traffic demo and simulations for education and research. Not for operational use.</div></main>
          <aside className="inspector" aria-label="Portal information panel"><div className="inspector-top"><span className="eyeline">{panel === "assistant" ? "ASSISTANT" : panel === "simulation" ? "SCENARIO LAB" : panel === "status" ? "DATA STATUS" : panel === "flights" ? "AIRCRAFT LIST" : panel === "help" ? "SETUP GUIDE" : "AeroFlo / Inspector"}</span><button onClick={() => setPanel("overview")} title="Overview" aria-label="Show overview">Overview</button></div>
            {panel === "assistant" ? <Assistant configured={Boolean(serverStatus?.ai.configured)} providerState={serverStatus?.ai.state ?? "unverified"} context={aiContext} onRunProposal={runProposal} onProviderChange={state => setServerStatus(previous => previous ? { ...previous, ai: { ...previous.ai, state } } : previous)}/>
            : panel === "simulation" ? <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">SYNTHETIC ONLY</span><h2>Simulation lab</h2></div></div><p className="panel-intro">Set a scenario, run its synthetic traffic, then compare model estimates.</p><span className="sim-tag">SIMULATION · NO LIVE CHANGES</span><label className="field-label" htmlFor="scenario-select">Scenario</label><select id="scenario-select" className="field" value={scenario.id} onChange={event => selectScenario(scenarios.find(x => x.id === event.target.value) ?? presets[0])}>{scenarios.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><div className="scenario-description">{scenario.description}</div><div className="scenario-stats"><div><strong>{scenario.syntheticAircraftCount}</strong><span>synthetic aircraft</span></div><div><strong>{scenario.durationMinutes}m</strong><span>event window</span></div></div><div className="scenario-event"><strong>{eventLabels[scenario.eventType]}</strong><span>{scenarioLocation.name} · {scenarioLocation.id}</span></div><div className="sim-panel-controls"><button className="button-primary" onClick={() => setSimRunning(value => !value)}>{simRunning ? <Pause size={16}/> : <Play size={16} fill="currentColor"/>}{simRunning ? "Pause" : simElapsed ? "Resume" : "Start simulation"}</button><button className="button-subtle" onClick={() => { setSimElapsed(0); setSimRunning(false); }}><RotateCcw size={16}/> Reset</button></div><button className="disclosure" onClick={() => setCustomOpen(value => !value)} aria-expanded={customOpen}><Plus size={17}/> Create custom event <ChevronDown size={16}/></button>{customOpen && <form className="custom-form" onSubmit={createCustom}><label>Location<select className="field" value={customLocation} onChange={event => setCustomLocation(event.target.value)}>{locations.map(x => <option key={x.id} value={x.id}>{x.id} · {x.city}</option>)}</select></label><label>Event type<select className="field" value={customEvent} onChange={event => setCustomEvent(event.target.value as EventType)}>{Object.entries(eventLabels).filter(([key]) => key !== "none").map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label><div className="form-pair"><label>Duration · min<input className="field" type="number" min={5} max={240} value={customDuration} onChange={event => setCustomDuration(Number(event.target.value))}/></label><label>Aircraft<input className="field" type="number" min={1} max={40} value={customCount} onChange={event => setCustomCount(Number(event.target.value))}/></label></div><button className="button-primary full" type="submit">Create & load scenario</button></form>}<div className="panel-divider"/><div className="compare-heading"><BarChart3 size={18}/><h3>Compare simulations</h3></div><label className="field-label" htmlFor="compare-select">Compare with</label><select id="compare-select" className="field" value={comparison.id} onChange={event => setCompareId(event.target.value)}>{scenarios.filter(x => x.id !== scenario.id).map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select><div className="compare-results"><div><span>{scenario.name}</span><strong>{currentEstimate.affectedCount} affected</strong><small>{currentEstimate.aggregateDelayMinutes} synthetic aggregate delay min</small><i style={{ width: `${Math.min(100, currentEstimate.aggregateDelayMinutes / Math.max(1, scenario.durationMinutes * scenario.syntheticAircraftCount) * 100)}%` }}/></div><div><span>{comparison.name}</span><strong>{comparisonEstimate.affectedCount} affected</strong><small>{comparisonEstimate.aggregateDelayMinutes} synthetic aggregate delay min</small><i style={{ width: `${Math.min(100, comparisonEstimate.aggregateDelayMinutes / Math.max(1, comparison.durationMinutes * comparison.syntheticAircraftCount) * 100)}%` }}/></div></div><p className="microcopy">SIMULATION model estimates. Delay is an abstract progress deficit, not a predicted airport delay.</p><details className="assumptions"><summary>Model assumptions</summary><strong>{scenario.name}</strong>{scenario.assumptions.map((x, i) => <p key={i}>• {x}</p>)}<strong>{comparison.name}</strong>{comparison.assumptions.map((x, i) => <p key={i}>• {x}</p>)}</details></div>
            : panel === "status" ? <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">DATA STATUS</span><h2>Source health</h2></div></div><p className="panel-intro">The source of every map layer and aircraft stays visible here.</p><div className="status-table"><StatusRow label="Cesium imagery" value={assets.imagery === "ion" ? "Aerial imagery loaded" : assets.imagery === "osm" ? "OpenStreetMap street map" : assets.imagery === "fallback" ? "Natural Earth fallback" : assets.imagery} good={assets.imagery === "ion"}/><StatusRow label="3D terrain" value={assets.terrain === "ion" ? "World Terrain loaded" : "Ellipsoid only"} good={assets.terrain === "ion"}/><StatusRow label="3D buildings" value={assets.buildings === "ion" ? "OSM Buildings loaded" : assets.buildings === "not_requested" ? "Not used in this view" : assets.buildings} good={assets.buildings === "ion"}/><StatusRow label="Aircraft model" value={assets.model === "ready" ? "Original GLB ready" : assets.model === "fallback" ? "Symbol fallback" : "Loading"} good={assets.model === "ready"}/><StatusRow label="Traffic source" value={mode === "simulation" ? "Synthetic simulation" : "Synthetic demo · ready"} good/><StatusRow label="AI provider" value={serverStatus?.ai.configured ? serverStatus.ai.state === "working" ? "Checked · working" : "Configured · unverified" : "Not configured"} good={serverStatus?.ai.state === "working"}/></div><div className="detail-list"><Detail label="Playback state" value={polling}/><Detail label="Demo loop" value="8 minutes · repeats"/><Detail label="Playback position" value={`${Math.floor(demoPlayhead / 60)}:${Math.floor(demoPlayhead % 60).toString().padStart(2, "0")}`}/><Detail label="Displayed records" value={`${visible.length} synthetic aircraft`}/></div>{assets.message && <div className="setup-card"><strong>Map asset status</strong><p>{assets.message}</p></div>}<p className="microcopy">Synthetic demonstration paths are illustrative and are not observed aircraft positions.</p><button className="text-button" onClick={() => setPanel("help")}>Open setup guide <ArrowRight size={16}/></button></div>
            : panel === "help" ? <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">{isLocalDevelopment() ? "LOCAL SETUP" : "VERCEL SETUP"}</span><h2>Setup & help</h2></div></div>
              {isLocalDevelopment() ? <>
                <p className="panel-intro">AeroFlo works locally with a Vite frontend and private API server.</p>
                <div className="help-step"><span>01</span><div><strong>Install and start</strong><code>npm install<br/>npm run dev</code></div></div>
                <div className="help-step"><span>02</span><div><strong>Configure Cesium</strong><p>Add <code>VITE_CESIUM_ION_TOKEN</code> to <code>.env.local</code>. This is a public-client token; restrict its allowed assets, scope, and URLs.</p></div></div>
                <div className="help-step"><span>03</span><div><strong>Enable AI if wanted</strong><p><a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Create a Groq API key</a>. Put it in your local <code>.env.local</code> file:</p><code>GROQ_API_KEY=your_groq_api_key</code><p>Restart AeroFlo and ask a question to check provider access. Keep this key on the server; don’t paste it into this page or chat.</p></div></div>
              </> : <>
                <p className="panel-intro">Add keys in your Vercel project settings. AeroFlo never collects or displays their values.</p>
                <div className="help-step"><span>01</span><div><strong>Open environment settings</strong><p>Add each variable for the Production environment, then redeploy.</p><a className="text-button setup-link" href={VERCEL_ENVIRONMENT_SETTINGS_URL} target="_blank" rel="noreferrer">Open Vercel environment settings</a></div></div>
                <div className="help-step"><span>02</span><div><strong>Cesium ion</strong><p>Add <code>VITE_CESIUM_ION_TOKEN</code> as <b>Config</b>. It is a public-client token embedded in the browser build; restrict its assets, scope, and allowed URLs.</p></div></div>
                <div className="help-step"><span>03</span><div><strong>Optional AI assistant</strong><p><a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Create a Groq API key</a>, then add it as <code>GROQ_API_KEY</code> in Vercel. Keep it server-only. The assistant stays unavailable until a deployment includes it.</p></div></div>
                <p className="microcopy">Never paste API keys into AeroFlo or chat. Vercel applies changed variables to new deployments.</p>
              </>}
              <p className="microcopy">More details and service terms are in the project README.</p><button className="text-button" onClick={() => setPanel("status")}>Check data status <ArrowRight size={16}/></button></div>
            : panel === "flights" ? <FlightList aircraft={aircraft} selectedId={selectedId} onSelect={id => { setSelectedId(id); setPanel("details"); }}/>
            : panel === "details" ? <AircraftDetails aircraft={selected} onClose={() => setSelectedId(null)} mode={mode} onFlights={() => setPanel("flights")} onFocus={() => { if (selected) mapRef.current?.focusAircraft(selected); }}/>
            : <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">OVERVIEW</span><h2>Airspace at a glance</h2></div></div><p className="panel-intro">Explore the map, inspect an aircraft, or start a clearly separate simulation.</p><div className="overview-total"><strong>{visible.length}</strong><span>positioned aircraft in the current view</span></div><div className="detail-list"><Detail label="Mode" value={mode === "demo" ? "Synthetic demo" : "SIMULATION"}/><Detail label="Area" value={`${location.city} · ${location.id}`}/><Detail label="Source" value={sourceText}/><Detail label={mode === "demo" ? "Demo playhead" : "Scenario time"} value={mode === "demo" ? `${Math.floor(demoPlayhead / 60)}:${Math.floor(demoPlayhead % 60).toString().padStart(2, "0")} / 08:00` : `${Math.floor(simElapsed / 60)}:${Math.floor(simElapsed % 60).toString().padStart(2, "0")}`}/></div><div className="panel-divider"/><h3 className="subheading">Where to next?</h3><button className="action-row" onClick={() => go("details", "local")}><Layers3 size={19}/><span>Explore local 3D<small>Orbit around {location.id}</small></span><ArrowRight size={17}/></button><button className="action-row" onClick={() => go("details", "us")}><Globe2 size={19}/><span>Open U.S. 2D<small>Zoom and pan nationally</small></span><ArrowRight size={17}/></button><button className="action-row" onClick={() => changeMode("simulation")}><FlaskConical size={19}/><span>Try a simulation<small>Synthetic traffic only</small></span><ArrowRight size={17}/></button></div>}
          </aside></div>}
      {mapKind === "us" && panel === "assistant" && <aside className="us-assistant-drawer" aria-label="AI Assistant"><div className="inspector-top"><span className="eyeline">US 2D · MODEL CONTEXT</span><button onClick={() => setPanel("details")} aria-label="Close AI assistant">Close</button></div><Assistant configured={Boolean(serverStatus?.ai.configured)} providerState={serverStatus?.ai.state ?? "unverified"} context={aiContext} onRunProposal={runProposal} onProviderChange={state => setServerStatus(previous => previous ? { ...previous, ai: { ...previous.ai, state } } : previous)}/></aside>}
    </div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>; }
function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) { return <div className="status-row"><span>{label}</span><strong><i className={`status-dot ${good ? "good" : "amber"}`}/>{value}</strong></div>; }
function AircraftDetails({ aircraft, onClose, mode, onFlights, onFocus }: { aircraft: Aircraft | null; onClose: () => void; mode: Mode; onFlights: () => void; onFocus: () => void }) {
  if (!aircraft) return <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">AIRCRAFT INSPECTOR</span><h2>Select an aircraft</h2></div></div><p className="panel-intro">Click any aircraft on the map or choose one from the flight list to see its source and available fields.</p><div className="inspector-empty"><Plane size={47}/><span>No aircraft selected</span></div><button className="text-button" onClick={onFlights}>Browse aircraft <ArrowRight size={16}/></button></div>;
  const simulated = mode === "simulation" || aircraft.kind === "simulated";
  const demo = aircraft.kind === "demo";
  return <div className="panel-content"><div className="detail-top"><div><span className="eyeline">SELECTED AIRCRAFT</span><h2>{aircraft.callsign ?? aircraft.id.toUpperCase()}</h2><span className={simulated ? "sim-tag" : "demo-tag"}>{simulated ? "SIMULATION" : demo ? "SYNTHETIC DEMO" : aircraft.positionKind === "stale" ? "STALE LAST GOOD POSITION" : aircraft.positionKind === "estimated" ? "ESTIMATED BETWEEN UPDATES" : "MEASURED POSITION"}</span></div><button aria-label="Close aircraft details" onClick={onClose}><X size={18}/></button></div><div className="aircraft-identity"><Plane size={36} fill="currentColor"/><div><span>{aircraft.id.toUpperCase()}</span><small>{simulated || demo ? "Synthetic aircraft" : "ICAO 24-bit address"}</small></div></div><button className="button-subtle full focus-aircraft" disabled={aircraft.latitude === null || aircraft.longitude === null} onClick={onFocus}><MapPin size={15}/> Focus aircraft on map</button><dl className="detail-list"><Detail label="Callsign" value={aircraft.callsign ?? "Unavailable"}/><Detail label="ICAO address" value={simulated || demo ? "Synthetic ID" : aircraft.id.toUpperCase()}/><Detail label="Position" value={aircraft.latitude === null || aircraft.longitude === null ? "Unavailable" : `${aircraft.latitude.toFixed(4)}°, ${aircraft.longitude.toFixed(4)}°`}/><Detail label="Geometric altitude" value={aircraft.geoAltitudeM === null ? "Unavailable" : `${Math.round(aircraft.geoAltitudeM * 3.28084).toLocaleString()} ft`}/><Detail label="Barometric altitude" value={aircraft.baroAltitudeM === null ? "Unavailable" : `${Math.round(aircraft.baroAltitudeM * 3.28084).toLocaleString()} ft`}/><Detail label="Ground speed" value={aircraft.groundSpeedMs === null ? "Unavailable" : `${Math.round(aircraft.groundSpeedMs * 1.94384)} kt`}/><Detail label="Track" value={aircraft.trackDeg === null ? "Unavailable" : `${Math.round(aircraft.trackDeg)}°`}/><Detail label="Vertical rate" value={aircraft.verticalRateMs === null ? "Unavailable" : `${Math.round(aircraft.verticalRateMs * 196.85)} ft/min`}/><Detail label="On ground" value={aircraft.onGround === null ? "Unavailable" : aircraft.onGround ? "Yes" : "No"}/><Detail label="Position source" value={simulated || demo ? "Synthetic model" : aircraft.positionSource ?? "Unavailable"}/><Detail label="Position age" value={simulated ? "Simulation time" : demo ? "Playback time" : "Unavailable"}/><Detail label="Last contact" value={simulated || demo ? "Not applicable" : aircraft.lastContact ? formatTime(aircraft.lastContact * 1000) : "Unavailable"}/><Detail label="Source" value={aircraft.source}/><Detail label="Airline / type" value="Unavailable"/><Detail label="Origin / destination" value="Unavailable"/></dl><div className="detail-disclaimer"><Info size={16}/><span>{simulated ? "This aircraft and its route are synthetic simulation output. No real aircraft are affected." : demo ? "Synthetic demonstration trajectory; it is illustrative and does not represent an observed flight." : aircraft.positionKind === "stale" ? "This is the last successful observed position, and its age is shown above." : aircraft.positionKind === "estimated" ? "Position is estimated from the last reported location, speed, and track. It is not a new observation." : "Public flight data can omit fields and does not provide a certified operational picture."}</span></div></div>;
}
function FlightList({ aircraft, selectedId, onSelect }: { aircraft: Aircraft[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const list = aircraft.filter(a => `${a.callsign ?? ""} ${a.id}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 600);
  return <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">CURRENT AREA</span><h2>Flights</h2></div></div><p className="panel-intro">{aircraft.length} records returned. Select a row to inspect the same aircraft on the map.</p><div className="flight-filter"><Search size={16}/><input aria-label="Filter flights" placeholder="Filter by callsign or ICAO" value={filter} onChange={event => setFilter(event.target.value)}/></div><div className="flight-list">{list.length ? list.map(a => <button className={selectedId === a.id ? "active" : ""} key={a.id} onClick={() => onSelect(a.id)}><Plane size={17}/><span><strong>{a.callsign ?? a.id.toUpperCase()}</strong><small>{a.id.toUpperCase()} · {a.source}</small></span><span className="flight-alt">{a.geoAltitudeM !== null || a.baroAltitudeM !== null ? `${Math.round(altitudeM(a) * 3.28084).toLocaleString()} ft` : "—"}</span></button>) : <div className="flight-empty">{aircraft.length ? "No flights match that filter." : "No aircraft are available for this area yet."}</div>}</div>{aircraft.length > 600 && <p className="microcopy">Showing the first 600 rows for list performance. All positioned aircraft remain on the map.</p>}</div>;
}
