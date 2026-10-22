import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLeadInquiry, parsePqSubmission } from "../src/lib/leads/webhook-payloads.ts";

const full = {
  submission_id: "pq_2026-10-22_8f3a1c",
  name: "Jane Doe",
  email: "jane.doe@usc.edu",
  phone: "(310) 555-0123",
  property: "The Lofts on Hoover",
  move_in: "2027-08-15",
  budget: "1200-1500",
  room_type: "Private room",
  group_size: 2,
  length_of_stay: "12 months",
  qualify_method: "Guarantor",
  submitted_at: "2026-10-22T17:45:00Z",
  score: 82,
  tier: "A",
};

describe("PQ payload", () => {
  it("accepts the documented payload unchanged", () => {
    const r = parsePqSubmission(full);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { ...full, submitted_at: "2026-10-22T17:45:00.000Z" });
  });
  it("requires submission_id", () => {
    assert.deepEqual(parsePqSubmission({ ...full, submission_id: "  " }), { ok: false, error: "submission_id is required" });
    assert.equal(parsePqSubmission({ email: "a@b.co" }).ok, false);
  });
  it("only submission_id is mandatory; missing and empty fields become null", () => {
    const r = parsePqSubmission({ submission_id: 123, email: "", score: "" });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.submission_id, "123");
      assert.equal(r.value.email, null);
      assert.equal(r.value.score, null);
      assert.equal(r.value.submitted_at, null);
    }
  });
  it("coerces numeric strings and numeric budgets", () => {
    const r = parsePqSubmission({ submission_id: "x", score: "77.5", group_size: "3", budget: 1400 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual([r.value.score, r.value.group_size, r.value.budget], [77.5, 3, "1400"]);
  });
  it("rejects bad types and dates with a readable message", () => {
    assert.deepEqual(parsePqSubmission({ submission_id: "x", score: "high" }), { ok: false, error: "score must be a number" });
    assert.deepEqual(parsePqSubmission({ submission_id: "x", group_size: 1.5 }), { ok: false, error: "group_size must be a whole number ≥ 1" });
    assert.equal(parsePqSubmission({ submission_id: "x", submitted_at: "yesterday" }).ok, false);
    assert.equal(parsePqSubmission({ submission_id: "x", name: { first: "J" } }).ok, false);
    assert.equal(parsePqSubmission([full]).ok, false);
  });
  it("drops unknown keys", () => {
    const r = parsePqSubmission({ ...full, credit_score: 700 });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal("credit_score" in r.value, false);
  });
});

describe("lead inquiry payload", () => {
  it("accepts the documented payload", () => {
    const body = { email: "jane.doe@usc.edu", phone: "(310) 555-0123", name: "Jane Doe", source: "Zillow" };
    assert.deepEqual(parseLeadInquiry(body), { ok: true, value: body });
  });
  it("every field is optional at this layer; blanks become null", () => {
    assert.deepEqual(parseLeadInquiry({ phone: " 3105550123 ", email: "" }), { ok: true, value: { email: null, phone: "3105550123", name: null, source: null } });
  });
  it("rejects non-objects and wrong types", () => {
    assert.equal(parseLeadInquiry("jane@usc.edu").ok, false);
    assert.deepEqual(parseLeadInquiry({ email: ["a@b.co"] }), { ok: false, error: "email must be a string" });
  });
});
