import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byAgent, byChannel, funnel, funnelLevel, laDay, weekly } from "../src/lib/leads/activity.ts";
import { leadRange } from "../src/lib/leads/analytics.ts";
import type { Agent, LeadView } from "../src/lib/leads/types.ts";

const NOW = new Date("2026-10-22T18:00:00Z");
const agents: Agent[] = [
  { id: 1, name: "Jennifer", email: "j@x", appfolio_name: null, active: true, a_turns: 0, b_turns: 0, last_assigned_at: null },
  { id: 2, name: "Arianne", email: "a@x", appfolio_name: null, active: true, a_turns: 0, b_turns: 0, last_assigned_at: null },
];

let nextId = 1;
function lead(over: Partial<LeadView>): LeadView {
  return {
    id: nextId++, guest_card_id: null, email_norm: null, phone_norm: null, name: "Lead", first_seen_at: "2026-10-20T17:00:00Z",
    source_first: null, owner_agent_id: null, rotation: "B", converted_from_b: false, has_form: false, has_application: false,
    stage: "new", status: "active", duplicate_of_lead_id: null, appfolio_assigned_user: null, owner_mismatch: false, assigned_via: null,
    assigned_at: null, turn_agent_id: null, turn_rotation: null, turn_at: null, last_event_at: null, appfolio_status: null,
    property_name: null, pq_score: null, pq_tier: null, owner_name: null, qualified_at: null, tour_booked: false,
    application_status: null, stage_now: "new", channel: "other", appfolio_last_activity: null, appfolio_last_activity_type: null, ...over,
  };
}

describe("funnel", () => {
  it("places each lead at the furthest step and counts cumulatively", () => {
    assert.equal(funnelLevel(lead({})), 0);
    assert.equal(funnelLevel(lead({ stage: "contacted" })), 1);
    assert.equal(funnelLevel(lead({ stage: "not_interested", tour_booked: true })), 2);
    assert.equal(funnelLevel(lead({ has_application: true })), 3);
    assert.equal(funnelLevel(lead({ has_application: true, application_status: "Converted" })), 4);
    const range = leadRange({}, NOW, 90);
    const c = funnel([lead({}), lead({ stage: "contacted" }), lead({ stage: "leased", has_application: true }), lead({ status: "test", stage: "leased" })], range);
    assert.deepEqual(c, { leads: 3, contacted: 2, tour: 1, application: 1, lease: 1 });
  });
  it("uses the LA calendar day for the range edge", () => {
    assert.equal(laDay("2026-10-23T06:30:00Z"), "2026-10-22");
    const range = leadRange({ from: "2026-10-22", to: "2026-10-22" }, NOW);
    assert.equal(funnel([lead({ first_seen_at: "2026-10-23T06:30:00Z" }), lead({ first_seen_at: "2026-10-23T07:30:00Z" })], range).leads, 1);
  });
});

describe("channels and agents", () => {
  const range = leadRange({}, NOW, 90);
  const ls = [
    lead({ channel: "inbox_zillow", owner_agent_id: 1 }),
    lead({ channel: "inbox_zillow", owner_agent_id: 1, rotation: "A", converted_from_b: true, tour_booked: true }),
    lead({ channel: "website_form", owner_agent_id: 2, rotation: "A", has_application: true }),
    lead({ channel: "feed_zillow" }),
  ];
  it("groups by channel, biggest first", () => {
    const rows = byChannel(ls, range);
    assert.deepEqual(rows.map((r) => [r.channel, r.leads, r.tour]), [["inbox_zillow", 2, 1], ["feed_zillow", 1, 0], ["website_form", 1, 1]]);
  });
  it("splits A / B / B→A per owner, unassigned last", () => {
    const { rows, total } = byAgent(ls, agents, range);
    assert.deepEqual(rows.map((r) => [r.name, r.a_leads, r.b_leads, r.converted, r.tours, r.applications]), [
      ["Jennifer", 0, 2, 1, 1, 0],
      ["Arianne", 1, 0, 0, 1, 1],
      ["Unassigned", 0, 1, 0, 0, 0],
    ]);
    assert.deepEqual([total.a_leads, total.b_leads, total.converted], [1, 3, 1]);
  });
});

describe("weekly vs last year", () => {
  it("buckets Monday weeks clipped to the range and compares 364 days earlier", () => {
    const range = leadRange({ from: "2026-10-07", to: "2026-10-20" }, NOW);
    const ls = [
      lead({ first_seen_at: "2026-10-07T19:00:00Z" }),
      lead({ first_seen_at: "2026-10-19T19:00:00Z" }),
      lead({ first_seen_at: "2025-10-08T19:00:00Z" }), // 364 days before 2026-10-07
    ];
    const w = weekly(ls, range);
    assert.deepEqual(w.map((r) => [r.week, r.from, r.to, r.thisYear, r.lastYear]), [
      ["2026-10-05", "2026-10-07", "2026-10-11", 1, 1],
      ["2026-10-12", "2026-10-12", "2026-10-18", 0, 0],
      ["2026-10-19", "2026-10-19", "2026-10-20", 1, 0],
    ]);
  });
  it("shows no data (null), not zero, before August 2025", () => {
    const w = weekly([], leadRange({ from: "2026-07-27", to: "2026-08-09" }, NOW));
    assert.deepEqual(w.map((r) => r.lastYear), [null, 0]);
    assert.deepEqual(weekly([], leadRange({ from: "2025-07-28", to: "2025-08-03" }, NOW)).map((r) => r.thisYear), [null]);
  });
});
