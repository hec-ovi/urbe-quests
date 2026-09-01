/** Simulation-minute rendering for dialog prose (0 = Monday 00:00). */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function dayName(day: number): string {
  return DAY_NAMES[day] ?? `day ${day}`;
}

export function clock(minuteOfDay: number): string {
  const h = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const m = String(minuteOfDay % 60).padStart(2, '0');
  return `${h}:${m}`;
}
