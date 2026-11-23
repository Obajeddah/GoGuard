import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv formula safety", () => {
  it("prefixes cells starting with = so spreadsheets don't run them", () => {
    expect(toCsv([{ name: "=HYPERLINK(1)" }])).toBe("name\n'=HYPERLINK(1)");
  });
  it("neutralises + - @ too", () => {
    expect(toCsv([{ a: "+1", b: "-2", c: "@x" }])).toBe("a,b,c\n'+1,'-2,'@x");
  });
  it("leaves normal names alone", () => {
    expect(toCsv([{ name: "Chidi Okeke" }])).toBe("name\nChidi Okeke");
  });
});
