import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { businessHoursBetween, inquirySummary, needsAttention, notifiedLabel } from "../src/lib/leads/row-info.ts";
import { parseLeadNotified } from "../src/lib/leads/webhook-payloads.ts";
import type { LeadEvent, LeadView } from "../src/lib/leads/types.ts";

const agents = [{ name: "Jennifer Villanueva", email: "jennifer@scshdev.com" }];
const h = (a: string, b: string) => businessHoursBetween(new Date(a), new Date(b));

describe("business hours (Mon–Fri 9:00–17:30 LA)", () => {
  it("counts only open hours", () => {
    // Thu Oct 22 2026, PDT (UTC-7): 15:00 → Fri 10:00 = 2.5 + 1
    assert.equal(h("2026-10-22T22:00:00Z", "2026-10-23T17:00:00Z"), 3.5);
    // Fri 17:00 → Mon 9:30 = 0.5 + 0.5 (weekend skipped)
    assert.equal(h("2026-10-23T24:00:00Z", "2026-10-26T16:30:00Z"), 1);
    // overnight / before opening counts nothing
    assert.equal(h("2026-10-22T02:00:00Z", "2026-10-22T15:00:00Z"), 0);
  });
  it("handles the switch to PST (Nov 1 2026)", () => {
    // Fri Oct 30 9:00 PDT → Mon Nov 2 9:00 PST = one full day
    assert.equal(h("2026-10-30T16:00:00Z", "2026-11-02T17:00:00Z"), 8.5);
  });
});

describe("Notified label", () => {
  const now = new Date("2026-10-22T23:00:00Z");
  it("agent + time today, date otherwise, test redirect, none", () => {
    assert.equal(notifiedLabel({ at: "2026-10-22T22:12:00Z", channel: "email", recipient: "jennifer@scshdev.com", test: false }, agents, now), "Jennifer · 3:12 PM");
    assert.equal(notifiedLabel({ at: "2026-10-21T22:12:00Z", channel: "email", recipient: "jennifer@scshdev.com", test: false }, agents, now), "Jennifer · Oct 21, 3:12 PM");
    assert.equal(notifiedLabel({ at: "2026-10-22T22:12:00Z", channel: "email", recipient: "savas@scshdev.com", test: true }, agents, now), "→ savas@ (test)");
    assert.equal(notifiedLabel(null, agents, now), "not sent");
  });
});

describe("inquiry summary", () => {
  const ev = (type: string, payload: Record<string, unknown>, at = "2026-10-20T18:00:00Z"): LeadEvent => ({ id: 1, lead_id: 1, type, payload, at, actor: null });
  it("n8n summary, PQ answers, AppFolio inquiries", () => {
    assert.deepEqual(
      inquirySummary([
        ev("inquiry", { summary: "Looking for 2 rooms for Aug", source: "SCSH Email Inquiry (Zillow)" }),
        ev("form", { move_in: "Aug 2027", budget: "1200", group_size: 2, score: 82, tier: "A", notes: "near campus" }),
        ev("inquiry", { source: "Zillow Rental Network", property_name: "Studio 42" }),
      ]),
      ["Looking for 2 rooms for Aug", "PQ form: “near campus” · move-in Aug 2027 · budget 1200 · 2 people · score 82 (A)", "Inquiry via Zillow Rental Network for Studio 42 · Oct 20, 2026"],
    );
  });
});

describe("needs attention", () => {
  const base = {
    id: 1, guest_card_id: null, email_norm: null, phone_norm: null, name: "X", first_seen_at: "2026-10-19T17:00:00Z", source_first: null,
    owner_agent_id: 1, rotation: "B", converted_from_b: false, has_form: false, has_application: false, stage: "new", status: "active",
    duplicate_of_lead_id: null, appfolio_assigned_user: null, owner_mismatch: false, assigned_via: "rotation", assigned_at: "2026-10-19T17:00:00Z",
    turn_agent_id: 1, turn_rotation: "B", turn_at: "2026-10-19T17:00:00Z", last_event_at: "2026-10-19T16:59:00Z", appfolio_status: "Active",
    property_name: null, pq_score: null, pq_tier: null, owner_name: "Jennifer", qualified_at: null, tour_booked: false, application_status: null,
    stage_now: "new", channel: "other", appfolio_last_activity: null, appfolio_last_activity_type: null, notified: null, replied_at: null,
  } as LeadView;
  const now = new Date("2026-10-22T23:00:00Z"); // Thu 4 PM; assigned Mon 10 AM → 7.5 + 8.5 + 8.5 + 7 = 31.5 business hours
  it("overdue after 24 business hours without a touch", () => {
    const [row] = needsAttention([base], now, "2026-10-01T00:00:00Z");
    assert.equal(row.business_hours, 31.5);
    assert.equal(row.hours_overdue, 7.5);
  });
  it("an agent text in AppFolio, a reply or new inquiry clears it; system activity doesn't", () => {
    assert.equal(needsAttention([{ ...base, appfolio_last_activity: "2026-10-19", appfolio_last_activity_type: "Text Sent" }], now, null).length, 0);
    assert.equal(needsAttention([{ ...base, appfolio_last_activity: "2026-10-19", appfolio_last_activity_type: "Guest Card Created" }], now, null).length, 1);
    assert.equal(needsAttention([{ ...base, last_event_at: "2026-10-20T18:00:00Z" }], now, null).length, 0);
    assert.equal(needsAttention([{ ...base, assigned_via: "appfolio", assigned_at: "2026-10-19T17:00:00Z" }], now, "2026-11-01T07:00:00Z").length, 0);
  });
});

describe("notified payload", () => {
  it("validates and normalizes", () => {
    assert.deepEqual(parseLeadNotified({ lead_id: 12, channel: "email", recipient: "Jen@SCSHdev.com", test_redirect: true, sent_at: "2026-10-22T22:12:00Z" }), {
      ok: true,
      value: { lead_id: 12, channel: "email", recipient: "jen@scshdev.com", test_redirect: true, sent_at: "2026-10-22T22:12:00.000Z" },
    });
    assert.equal(parseLeadNotified({ lead_id: 12 }).ok, false);
    assert.equal(parseLeadNotified({ lead_id: "x", recipient: "a@b.co" }).ok, false);
    assert.equal(parseLeadNotified({ lead_id: 1, recipient: "a@b.co", test_redirect: "yes" }).ok, false);
  });
});
