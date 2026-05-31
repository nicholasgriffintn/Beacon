export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
    .join(",")}}`;
}

export function hashToUint32(input: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export function getDeterministicBucket(input: string): number {
  return (hashToUint32(input) / 0x100000000) * 100;
}

export function isInPercentageBucket(input: string, percentage: number): boolean {
  if (percentage >= 100) {
    return true;
  }

  if (percentage <= 0) {
    return false;
  }

  return getDeterministicBucket(input) < percentage;
}
