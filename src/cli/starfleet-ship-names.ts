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

/** Pick a random registry name; avoids immediate repeat when possible. */
export function pickRandomShipName(): string {
  const names = STARFLEET_SHIP_NAMES;
  if (names.length === 0) return "Bozeman";
  if (names.length === 1) return names[0]!;

  let pick = names[Math.floor(Math.random() * names.length)]!;
  if (pick === lastPicked) {
    const others = names.filter((n) => n !== lastPicked);
    pick = others[Math.floor(Math.random() * others.length)] ?? pick;
  }
  lastPicked = pick;
  return pick;
}

/** Reset repeat-avoidance (e.g. tests). */
export function resetShipNamePicker(): void {
  lastPicked = null;
}
