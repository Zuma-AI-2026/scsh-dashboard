import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { channelLabel, conversionByOwner, filterRotation, formatPhone, leadRange, rotationCsv, toCsv, turnsInRange } from "../src/lib/leads/analytics.ts";
import type { Agent, LeadView } from "../src/lib/leads/types.ts";

const NOW = new Date("2026-10-22T18:00:00Z"); // 11:00 in Los Angeles
const agents: Agent[] = [
  { id: 1, name: "Jennifer", email: "jennifer@scshdev.com", appfolio_name: "Jennifer Villanueva", active: true, a_turns: 0, b_turns: 0, last_assigned_at: null },
  { id: 2, name: "Arianne", email: "arianne@scshdev.com", appfolio_name: "Arianne Quinto", active: true, a_turns: 0, b_turns: 0, last_assigned_at: null },
  { id: 3, name: "Former", email: "former@scshdev.com", appfolio_name: null, active: false, a_turns: 0, b_turns: 0, last_assigned_at: null },
];

let nextId = 1;
function lead(over: Partial<LeadView>): LeadView {
  return {
    id: nextId++, guest_card_id: null, notified: null, email_norm: null, phone_norm: "3105550000", name: "Lead", first_seen_at: "2026-10-20T17:00:00Z",
    source_first: "Zillow", owner_agent_id: null, rotation: "B", converted_from_b: false, has_form: false, has_application: false,
    stage: "new", status: "active", duplicate_of_lead_id: null, appfolio_assigned_user: null, owner_mismatch: false, assigned_via: null,
    assigned_at: null, turn_agent_id: null, turn_rotation: null, turn_at: null, last_event_at: null, appfolio_status: null,
    property_name: null, pq_score: null, pq_tier: null, owner_name: null, qualified_at: null, tour_booked: false,
    application_status: null, stage_now: "new", channel: "other", appfolio_last_activity: null, appfolio_last_activity_type: null, ...over,
  };
}
const turn = (agent: number, rotation: "A" | "B", at: string, over: Partial<LeadView> = {}) =>
  lead({ owner_agent_id: agent, turn_agent_id: agent, turn_rotation: rotation, turn_at: at, first_seen_at: at, rotation, ...over });

describe("date range", () => {
  it("defaults to the last 30 LA calendar days, today included", () => {
    const r = leadRange({}, NOW);
    assert.equal(r.from, "2026-09-23");
    assert.equal(r.to, "2026-10-22");
    assert.equal(r.start.toISOString(), "2026-09-23T07:00:00.000Z");
    assert.equal(r.end.toISOString(), "2026-10-23T07:00:00.000Z");
  });
  it("honours ?from / ?to and ignores junk", () => {
    const r = leadRange({ from: "2026-10-01", to: "nonsense" }, NOW);
    assert.deepEqual([r.from, r.to], ["2026-10-01", "2026-10-22"]);
  });
});

describe("rotation lists", () => {
  const range = leadRange({}, NOW);
  const formLead = lead({ rotation: "A", name: "Ann Form", first_seen_at: "2026-08-01T00:00:00Z", qualified_at: "2026-10-10T00:00:00Z", owner_agent_id: 1 });
  const bLead = lead({ rotation: "B", name: "Bo Inquiry", email_norm: "bo@usc.edu", owner_agent_id: 2, owner_mismatch: true });
  const testLead = lead({ rotation: "B", status: "test" });
  const dupLead = lead({ rotation: "A", status: "duplicate_of", duplicate_of_lead_id: 1 });
  const old = lead({ rotation: "B", first_seen_at: "2026-08-01T00:00:00Z" });
  const unowned = lead({ rotation: "B", owner_agent_id: null, phone_norm: "2135551234" });
  const all = [formLead, bLead, testLead, dupLead, old, unowned];

  it("A lists form/application leads by the date they qualified", () => {
    assert.deepEqual(filterRotation(all, "A", {}, range).map((r) => r.id), [formLead.id]);
    assert.equal(filterRotation(all, "A", {}, range)[0].date, "2026-10-10T00:00:00Z");
  });
  it("B lists no-form leads by first seen, without test/duplicate or out-of-range leads", () => {
    assert.deepEqual(filterRotation(all, "B", {}, range).map((r) => r.id), [bLead.id, unowned.id]);
  });
  it("filters by agent, unassigned, mismatch and search (name, email, phone digits)", () => {
    assert.deepEqual(filterRotation(all, "B", { agent: "2" }, range).map((r) => r.id), [bLead.id]);
    assert.deepEqual(filterRotation(all, "B", { agent: "none" }, range).map((r) => r.id), [unowned.id]);
    assert.deepEqual(filterRotation(all, "B", { mismatch: "1" }, range).map((r) => r.id), [bLead.id]);
    assert.deepEqual(filterRotation(all, "B", { q: "BO@usc" }, range).map((r) => r.id), [bLead.id]);
    assert.deepEqual(filterRotation(all, "B", { q: "(213) 555" }, range).map((r) => r.id), [unowned.id]);
  });
});

