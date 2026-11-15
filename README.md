# AeroFlo

AeroFlo is an aviation education and research portal with a generated traffic demo, a separate synthetic simulation lab, a Cesium Local 3D map, and a self-contained U.S. 2D map. **The portal does not connect to OpenSky or display observed live flights.** The demo is generated illustrative traffic on a repeating eight-minute playback loop. Simulation Mode uses its own scenario engine and data.

> Synthetic traffic demo and simulations for education and research. Not for operational use.

## Start locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local`.
3. Add the optional credentials described below.
4. Run `npm install` and `npm run dev`.
5. Open the local URL printed by Vite (normally `http://localhost:5173`).

`npm run dev` starts Vite and the local API server. The app works without provider credentials; Cesium imagery falls back to an available non-ion map, and the AI panel explains when Groq is not configured.

## Optional environment variables

| Variable | Where it is used | Purpose |
| --- | --- | --- |
| `VITE_CESIUM_ION_TOKEN` | Browser build | Optional Cesium ion imagery, terrain, buildings, and geocoding. This is a public-client token. Restrict its allowed assets, scopes, and URLs. |
| `GROQ_API_KEY` | Local API server | Enables AI questions and structured simulation proposals. Keep it server-side; never use a `VITE_` prefix. |
| `GROQ_MODEL` | Local API server | Optional Groq model override. Defaults to `openai/gpt-oss-20b`. |

Enter local values in `.env.local`, then restart `npm run dev`. Do not paste keys into the AeroFlo interface or chat. `.env.local`, `.env`, and other local secret files are ignored by Git. `.env.example` contains placeholders only.

The browser token is included in the client bundle because its name uses Vite's `VITE_` prefix. It is not a private server secret; use a public-client token with suitable restrictions. AeroFlo does not create or manage Cesium ion tokens.

For Vercel, set `VITE_CESIUM_ION_TOKEN` as a Config value, since it is intended for browser use. Set `GROQ_API_KEY` and `GROQ_MODEL` as server environment variables. Create a new deployment after changing environment variables.

## What the app includes

- **Synthetic traffic:** Local 3D has its own 24-aircraft eight-minute demo loop. U.S. 2D uses the original ZIP scenario model and its native six-hour timeline, airport rotations, generated flights, paths, filters, and scenario controls. The U.S. 2D dataset is synthetic model output, not historical observed flight data.
- **Simulation Mode:** a separate engine with ready-made scenarios, custom event setup, play/pause/reset/speed controls, comparisons, and visible model assumptions. Starting a scenario never modifies the demo traffic.
- **AI Assistant:** uses the selected Local 3D dataset or a bounded snapshot from the original U.S. 2D model (including model time, visible counts, aircraft positions, active scenarios, and assumptions). It can explain fields and prepare a structured hypothetical scenario; the user must review and run a proposal from Simulation Mode. Its responses distinguish synthetic model output from observed traffic. The AI service is Groq and remains unavailable until `GROQ_API_KEY` is configured.
- **Local 3D:** starts around JFK and supports airport/city search, pan/orbit/tilt, zoom, aircraft selection, and map asset status. When Cesium assets are unavailable, the UI reports the issue or shows its documented fallback.
- **U.S. 2D:** uses the original schematic map shipped in `vendor/zip2d/`; it requires no map API. The original interface is built from its source files during `predev` and `prebuild`.
- **Data Status:** reports imagery, terrain, building and model state, synthetic playback, and AI provider configuration/check state.

## API

The local backend exposes `GET /api/status` and `POST /api/assistant`. It has no flight-data endpoints and makes no requests to OpenSky. API responses do not include secret values.

## Build and verification

- `npm run build` builds the TypeScript and Vite client and packages local Cesium and 2D assets.
- `npm test` runs the existing Node test suite.
- `npm run preview` serves the production build with the local API.

If the 3D map is blank, check Data Status, browser console errors, and Cesium ion token restrictions. The U.S. schematic map is self-contained and does not request a map token. If the AI panel reports that it is not configured, add `GROQ_API_KEY` to `.env.local` and restart the server.

## Design and asset notes

The visual design is original AeroFlo work informed by general product patterns from PrepMind, Civello, Linear, and Ripple. The 2D map source supplied by the project owner is retained under `vendor/zip2d/`, including its original README and asset files. Its geography and sector regions are schematic, not verified airspace boundaries. Cesium content and OpenStreetMap content keep their own attributions and service terms.
