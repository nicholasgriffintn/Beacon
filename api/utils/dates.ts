export function getMidnightDate(): Date {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return midnight;
}