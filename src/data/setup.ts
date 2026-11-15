export const VERCEL_ENVIRONMENT_SETTINGS_URL =
  "https://vercel.com/jeetski2980s-projects/airspace-live-flight-tracking-simulation/settings/environment-variables";

export function isLocalDevelopment() {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}
