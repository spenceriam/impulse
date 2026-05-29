import { describe, expect, test, beforeEach } from "bun:test";
import {
  STARFLEET_SHIP_NAMES,
  pickRandomShipName,
  resetShipNamePicker,
} from "../src/cli/starfleet-ship-names.js";

const HERO_SHIPS = [
  "Enterprise",
  "Voyager",
  "Defiant",
  "Discovery",
  "Intrepid",
  "Cerritos",
  "Titan",
  "Shenzhou",
];

describe("starfleet ship names", () => {
  beforeEach(() => {
    resetShipNamePicker();
  });

  test("bank uses obscure registry names only", () => {
    expect(STARFLEET_SHIP_NAMES.length).toBeGreaterThan(20);
    for (const hero of HERO_SHIPS) {
      expect(STARFLEET_SHIP_NAMES).not.toContain(hero);
    }
    expect(STARFLEET_SHIP_NAMES).toContain("Bozeman");
    expect(STARFLEET_SHIP_NAMES).not.toContain("Deep Space Nine");
    expect(STARFLEET_SHIP_NAMES.join(" ")).not.toMatch(/IKS|Klingon|Romulan/i);
  });

  test("pickRandomShipName returns a name from the bank", () => {
    const name = pickRandomShipName();
    expect(STARFLEET_SHIP_NAMES).toContain(name);
  });

  test("pickRandomShipName avoids immediate repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const a = pickRandomShipName();
      const b = pickRandomShipName();
      if (a === b && STARFLEET_SHIP_NAMES.length > 1) {
        expect.unreachable("consecutive picks should not repeat");
      }
      seen.add(a);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
