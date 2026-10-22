import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapGuestCardFlags, unresolvedPropertyNote } from "../src/lib/appfolio/mappers/guest-card-flags.ts";
import { groupOf, isOpen, lastActivityDay, myLeads } from "../src/lib/leads/my-leads.ts";
import type { LeadView } from "../src/lib/leads/types.ts";

const NOW = new Date("2026-10-22T18:00:00Z");
let nextId = 1;
function lead(over: Partial<LeadView>): LeadView {
  return {
    id: nextId++, guest_card_id: null, email_norm: null, phone_norm: null, name: "Lead", first_seen_at: "2026-10-01T17:00:00Z",
    source_first: null, owner_agent_id: 1, rotation: "B", converted_from_b: false, has_form: false, has_application: false,
    stage: "new", status: "active", duplicate_of_lead_id: null, appfolio_assigned_user: null, owner_mismatch: false, assigned_via: null,
    assigned_at: null, turn_agent_id: null, turn_rotation: null, turn_at: null, last_event_at: null, appfolio_status: "Active",
    property_name: null, pq_score: null, pq_tier: null, owner_name: null, qualified_at: null, tour_booked: false,
    application_status: null, stage_now: "new", channel: "other", replied_at: null, appfolio_last_activity: null, appfolio_last_activity_type: null, ...over,
  };
}

describe("My leads groups", () => {
  it("application > tour > active (A or replied) > nurturing", () => {
    assert.equal(groupOf(lead({ has_application: true, tour_booked: true })), "application");
    assert.equal(groupOf(lead({ has_application: true, application_status: "Denied", tour_booked: true })), "tour");
    assert.equal(groupOf(lead({ rotation: "A" })), "active");
    assert.equal(groupOf(lead({ replied_at: "2026-10-05T19:00:00Z" })), "active");
    assert.equal(groupOf(lead({})), "nurturing");
  });
  it("closed leads are left out; AppFolio Inactive only on request", () => {
    assert.equal(isOpen(lead({ stage: "leased" })), false);
    assert.equal(isOpen(lead({ status: "not_interested" })), false);
    assert.equal(isOpen(lead({ has_application: true, application_status: "Converted" })), false);
    assert.equal(isOpen(lead({ appfolio_status: "Inactive" })), false);
    assert.equal(isOpen(lead({ appfolio_status: "Inactive" }), true), true);
  });
  it("last activity = latest of AppFolio activity, events, reply, first seen", () => {
    assert.equal(lastActivityDay(lead({ last_event_at: "2026-10-03T18:00:00Z", appfolio_last_activity: "2026-10-09" })), "2026-10-09");
    assert.equal(lastActivityDay(lead({})), "2026-10-01");
  });
  it("Nurturing is stalest first with days idle; only the chosen owners", () => {
    const stale = lead({ appfolio_last_activity: "2026-10-02" });
    const fresh = lead({ appfolio_last_activity: "2026-10-21" });
    const middle = lead({ last_event_at: "2026-10-10T20:00:00Z" });
    const other = lead({ owner_agent_id: 2 });
    const g = myLeads([fresh, other, stale, middle], new Set([1]), NOW);
    assert.deepEqual(g.nurturing.map((l) => [l.id, l.days_idle]), [[stale.id, 20], [middle.id, 12], [fresh.id, 1]]);
    assert.equal(myLeads([fresh, other], new Set([1, 2]), NOW).nurturing.length, 2);
  });
});

describe("Property unresolved note", () => {
  it("finds the entry with or without AppFolio's date prefix, keeps only that line", () => {
    assert.equal(unresolvedPropertyNote("Property unresolved: 123 Fake St\nother stuff"), "Property unresolved: 123 Fake St");
    assert.equal(unresolvedPropertyNote("10/21/2026, Call\n10/22/2026, Property unresolved: \"Lofts on Hoover\""), 'Property unresolved: "Lofts on Hoover"');
    assert.equal(unresolvedPropertyNote("Called about property unresolved: no"), null);
    assert.equal(unresolvedPropertyNote(null), null);
  });
  it("one flag per guest card", () => {
    const rows = mapGuestCardFlags([
      { guest_card_id: 5, notes: "Property unresolved: x" },
      { guest_card_id: 5, notes: "Property unresolved: x" },
      { guest_card_id: 6, notes: "Marked Inactive" },
    ]);
    assert.deepEqual(rows, [{ guest_card_id: 5, kind: "property_unresolved", note: "Property unresolved: x" }]);
  });
});
