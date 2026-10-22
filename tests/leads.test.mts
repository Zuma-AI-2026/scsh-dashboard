import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceStage,
  agentForAppfolioUser,
  applyEngagement,
  effectiveStage,
  identityOf,
  initialOwner,
  matchLead,
  normalizeEmail,
  normalizePhone,
  ownerMismatch,
  pickRotationAgent,
  rotationFor,
  stageForApplication,
  turnsInWindow,
  type LeadIdentity,
  type RotationAgent,
  type Turn,
} from "../src/lib/leads/rules.ts";

const NOW = new Date("2026-10-22T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const JEN = 1;
const ARI = 2;
const agents = (over: Partial<Record<number, Partial<RotationAgent>>> = {}): RotationAgent[] => [
  { id: JEN, active: true, last_assigned_at: null, ...over[JEN] },
  { id: ARI, active: true, last_assigned_at: null, ...over[ARI] },
];
const turn = (agent_id: number, rotation: "A" | "B", ago: number, status: Turn["status"] = "active"): Turn => ({ agent_id, rotation, at: daysAgo(ago), status });

describe("normalization", () => {
  it("lowercases and trims email, rejects junk", () => {
    assert.equal(normalizeEmail("  Jane.Doe@USC.edu "), "jane.doe@usc.edu");
    assert.equal(normalizeEmail("not-an-email"), null);
    assert.equal(normalizeEmail(""), null);
  });
  it("keeps digits only and drops a US +1", () => {
    assert.equal(normalizePhone("+1 (310) 625-2945"), "3106252945");
    assert.equal(normalizePhone("(310) 625-2945"), "3106252945");
    assert.equal(normalizePhone("+44 20 7946 0958"), "442079460958");
    assert.equal(normalizePhone("123"), null);
  });
  it("rejects a record with neither email nor phone", () => {
    assert.deepEqual(identityOf({ guest_card_id: 5, email: null, phone: "n/a" }), { ok: false, reason: "no_email_or_phone" });
    assert.equal(identityOf({ email: "a@b.co" }).ok, true);
  });
});

describe("identity matching", () => {
  const base = (over: Partial<LeadIdentity>): LeadIdentity => ({
    id: 0, guest_card_id: null, email_norm: null, phone_norm: null, status: "active", duplicate_of_lead_id: null, first_seen_at: daysAgo(30), ...over,
  });
  const leads = [
    base({ id: 1, guest_card_id: 100, email_norm: "a@x.com", phone_norm: "3105550001" }),
    base({ id: 2, email_norm: "b@x.com", phone_norm: "3105550002" }),
    base({ id: 3, phone_norm: "3105550003" }),
  ];
  it("prefers guest_card_id over email and phone", () => {
    assert.equal(matchLead(leads, { guest_card_id: 100, email_norm: "b@x.com", phone_norm: "3105550003" })?.id, 1);
  });
  it("falls back to email, then phone", () => {
    assert.equal(matchLead(leads, { guest_card_id: 999, email_norm: "b@x.com", phone_norm: "3105550003" })?.id, 2);
    assert.equal(matchLead(leads, { guest_card_id: null, email_norm: "new@x.com", phone_norm: "3105550003" })?.id, 3);
    assert.equal(matchLead(leads, { guest_card_id: null, email_norm: "new@x.com", phone_norm: null }), null);
  });
  it("resolves a duplicate to the lead it duplicates", () => {
    const withDup = [...leads, base({ id: 4, email_norm: "c@x.com", status: "duplicate_of", duplicate_of_lead_id: 2 })];
    assert.equal(matchLead(withDup, { guest_card_id: null, email_norm: "c@x.com", phone_norm: null })?.id, 2);
  });
  it("picks the oldest lead when several share an email", () => {
    const twins = [base({ id: 7, email_norm: "t@x.com", first_seen_at: daysAgo(2) }), base({ id: 8, email_norm: "t@x.com", first_seen_at: daysAgo(9) })];
    assert.equal(matchLead(twins, { guest_card_id: null, email_norm: "t@x.com", phone_norm: null })?.id, 8);
  });
});

describe("rotation choice", () => {
  it("A = form or application, B = everything else", () => {
    assert.equal(rotationFor({ has_form: true, has_application: false }), "A");
    assert.equal(rotationFor({ has_form: false, has_application: true }), "A");
    assert.equal(rotationFor({ has_form: false, has_application: false }), "B");
  });
  it("gives the lead to the agent with fewer turns of that rotation in 14 days", () => {
    const turns = [turn(JEN, "B", 1), turn(JEN, "B", 2), turn(ARI, "B", 3)];
    assert.equal(pickRotationAgent(agents(), turns, "B", NOW), ARI);
  });
  it("counts each rotation separately", () => {
    const turns = [turn(JEN, "B", 1), turn(JEN, "B", 2), turn(ARI, "A", 1)];
    assert.equal(pickRotationAgent(agents(), turns, "A", NOW), JEN);
    assert.equal(pickRotationAgent(agents(), turns, "B", NOW), ARI);
  });
  it("ignores turns older than 14 days", () => {
    const turns = [turn(JEN, "A", 15), turn(JEN, "A", 20), turn(ARI, "A", 1)];
    assert.equal(turnsInWindow(turns, JEN, "A", NOW), 0);
    assert.equal(pickRotationAgent(agents(), turns, "A", NOW), JEN);
  });
  it("on a tie picks the agent assigned longest ago, never-assigned first", () => {
    assert.equal(pickRotationAgent(agents({ [JEN]: { last_assigned_at: daysAgo(1) }, [ARI]: { last_assigned_at: daysAgo(3) } }), [], "B", NOW), ARI);
    assert.equal(pickRotationAgent(agents({ [JEN]: { last_assigned_at: daysAgo(1) } }), [], "B", NOW), ARI);
    assert.equal(pickRotationAgent(agents(), [], "B", NOW), JEN);
  });
  it("skips inactive agents and returns null when nobody is active", () => {
    assert.equal(pickRotationAgent(agents({ [ARI]: { active: false } }), [turn(JEN, "B", 1)], "B", NOW), JEN);
    assert.equal(pickRotationAgent(agents({ [JEN]: { active: false }, [ARI]: { active: false } }), [], "B", NOW), null);
  });
  it("test and duplicate leads give their turn back", () => {
    const turns = [turn(JEN, "A", 1, "test"), turn(JEN, "A", 2, "duplicate_of"), turn(ARI, "A", 1)];
    assert.equal(turnsInWindow(turns, JEN, "A", NOW), 0);
    assert.equal(pickRotationAgent(agents(), turns, "A", NOW), JEN);
  });
  it("not_interested and leased still count as turns", () => {
    const turns = [turn(JEN, "B", 1, "not_interested"), turn(JEN, "B", 2, "leased")];
    assert.equal(turnsInWindow(turns, JEN, "B", NOW), 2);
  });
});

describe("owner of a new lead", () => {
  const named = [
    { id: JEN, name: "Jennifer", appfolio_name: "Jennifer Villanueva", active: true },
    { id: ARI, name: "Arianne", appfolio_name: "Arianne Quinto", active: true },
  ];
  const GO_LIVE = daysAgo(10);
  const before = daysAgo(40);
  const after = daysAgo(2);
  it("AppFolio's assigned user wins with no turn when it is an active agent, before or after go-live", () => {
    assert.deepEqual(initialOwner(named, "jennifer villanueva", before, GO_LIVE), { via: "appfolio", agent_id: JEN });
    assert.deepEqual(initialOwner(named, "Arianne Quinto", after, GO_LIVE), { via: "appfolio", agent_id: ARI });
  });
  it("before go-live, anyone else's lead stays unassigned (no turn)", () => {
    assert.deepEqual(initialOwner(named, "Robert Tapel (Hidden)", before, GO_LIVE), { via: "unassigned" });
    assert.deepEqual(initialOwner(named, null, before, GO_LIVE), { via: "unassigned" });
  });
  it("after go-live, former or unknown AppFolio users go to rotation", () => {
    assert.deepEqual(initialOwner(named, "Robert Tapel (Hidden)", after, GO_LIVE), { via: "rotation" });
    assert.deepEqual(initialOwner(named, null, after, GO_LIVE), { via: "rotation" });
  });
  it("an inactive agent's name does not claim ownership", () => {
    assert.equal(agentForAppfolioUser([{ ...named[0], active: false }], "Jennifer Villanueva"), null);
  });
  it("flags owner_mismatch only when AppFolio names someone other than the owner", () => {
    assert.equal(ownerMismatch(named[0], "Jennifer Villanueva"), false);
    assert.equal(ownerMismatch(named[0], "Arianne Quinto"), true);
    assert.equal(ownerMismatch(named[0], null), false);
    assert.equal(ownerMismatch(null, "Arianne Quinto"), false);
  });
});

describe("B → A conversion", () => {
  it("a B lead that submits a form moves to A, keeps its owner, and is marked converted", () => {
    const after = applyEngagement({ rotation: "B", converted_from_b: false, has_form: false, has_application: false }, "form");
    assert.deepEqual(after, { rotation: "A", converted_from_b: true, has_form: true, has_application: false, converted_now: true });
  });
  it("an A lead that applies is not marked converted", () => {
    const after = applyEngagement({ rotation: "A", converted_from_b: false, has_form: true, has_application: false }, "application");
    assert.equal(after.converted_from_b, false);
    assert.equal(after.converted_now, false);
    assert.equal(after.has_application, true);
  });
  it("a second engagement does not convert twice", () => {
    const after = applyEngagement({ rotation: "A", converted_from_b: true, has_form: true, has_application: false }, "application");
    assert.equal(after.converted_now, false);
    assert.equal(after.converted_from_b, true);
  });
});

describe("stages", () => {
  it("only moves forward", () => {
    assert.equal(advanceStage("tour", "contacted"), "tour");
    assert.equal(advanceStage("contacted", "tour"), "tour");
    assert.equal(advanceStage("leased", "application"), "leased");
  });
  it("Converted application means leased; anything else means application", () => {
    assert.equal(stageForApplication("tour", "Converted"), "leased");
    assert.equal(stageForApplication("new", "Decision Pending"), "application");
    assert.equal(stageForApplication("not_interested", "Approved"), "not_interested");
  });
  it("a B lead with no event for more than 7 days reads as expired", () => {
    const lead = { rotation: "B" as const, stage: "contacted" as const, last_event_at: daysAgo(8), first_seen_at: daysAgo(20) };
    assert.equal(effectiveStage(lead, NOW), "expired");
    assert.equal(effectiveStage({ ...lead, last_event_at: daysAgo(6) }, NOW), "contacted");
    assert.equal(effectiveStage({ ...lead, rotation: "A" }, NOW), "contacted");
    assert.equal(effectiveStage({ ...lead, stage: "leased" }, NOW), "leased");
  });
});