describe("header numbers", () => {
  const range = leadRange({}, NOW);
  it("counts turns per agent in range, skipping test/duplicate and other rotations", () => {
    const leads = [
      turn(1, "A", "2026-10-21T00:00:00Z"),
      turn(1, "A", "2026-10-05T00:00:00Z"),
      turn(2, "A", "2026-10-21T00:00:00Z", { status: "test" }),
      turn(2, "B", "2026-10-21T00:00:00Z"),
      turn(1, "A", "2026-08-01T00:00:00Z"),
      turn(3, "A", "2026-10-02T00:00:00Z"),
    ];
    assert.deepEqual(turnsInRange(leads, agents, "A", range).map((t) => [t.name, t.turns]), [["Jennifer", 2], ["Arianne", 0], ["Former", 1]]);
    assert.deepEqual(turnsInRange(leads, agents, "B", range).map((t) => [t.name, t.turns]), [["Jennifer", 0], ["Arianne", 1]]);
  });
  it("B → A conversion counts leads that started on B, by owner", () => {
    const leads = [
      lead({ rotation: "B", owner_agent_id: 1 }),
      lead({ rotation: "A", converted_from_b: true, owner_agent_id: 1 }),
      lead({ rotation: "B", owner_agent_id: 2 }),
      lead({ rotation: "A", owner_agent_id: 2 }),
      lead({ rotation: "B", owner_agent_id: 2, status: "duplicate_of", duplicate_of_lead_id: 1 }),
    ];
    const { rows, total } = conversionByOwner(leads, agents, range);
    assert.deepEqual(rows.map((r) => [r.name, r.b_leads, r.converted]), [["Jennifer", 2, 1], ["Arianne", 1, 0]]);
    assert.deepEqual([total.b_leads, total.converted], [3, 1]);
  });
});

describe("CSV", () => {
  it("quotes, escapes and neutralises formulas", () => {
    assert.equal(toCsv(["a", "b"], [['say "hi", ok', "=SUM(A1)"], [null, true]]), 'a,b\r\n"say ""hi"", ok",\'=SUM(A1)\r\n,yes\r\n');
  });
  it("exports the A columns with owner fallback", () => {
    const csv = rotationCsv([{ ...lead({ rotation: "A", name: "Ann", phone_norm: "3105550123", converted_from_b: true }), date: "2026-10-10" }], "A");
    assert.match(csv, /^date,name,phone,email,property,score,tier,owner,channel,source,stage,converted_from_b,tour_booked/);
    assert.match(csv, /2026-10-10,Ann,\(310\) 555-0123,,,,,Unassigned,other,Zillow,new,yes,no/);
  });
  it("formats US and international phones", () => {
    assert.equal(formatPhone("3105550123"), "(310) 555-0123");
    assert.equal(formatPhone("442079460958"), "+442079460958");
  });
});

describe("channels", () => {
  it("labels known channels and any feed site", () => {
    assert.equal(channelLabel("inbox_och101"), "Inbox · OCH 101");
    assert.equal(channelLabel("feed_rent_com"), "Feed · Rent.com");
    assert.equal(channelLabel("feed_new_site"), "Feed · New site");
  });
  it("filters the rotation list by channel", () => {
    const range = leadRange({}, NOW);
    const z = lead({ channel: "inbox_zillow" });
    const f = lead({ channel: "feed_zillow" });
    assert.deepEqual(filterRotation([z, f], "B", { channel: "inbox_zillow" }, range).map((r) => r.id), [z.id]);
  });
});
