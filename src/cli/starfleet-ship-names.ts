/**
 * Obscure Federation registry names for sub-agent task codenames (UI only).
 * Excludes headline hero ships, stations, and non-Starfleet craft.
 */

export const STARFLEET_SHIP_NAMES: readonly string[] = [
  "Archimedes",
  "Bellerophon",
  "Bozeman",
  "Bradbury",
  "Constellation",
  "Drake",
  "Equinox",
  "Ganges",
  "Grissom",
  "Hood",
  "Honshu",
  "Lalo",
  "Lexington",
  "Melbourne",
  "Odyssey",
  "Olympia",
  "Pegasus",
  "Phoenix",
  "Renegade",
  "Repulse",
  "Saratoga",
  "Stargazer",
  "Trieste",
  "Trial",
  "Yamato",
  "Yosemite",
  "Zhukov",
] as const;

let lastPicked: string | null = null;

/** Pick a name not in `exclude` (e.g. other tasks in the same batch). */
export function pickUniqueShipName(exclude: ReadonlySet<string>): string {
  const available = STARFLEET_SHIP_NAMES.filter((n) => !exclude.has(n));
  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)]!;
    lastPicked = pick;
    return pick;
  }

  const base = STARFLEET_SHIP_NAMES[Math.floor(Math.random() * STARFLEET_SHIP_NAMES.length)]!;
  let n = 2;
  let candidate = base;
  while (exclude.has(candidate)) {
    candidate = `${base} #${n}`;
    n += 1;
  }
  lastPicked = candidate;
  return candidate;
}

/** Pick a random registry name; avoids immediate repeat when possible. */
export function pickRandomShipName(): string {
  return pickUniqueShipName(new Set(lastPicked ? [lastPicked] : []));
}

/** Reset repeat-avoidance (e.g. tests). */
export function resetShipNamePicker(): void {
  lastPicked = null;
}
