import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, MapPin, Plane, Search, X } from "lucide-react";
import { Assistant } from "./Assistant";
import { locations, findLocation } from "../data/locations";
import { GROQ_API_KEYS_URL, isLocalDevelopment, VERCEL_ENVIRONMENT_SETTINGS_URL } from "../data/setup";
import type { Mode, ScenarioProposal } from "../types";

type Panel = "overview" | "flights" | "assistant" | "status" | "help";
type ZipView = "net" | "sfc" | "lab" | "deg" | "alr";
type ZipAircraft = {
  id: string; callsign: string | null; latitude: number; longitude: number;
  altitudeM: null; groundSpeedMs: number | null; trackDeg: number | null;
  status: string; originAirport: string | null; destinationAirport: string | null;
  source: string; positionKind: "synthetic_demo";
};
type Zip2DSnapshot = {
  mode: Mode; mapView: string; selectedAirport: string; currentMinute: number;
  visibleCount: number; returnedCount: number; positionedCount: number;
  aircraft: ZipAircraft[]; altitudeAvailability: string;
  activeScenario: Array<{ id: string; name: string; startMinute: number; durationMinutes: number; restorationMinutes: number }>;
  assumptions: string[]; receivedAt: number;
};
type ServerStatus = { server: string; ai: { configured: boolean; state: string; provider: string } };
type ProposalHandoff = {
  requestId: string;
  proposal: ScenarioProposal;
  startMinute: number;
};
type ProposalHandoffState = { key: string; status: "pending" | "loaded" | "error"; message: string };

function proposalKey(proposal: ScenarioProposal) {
  return JSON.stringify([proposal.locationId, proposal.eventType, proposal.durationMinutes, proposal.syntheticAircraftCount, proposal.description]);
}

const initialQuery = new URLSearchParams(window.location.search);
const initialMode: Mode = initialQuery.get("mode") === "simulation" ? "simulation" : "demo";
const initialPanel: Panel = initialQuery.get("panel") === "status" ? "status" : initialQuery.get("panel") === "help" ? "help" : initialQuery.get("panel") === "assistant" ? "assistant" : "overview";
const initialZipView: ZipView = initialMode === "simulation" ? "lab" : "net";
const viewLabel: Record<ZipView, string> = { net: "Network", sfc: "JFK Surface", lab: "What-If Lab", deg: "Degraded Ops", alr: "Alerts" };

