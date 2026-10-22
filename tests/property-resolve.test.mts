import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProperty, type ResolvableProperty } from "../src/lib/properties/resolve.ts";

// A slice of the real managed properties (AppFolio property_directory, Oct 2026), near-misses included.
const P = (property_id: number, property_name: string, property_street: string, property_street2: string | null = null): ResolvableProperty => ({
  property_id, property_integration_id: `00000000-0000-0000-0000-${String(property_id).padStart(12, "0")}`, property_name, property_street, property_street2,
});
const properties = [
  P(4, "Dee Jay and The Joint", "2716 Ellendale Place"),
  P(20, "Studio 42", "2642 Ellendale Place"),
  P(95, "2646 Ellendale", "2644 - 2646 Ellendale Pl"),
  P(102, "1340 W 37th St", "1340 W 37th St"),
  P(105, "1410 W 37th Place", "1410 West 37th Place"),
  P(106, "1280 W 37th Place", "1280 W 37th Place"),
  P(59, "The Cube", "1129 West 37th Street"),
  P(88, "1301-1303 W 22nd St", "1301-1303 West", "22nd Street"),
  P(99, "EI-USC 1237", "1237 West 25th St"),
  P(110, "1237 W 25th St", "1237 W 25th St"),
  P(81, "2134 Magnolia Ave", "2134 Magnolia Ave, Los Angeles, CA 90007"),
];
const resolve = (q: string) => resolveProperty(q, properties);
const id = (q: string) => {
  const r = resolve(q);
  return r.kind === "match" ? r.property.property_id : r.kind;
};

describe("property resolution — the four n8n samples", () => {
  it("full address with unit and city/zip tail", () => {
    const r = resolve("2642 Ellendale Place Unit 101, Los Angeles, CA 90007");
    assert.equal(r.kind, "match");
    assert.equal(r.kind === "match" && r.property.property_id, 20);
    assert.equal(r.kind === "match" && r.confidence, 1);
  });
  it("W + Place", () => assert.equal(id("1280 W 37th Place"), 106));
  it("number + street name only", () => assert.equal(id("2716 Ellendale"), 4));
  it("a building we don't manage → no match", () => assert.equal(id("The Lofts on Hoover"), "none"));
});

describe("property resolution — tolerance", () => {
  it("West/W, Street/St, Pl/Place", () => {
    assert.equal(id("1280 West 37th Pl."), 106);
    assert.equal(id("1129 W 37th St"), 59);
    assert.equal(id("1303 W. 22nd Street"), 88);
  });
  it("numbers inside a range, apt / # suffixes", () => {
    assert.equal(id("2645 Ellendale Pl #3"), 95);
    assert.equal(id("2134 Magnolia Avenue Apt 2, LA 90007"), 81);
  });
  it("St vs Place is a different building", () => assert.equal(id("1340 W 37th Place"), "none"));
  it("wrong number → no match", () => assert.equal(id("2700 Ellendale Place"), "none"));
  it("by name", () => assert.equal(id("Dee Jay and the Joint"), 4));
  it("two managed properties at the same address → ambiguous", () => assert.equal(id("1237 W 25th Street"), "ambiguous"));
});
