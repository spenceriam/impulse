import { describe, expect, test } from "bun:test";
import {
  pickUniqueShipName,
  resetShipNamePicker,
  STARFLEET_SHIP_NAMES,
} from "../src/cli/starfleet-ship-names.js";

describe("pickUniqueShipName", () => {
  test("never duplicates within a batch of picks", () => {
    resetShipNamePicker();
    const used = new Set<string>();
    const batchSize = Math.min(15, STARFLEET_SHIP_NAMES.length);
    for (let i = 0; i < batchSize; i++) {
      const name = pickUniqueShipName(used);
      expect(used.has(name)).toBe(false);
      used.add(name);
    }
  });

  test("returns the only remaining name when pool is almost full", () => {
    resetShipNamePicker();
    const exclude = new Set(STARFLEET_SHIP_NAMES.slice(0, -1));
    const last = STARFLEET_SHIP_NAMES[STARFLEET_SHIP_NAMES.length - 1]!;
    expect(pickUniqueShipName(exclude)).toBe(last);
  });

  test("disambiguates when all registry names are taken", () => {
    resetShipNamePicker();
    const exclude = new Set(STARFLEET_SHIP_NAMES);
    const name = pickUniqueShipName(exclude);
    expect(exclude.has(name)).toBe(false);
    expect(name.includes("#")).toBe(true);
  });
});
