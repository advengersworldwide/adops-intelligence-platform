import { describe, it, expect } from "vitest";
import {
  isEmptyImpact, needsTypedConfirmation, canConfirm, primaryActionLabel, nullifySentence,
} from "./delete-impact-dialog";
import type { Impact, ImpactNode } from "@/lib/dependencies/types";

const base: Impact = {
  target: { table: "clients", id: 1, label: "Acme Corp", singular: "Client" },
  blockers: [], cascades: [], nullifies: [],
  canDeleteAll: true, blockedReason: null, missingPermissions: [],
  totals: { deletes: 1, nullifies: 0, touchesFinancial: false },
  fingerprint: "fp1",
};

const node = (over: Partial<ImpactNode> = {}): ImpactNode => ({
  table: "billings", id: 12, label: "CBILL-0012", singular: "Client Bill",
  href: null, canDelete: true, requiredPermission: "billings:edit",
  deleteEndpoint: "/api/billings/12", children: [], truncated: false, ...over,
});

describe("isEmptyImpact", () => {
  it("is true when nothing is affected", () => {
    expect(isEmptyImpact(base)).toBe(true);
  });

  it("is false when a blocker exists", () => {
    expect(isEmptyImpact({ ...base, blockers: [node()] })).toBe(false);
  });

  it("is false when a cascade exists", () => {
    expect(isEmptyImpact({ ...base, cascades: [{
      table: "client_events", label: "Client Events", count: 8, sample: [],
      canDelete: true, requiredPermission: "clients:edit",
    }] })).toBe(false);
  });
});

describe("needsTypedConfirmation", () => {
  it("is required when financial records are touched", () => {
    expect(needsTypedConfirmation({ ...base, totals: { ...base.totals, touchesFinancial: true } })).toBe(true);
  });

  it("is not required otherwise", () => {
    expect(needsTypedConfirmation(base)).toBe(false);
  });
});

describe("canConfirm", () => {
  it("allows confirming a non-financial delete with no typed input", () => {
    expect(canConfirm(base, "")).toBe(true);
  });

  it("blocks confirming while canDeleteAll is false, even with the name typed", () => {
    const locked = { ...base, canDeleteAll: false, missingPermissions: ["billings:edit"] };
    expect(canConfirm(locked, "Acme Corp")).toBe(false);
  });

  it("requires the exact target label when financial records are involved", () => {
    const financial = { ...base, totals: { ...base.totals, touchesFinancial: true } };
    expect(canConfirm(financial, "")).toBe(false);
    expect(canConfirm(financial, "acme corp")).toBe(false);
    expect(canConfirm(financial, "  Acme Corp  ")).toBe(true);
  });
});

describe("primaryActionLabel", () => {
  it("offers a plain delete when nothing blocks", () => {
    expect(primaryActionLabel(base)).toBe("Delete Client");
  });

  it("offers Delete All with the total blast radius when blockers exist", () => {
    const withBlockers = {
      ...base, blockers: [node()], totals: { ...base.totals, deletes: 154 },
    };
    expect(primaryActionLabel(withBlockers)).toBe("Delete All — 154 records");
  });
});

describe("nullifySentence", () => {
  it("renders a readable unlink line from the FK column", () => {
    expect(nullifySentence({
      table: "billing_records", column: "client_id", label: "Billing Records", count: 3,
    })).toBe("3 Billing Records will lose their client");
  });

  it("strips the _id suffix and underscores from a compound column", () => {
    expect(nullifySentence({
      table: "clients", column: "buying_house_id", label: "Clients", count: 1,
    })).toBe("1 Clients will lose their buying house");
  });
});
