// Game time as one number: absolute hours since day 0, the game's day * 24 plus its global time.
// It only moves forward while you play, so it orders positions across midnight.

const HOURS_PER_DAY = 24;

function absoluteHours(day, hours) {
  const d = Number(day);
  const h = Number(hours);
  return Number.isInteger(d) && d >= 0 && Number.isFinite(h) && h >= 0 && h < HOURS_PER_DAY ? d * HOURS_PER_DAY + h : null;
}

function splitHours(t) {
  const day = Math.floor(t / HOURS_PER_DAY);
  return { day, hours: t - day * HOURS_PER_DAY };
}

// "14:05", "14:05:30", "14 05" or "14.5" -> hours, or NaN.
export function parseClock(text) {
  const value = String(text ?? "").trim().replaceAll(",", ".");
  if (!value) return NaN;
  const parts = value.split(/[:\sh]+/).filter(Boolean);
  if (parts.length === 1) {
    const hours = Number(parts[0]);
    return Number.isFinite(hours) && hours >= 0 && hours < HOURS_PER_DAY ? hours : NaN;
  }
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return NaN;
  const [h, m, s = 0] = parts.map(Number);
  if (h >= HOURS_PER_DAY || m >= 60 || s >= 60) return NaN;
  return h + m / 60 + s / 3600;
}

// A whole day number from text such as "12" or "Day 12", or NaN.
function parseDay(text) {
  const match = /^(?:day\s*)?(\d{1,6})$/i.exec(String(text ?? "").trim());
  return match ? Number(match[1]) : NaN;
}

// Absolute hours from a day field and a time field, or null when either is missing or unreadable.
export function parseDayTime(dayText, timeText) {
  return absoluteHours(parseDay(dayText), parseClock(timeText));
}

function formatClock(hours) {
  const minutes = Math.floor(((hours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY * 60 + 1e-6);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatGameTime(t) {
  if (!Number.isFinite(t)) return "";
  const { day, hours } = splitHours(t);
  return `day ${day} ${formatClock(hours)}`;
}

export function clockText(t) {
  return Number.isFinite(t) ? formatClock(splitHours(t).hours) : "";
}
