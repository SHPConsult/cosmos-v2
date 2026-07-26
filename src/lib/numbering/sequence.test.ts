import { describe, expect, it } from "vitest";
import {
  nextSequenceNumber,
  formatSequence,
  invoicePrefix,
  quotePrefix,
  changeOrderPrefix,
  shortChangeOrderNumber,
} from "./sequence";

describe("nextSequenceNumber", () => {
  const P = "INV-2026-";

  it("starts at 1 when nothing exists", () => {
    expect(nextSequenceNumber([], P)).toBe(1);
  });

  it("continues from the highest, not the count", () => {
    expect(nextSequenceNumber([`${P}0001`, `${P}0002`], P)).toBe(3);
  });

  it("survives a GAP — the whole reason this isn't count()+1", () => {
    // Hand-keyed cutover data, or a deleted void, leaves holes. count()+1 would
    // return 3 here and collide with an existing 0003.
    const existing = [`${P}0001`, `${P}0003`, `${P}0004`];
    expect(nextSequenceNumber(existing, P)).toBe(5);
  });

  it("never reissues a number after deletion", () => {
    expect(nextSequenceNumber([`${P}0007`], P)).toBe(8);
  });

  it("ignores numbers from other years and other prefixes", () => {
    const existing = [`${P}0009`, "INV-2025-0400", "Q-2026-0100"];
    expect(nextSequenceNumber(existing, P)).toBe(10);
  });

  it("ignores compound change-order numbers when minting estimates", () => {
    // Q-2026-0042-CO-001 must not be read as sequence 42 or as a huge number.
    const existing = ["Q-2026-0042", "Q-2026-0042-CO-001", "Q-2026-0043"];
    expect(nextSequenceNumber(existing, quotePrefix(2026))).toBe(44);
  });

  it("ignores a non-numeric tail rather than NaN-ing", () => {
    expect(nextSequenceNumber([`${P}draft`, `${P}0002`], P)).toBe(3);
  });

  it("handles a sequence past the padding width", () => {
    expect(nextSequenceNumber([`${P}9999`], P)).toBe(10000);
  });
});

describe("formatSequence", () => {
  it("zero-pads to the requested width", () => {
    expect(formatSequence(invoicePrefix(2026), 1)).toBe("INV-2026-0001");
    expect(formatSequence(quotePrefix(2026), 42)).toBe("Q-2026-0042");
  });

  it("widens rather than truncating past the pad", () => {
    expect(formatSequence(invoicePrefix(2026), 10000)).toBe("INV-2026-10000");
  });

  it("pads change orders to three, per trade convention", () => {
    expect(formatSequence(changeOrderPrefix("Q-2026-0042"), 1, 3)).toBe(
      "Q-2026-0042-CO-001",
    );
  });
});

describe("change-order numbering", () => {
  it("is sequential per parent, and unique org-wide by construction", () => {
    const onCostco = ["Q-2026-0042-CO-001", "Q-2026-0042-CO-002"];
    const onDixie = ["Q-2026-0043-CO-001"];
    const all = [...onCostco, ...onDixie];
    // Both estimates can have their own CO-001 without colliding.
    expect(nextSequenceNumber(all, changeOrderPrefix("Q-2026-0042"))).toBe(3);
    expect(nextSequenceNumber(all, changeOrderPrefix("Q-2026-0043"))).toBe(2);
  });

  it("renders the short form the trade actually says", () => {
    expect(shortChangeOrderNumber("Q-2026-0042-CO-001")).toBe("CO-001");
  });

  it("leaves a plain estimate number alone", () => {
    expect(shortChangeOrderNumber("Q-2026-0042")).toBe("Q-2026-0042");
  });
});
