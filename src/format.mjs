// Display formatting and small numeric helpers shared by the chart and its panels.
import { bearingDegrees, compassPoint, distanceNm } from "./model.mjs";

export function formatNm(value) {
  return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1);
}

export function formatBearing(degrees) {
  return `${String(Math.round(degrees) % 360).padStart(3, "0")}° ${compassPoint(degrees)}`;
}

// Release notes are short Markdown. Headings, bullets and paragraphs become lines; links keep their
// address in brackets, since the page cannot open them.
export function releaseNoteLines(notes) {
  const inline = (text) => text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)").replaceAll("**", "").replaceAll("`", "").trim();
  return String(notes ?? "").split("\n").map((raw) => raw.trim()).filter(Boolean).map((line) => {
    if (line.startsWith("#")) return { kind: "heading", text: inline(line.replace(/^#+/, "")) };
    if (/^[-*] /.test(line)) return { kind: "bullet", text: inline(line.slice(2)) };
    return { kind: "text", text: inline(line) };
  });
}

// Compass points read back as written in game ("SSE"); anything in between stays in degrees.
export function formatDirection(degrees) {
  return nearlyMultiple(degrees, 22.5) ? compassPoint(degrees) : String(Math.round(degrees * 10) / 10);
}

export function plainDegrees(degrees) {
  return `${String(Math.round((degrees % 360 + 360) % 360) % 360).padStart(3, "0")}°`;
}

export function formatLeg(from, to) {
  return `${distanceNm(from, to).toFixed(1)} nm · ${formatBearing(bearingDegrees(from, to))}`;
}

export function shortCoordinate(value, axis, step) {
  const absolute = Math.abs(value);
  const decimals = step >= 1 ? 0 : step >= .1 ? 1 : 2;
  const label = absolute.toFixed(step === .25 ? 2 : decimals);
  const cardinal = axis === "lat" ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");
  return `${label}°${cardinal}`;
}

export function nearlyMultiple(value, step) {
  return Math.abs(value / step - Math.round(value / step)) < .00001;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function positiveNumber(text, label) {
  const value = Number(String(text).replaceAll(",", "."));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be more than 0 nm.`);
  return value;
}

export function isNightTime(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!match) return false;
  const hours = Number(match[1]) + Number(match[2]) / 60;
  return hours < 8 || hours > 21;
}
