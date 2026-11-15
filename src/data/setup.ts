export const VERCEL_ENVIRONMENT_SETTINGS_URL =
  "https://vercel.com/jeetski2980s-projects/airspace-live-flight-tracking-simulation/settings/environment-variables";
export const GEMINI_API_KEYS_URL = "https://aistudio.google.com/app/apikey";

export function isLocalDevelopment() {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}
