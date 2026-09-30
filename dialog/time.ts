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

/** A minute of the day as people say it: "2 in the afternoon", "half past 9 in the morning", "midnight", "noon". */
export function spoken(minuteOfDay: number): string {
  const minute = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  if (m === 0 && h === 0) return 'midnight';
  if (m === 0 && h === 12) return 'noon';
  const hour = h % 12 === 0 ? 12 : h % 12;
  const part = h < 5 ? 'at night' : h < 12 ? 'in the morning' : h < 17 ? 'in the afternoon' : h < 21 ? 'in the evening' : 'at night';
  const at = m === 0 ? `${hour}` : m === 30 ? `half past ${hour}` : `${hour}:${String(m).padStart(2, '0')}`;
  return `${at} ${part}`;
}