export function Portal() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [zipView, setZipView] = useState<ZipView>(initialZipView);
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Zip2DSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proposalHandoff, setProposalHandoff] = useState<ProposalHandoffState | null>(null);
  const zipFrameRef = useRef<HTMLIFrameElement>(null);
  const zipFrameReadyRef = useRef(false);
  const pendingProposalRef = useRef<ProposalHandoff | null>(null);

  const searchMatches = useMemo(() => searchText.trim()
    ? locations.filter(place => `${place.id} ${place.city} ${place.name}`.toLowerCase().includes(searchText.trim().toLowerCase())).slice(0, 6)
    : [], [searchText]);

  useEffect(() => {
    fetch("/api/status").then(response => response.json()).then(setServerStatus).catch(() => setServerStatus(null));
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== zipFrameRef.current?.contentWindow) return;
      if (event.data?.type === "airspace-zip-proposal-result") {
        const pending = pendingProposalRef.current;
        if (!pending || event.data.requestId !== pending.requestId) return;
        const key = proposalKey(pending.proposal);
        const loaded = event.data.status === "loaded";
        setProposalHandoff({
          key,
          status: loaded ? "loaded" : "error",
          message: loaded
            ? `The ${pending.proposal.eventType.replaceAll("_", " ")} proposal for ${pending.proposal.locationId} is in the Simulation stack. Review its assumptions and settings before running it.`
            : "The proposal could not be added to the Simulation stack. Check that its location and event are supported, then try again.",
        });
        pendingProposalRef.current = null;
        return;
      }
      if (event.data?.type === "airspace-zip-selected" && (typeof event.data.id === "string" || event.data.id === null)) {
        setSelectedId(event.data.id);
      }
      const data = event.data;
      if (data?.type !== "airspace-zip-snapshot" || data.dataKind !== "synthetic_model"
        || (data.mode !== "demo" && data.mode !== "simulation")
        || !Number.isFinite(data.currentMinute) || !Number.isInteger(data.visibleCount)
        || !Number.isInteger(data.returnedCount) || !Number.isInteger(data.positionedCount)
        || !Array.isArray(data.aircraft) || data.aircraft.length > 60
        || !data.aircraft.every((plane: ZipAircraft) => typeof plane.id === "string"
          && Number.isFinite(plane.latitude) && plane.latitude >= -90 && plane.latitude <= 90
          && Number.isFinite(plane.longitude) && plane.longitude >= -180 && plane.longitude <= 180
          && (plane.groundSpeedMs === null || Number.isFinite(plane.groundSpeedMs)))
        || !Array.isArray(data.activeScenario) || !Array.isArray(data.assumptions)) return;
      setSnapshot({ ...data, receivedAt: Date.now() } as Zip2DSnapshot);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  function showView(view: ZipView) {
    setZipView(view);
    setPanel("overview");
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-view", view }, window.location.origin);
  }
  function changeMode(next: Mode) {
    setMode(next);
    setSelectedId(null);
    setPanel("overview");
    if (next !== mode) zipFrameReadyRef.current = false;
    if (next === "simulation") setZipView("lab");
    else setZipView("net");
  }
  function chooseLocation(place: (typeof locations)[number]) {
    setSearchText(""); setSearchOpen(false); setSearchError(null);
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-focus", id: place.id, latitude: place.lat, longitude: place.lon }, window.location.origin);
  }
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const place = findLocation(searchText);
    if (!place) { setSearchError("Choose a listed airport or city to focus the 2D map."); return; }
    chooseLocation(place);
  }
  function go(panelName: Panel) {
    if (panelName === "flights") { showView("net"); setPanel("flights"); return; }
    setPanel(panelName);
    if (panelName === "overview") showView("net");
  }
  function runProposal(proposal: ScenarioProposal) {
    const handoff: ProposalHandoff = {
      requestId: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      proposal,
      startMinute: snapshot?.mode === "simulation" ? Math.max(0, Math.floor(snapshot.currentMinute)) : 0,
    };
    pendingProposalRef.current = handoff;
    setProposalHandoff({ key: proposalKey(proposal), status: "pending", message: "Adding the reviewed proposal to the Simulation stack…" });
    setMode("simulation"); setZipView("lab"); setPanel("assistant");
    if (mode !== "simulation") zipFrameReadyRef.current = false;
    else if (zipFrameReadyRef.current) {
      zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-scenario-proposal", ...handoff }, window.location.origin);
    }
  }
  function selectFlight(id: string) {
    setSelectedId(id); setPanel("flights");
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-focus-aircraft", id }, window.location.origin);
  }

  const selected = snapshot?.aircraft.find(plane => plane.id === selectedId) ?? null;
  const aiContext = {
    mode, view: "us", location: `${snapshot?.selectedAirport ?? "JFK"} · U.S. network`, sourceTimestamp: null,
    dataState: "ZIP 2D synthetic model", visibleCount: snapshot?.visibleCount ?? 0,
    returnedCount: snapshot?.returnedCount ?? 0, positionedCount: snapshot?.positionedCount ?? 0,
    selectedAircraftId: selectedId, selectedAirport: snapshot?.selectedAirport ?? "JFK",
    mapView: snapshot?.mapView ?? zipView, modelMinute: snapshot?.currentMinute ?? null,
    altitudeAvailability: snapshot?.altitudeAvailability ?? "not modeled by the ZIP simulation engine",
    activeScenario: snapshot?.activeScenario ?? [], assumptions: snapshot?.assumptions ?? [],
    aircraft: snapshot?.aircraft.slice(0, 30) ?? [],
  };
  const updatedAt = snapshot?.receivedAt ? new Date(snapshot.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Waiting for map data";

  return <div className="portal">
    <aside className="portal-sidebar">
      <a className="portal-brand" href="/"><span className="brand-glyph"><Plane size={20} fill="currentColor"/></span><span>AeroFlo</span></a>
      <div className="sidebar-caption">FLIGHT RESEARCH</div>
      <nav aria-label="Portal navigation">
        <button className={zipView === "net" && panel === "overview" ? "active" : ""} onClick={() => showView("net")}>US 2D</button>
        <button className={panel === "flights" ? "active" : ""} onClick={() => go("flights")}>Flights</button>
        <button className={zipView === "lab" ? "active" : ""} onClick={() => { setMode("simulation"); showView("lab"); }}>Simulation</button>
        <button className={panel === "assistant" ? "active" : ""} onClick={() => go(panel === "assistant" ? "overview" : "assistant")}>AVERY</button>
        <button className={panel === "status" ? "active" : ""} onClick={() => go("status")}>Data Status</button>
      </nav>
      <div className="sidebar-bottom"><button onClick={() => go("help")}>Setup & help</button><a href="/"><ArrowLeft size={16}/> Landing page</a></div>
    </aside>
    <div className="portal-main">
      <header className="portal-header">
        <div className="mobile-brand">AeroFlo</div>
        <form className="portal-search" onSubmit={submitSearch}>
          <Search size={18}/><input aria-label="Search airport or city" placeholder="Search airport or city · JFK, New York…" value={searchText} onChange={event => { setSearchText(event.target.value); setSearchOpen(true); setSearchError(null); }}/>
          <button type="submit" aria-label="Focus location"><ArrowRight size={17}/></button>
          {searchOpen && searchMatches.length > 0 && <div className="search-menu">{searchMatches.map(place => <button key={place.id} type="button" onClick={() => chooseLocation(place)}><MapPin size={16}/><span><strong>{place.id}</strong> {place.name}<small>{place.city}</small></span></button>)}</div>}
        </form>
        <div className="mode-switch" role="group" aria-label="Data mode">
          <button aria-pressed={mode === "demo"} onClick={() => changeMode("demo")}><span className="mode-indicator"/> Synthetic Demo</button>
          <button aria-pressed={mode === "simulation"} onClick={() => changeMode("simulation")}>Simulation</button>
        </div>
        <button className="top-assistant" onClick={() => go(panel === "assistant" ? "overview" : "assistant")} aria-label={panel === "assistant" ? "Close AVERY assistant" : "Open AVERY assistant"}>AVERY</button>
      </header>
      {searchError && <div className="search-error" role="alert">{searchError}<button onClick={() => setSearchError(null)} aria-label="Dismiss search error"><X size={15}/></button></div>}
      <iframe key={mode} ref={zipFrameRef} className="zip2d-frame" title="AeroFlo U.S. 2D flight workspace" src={`/zip2d/airspace.html?mode=${mode}#${zipView}`} onLoad={() => {
        zipFrameReadyRef.current = true;
        zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-view", view: zipView }, window.location.origin);
        const pending = pendingProposalRef.current;
        if (mode === "simulation" && pending) zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-scenario-proposal", ...pending }, window.location.origin);
      }}/>
      {panel !== "overview" && <aside className={`portal-drawer ${panel === "assistant" ? "portal-drawer-assistant" : ""}`} aria-label={`${panel} panel`}>
        {panel === "assistant" ? <Assistant
          configured={Boolean(serverStatus?.ai.configured)}
          providerState={serverStatus?.ai.state ?? "unverified"}
          context={aiContext}
          proposalHandoff={proposalHandoff}
          onRunProposal={runProposal}
          onProviderChange={state => setServerStatus(previous => previous ? { ...previous, ai: { ...previous.ai, state } } : previous)}
          onClose={() => setPanel("overview")}
        /> : <>
          <div className="inspector-top"><span className="eyeline">{panel === "status" ? "DATA STATUS" : panel === "help" ? "SETUP & HELP" : "FLIGHT RECORDS"}</span><button onClick={() => setPanel("overview")} aria-label="Close panel">Close</button></div>
          {panel === "flights" ? <FlightList aircraft={snapshot?.aircraft ?? []} selectedId={selectedId} onSelect={selectFlight} selected={selected}/>
            : panel === "status" ? <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">2D MODEL HEALTH</span><h2>Source status</h2></div></div><p className="panel-intro">The U.S. 2D workspace runs its bundled model locally in your browser.</p><div className="status-table"><StatusRow label="Map" value={snapshot ? "Loaded · U.S. 2D" : "Loading"} good={Boolean(snapshot)}/><StatusRow label="Traffic" value={snapshot ? "Synthetic model" : "Waiting for iframe"} good={Boolean(snapshot)}/><StatusRow label="AI provider" value={serverStatus?.ai.configured ? serverStatus.ai.state === "working" ? "Checked · working" : "Configured · unverified" : "Not configured"} good={serverStatus?.ai.state === "working"}/></div><div className="detail-list"><Detail label="Last model update" value={updatedAt}/><Detail label="View" value={viewLabel[zipView]}/><Detail label="Aircraft in view" value={String(snapshot?.visibleCount ?? 0)}/><Detail label="Model time" value={snapshot ? `${Math.floor(snapshot.currentMinute)} min` : "Unavailable"}/><Detail label="Active scenario events" value={String(snapshot?.activeScenario.length ?? 0)}/></div><p className="microcopy">Flight records and scenario outcomes in this map are model-generated. Coverage and route positions are illustrative.</p></div>
            : <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">{isLocalDevelopment() ? "LOCAL SETUP" : "VERCEL SETUP"}</span><h2>Setup & help</h2></div></div><p className="panel-intro">The 2D map does not require a map token. Configure the optional AI provider on the server.</p>{isLocalDevelopment() ? <><div className="help-step"><span>01</span><div><strong>Install and start</strong><code>npm install<br/>npm run dev</code></div></div><div className="help-step"><span>02</span><div><strong>Enable AI if wanted</strong><p><a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Create a Groq API key</a>. Put it in your local <code>.env.local</code> file.</p><code>GROQ_API_KEY=your_groq_api_key</code><p>Restart the server. Keep this key server-side; do not paste it into this page or chat.</p></div></div></> : <><div className="help-step"><span>01</span><div><strong>Open environment settings</strong><p>Add server variables for Production, then create a new deployment.</p><a className="text-button setup-link" href={VERCEL_ENVIRONMENT_SETTINGS_URL} target="_blank" rel="noreferrer">Open Vercel environment settings</a></div></div><div className="help-step"><span>02</span><div><strong>Optional AI assistant</strong><p><a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Create a Groq API key</a>, then add it as <code>GROQ_API_KEY</code>. Keep it server-only.</p></div></div></>}<p className="microcopy">More details and service terms are in the project README.</p></div>}
        </>}
      </aside>}
    </div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>; }
function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) { return <div className="status-row"><span>{label}</span><strong><i className={`status-dot ${good ? "good" : "amber"}`}/>{value}</strong></div>; }
function FlightList({ aircraft, selectedId, onSelect, selected }: { aircraft: ZipAircraft[]; selectedId: string | null; onSelect: (id: string) => void; selected: ZipAircraft | null }) {
  const [filter, setFilter] = useState("");
  const list = aircraft.filter(plane => `${plane.callsign ?? ""} ${plane.id} ${plane.originAirport ?? ""} ${plane.destinationAirport ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">CURRENT MODEL VIEW</span><h2>Flights</h2></div></div><p className="panel-intro">{aircraft.length} positioned records in the latest model snapshot.</p><div className="flight-filter"><Search size={16}/><input aria-label="Filter flights" placeholder="Filter by callsign, ID or airport" value={filter} onChange={event => setFilter(event.target.value)}/></div><div className="flight-list">{list.length ? list.map(plane => <button className={selectedId === plane.id ? "active" : ""} key={plane.id} onClick={() => onSelect(plane.id)}><Plane size={17}/><span><strong>{plane.callsign ?? plane.id.toUpperCase()}</strong><small>{plane.originAirport ?? "Unavailable"} → {plane.destinationAirport ?? "Unavailable"}</small></span><span className="flight-alt">{plane.status}</span></button>) : <div className="flight-empty">{aircraft.length ? "No records match that filter." : "Waiting for the 2D model snapshot."}</div>}</div>{selected && <div className="detail-list"><Detail label="Position" value={`${selected.latitude.toFixed(3)}°, ${selected.longitude.toFixed(3)}°`}/><Detail label="Ground speed" value={selected.groundSpeedMs === null ? "Unavailable" : `${Math.round(selected.groundSpeedMs * 1.94384)} kt`}/><Detail label="Track" value={selected.trackDeg === null ? "Unavailable" : `${Math.round(selected.trackDeg)}°`}/><Detail label="Source" value={selected.source}/><Detail label="Data type" value="Synthetic model position"/></div>}</div>;
}
