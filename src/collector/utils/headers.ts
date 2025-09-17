import { getMidnightDate } from "./dates";

export function getNextLastModifiedDate(current: Date | null): Date {
  let originalCurrent = current;
  // Handle invalid date
  if (current && Number.isNaN(current.getTime())) {
    originalCurrent = null;
  }

  const midnight = getMidnightDate();

  let next = originalCurrent ? originalCurrent : midnight;
  next = midnight.getTime() - next.getTime() > 0 ? midnight : next;

  const currentSeconds = next.getSeconds();
  next.setSeconds(Math.min(3, currentSeconds + 1));

  return next;
}

export function checkVisitorSession(ifModifiedSince: string | null): {
  newVisitor: boolean;
} {
  let newVisitor = true;

  if (ifModifiedSince) {
    const today = new Date();
    const ifModifiedSinceDate = new Date(ifModifiedSince);
    if (
      today.getFullYear() === ifModifiedSinceDate.getFullYear() &&
      today.getMonth() === ifModifiedSinceDate.getMonth() &&
      today.getDate() === ifModifiedSinceDate.getDate()
    ) {
      newVisitor = false;
    }
  }

  return { newVisitor };
}

export function handleCacheHeaders(ifModifiedSince: string | null): {
  hits: number;
  nextLastModifiedDate: Date;
} {
  const { newVisitor } = checkVisitorSession(ifModifiedSince);
  const nextLastModifiedDate = getNextLastModifiedDate(
    ifModifiedSince ? new Date(ifModifiedSince) : null,
  );

  // Calculate hits from the seconds component of the date
  // If it's a new day or first visit, hits will be 1
  // Otherwise, it's based on the seconds value, but capped at 3
  let hits = newVisitor ? 1 : nextLastModifiedDate.getSeconds();

  if (hits > 3) {
    hits = 3;
  }

  return {
    hits,
    nextLastModifiedDate,
  };
}