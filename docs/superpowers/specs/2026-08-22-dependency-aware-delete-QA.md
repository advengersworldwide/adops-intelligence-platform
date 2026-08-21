# Dependency-Aware Delete — Pre-Merge QA

**Branch:** `feat/dependency-aware-delete-impl` (worktree at `.worktrees/dependency-aware-delete`)
**Status:** implemented, reviewed, **not yet exercised against a live database or browser**
**Automated state:** 73 test files / 287 tests passing · both typechecks clean · production build succeeds (62/62 pages)

## Why this document exists

The feature has zero automated coverage of rendering, async orchestration, or the three migrated pages. That was a deliberate choice — this repo has no render-testing infrastructure and we kept to that convention rather than adding three devDependencies. So the checks below are not a formality; **they are the only verification those layers will ever get.**

The final whole-branch review found a defect that made the feature fail 100% of the time on two of its three pages, and ten prior task reviews plus 281 green tests missed it, because the database was mocked everywhere it mattered. Assume the same class of problem can still be hiding.

Work top-down. Tier 1 is a go/no-go gate.

---

## Tier 1 — go / no-go

Do not proceed past this tier if any step fails.

- [ ] **1. Client with no dependents.** `/clients` → delete a client that nothing references. Expect the dialog to read *"Nothing else references this record — it's safe to delete"* and the delete to complete.
      **Fail signal:** any toast containing `column "…" does not exist`. That means the C1 column-name fix regressed.
- [ ] **2. Client with billings and POs.** Delete a client that has both. Expect real invoice codes (`CBILL-…`) in the blocker list.
      **Fail signal:** labels reading `Billing #12`. That means `labelColumns` was fixed but `labelWith` still reads the old key.
- [ ] **3. Partner with payments.** `/partners` → delete a partner with partner payments. Expect real reference codes (`PPMT-…`), not `Partner Payment #7`.
- [ ] **4. Buying house with billing records.** `/buying-houses` → delete one. Every blocking billing record must now show a working delete button and a link. Click one; confirm it actually deletes.
      This is the spec's motivating example and was a dead end until the final fix wave.

## Tier 2 — the numbers on the confirmation screen

These decide whether a user is told the truth immediately before destroying financial records.

- [ ] **5. Count accuracy.** For the client from step 2, count its dependents by hand in the database. Compare against *"Delete All — N records"* and *"This permanently deletes N records"*.
      Both must match, and must **include the client itself**. A billed client previously double-counted its billings.
- [ ] **6. No duplicate rows.** In that same tree, confirm each billing appears **once**. It is reachable both directly from the client and via its purchase orders.
- [ ] **7. Inline confirm isolation.** Click *Delete* on one blocker row. Exactly one *"Delete this …?"* prompt should open — not two.
- [ ] **8. Typed confirmation.** Confirm it appears **only** when financial records are involved. Verify the button stays disabled until the text matches exactly: trailing spaces should pass (input is trimmed), wrong case should fail.
- [ ] **9. Post-delete truth.** After a successful Delete All, compare the success toast's counts against rows actually removed.

## Tier 3 — the per-row loop

- [ ] **10. Tree shrinks.** Delete blockers one at a time. After each, the row disappears and counts update. After the **last** blocker clears, the primary button must flip from *Delete All — N records* to *Delete Client*.
- [ ] **11. Nested blocker.** Delete a client PO that still has partner POs beneath it. Expect the readable 409 — *"Another record still depends on this. Remove the dependent records first, then try again."* — not a 500.
- [ ] **12. Failure mid-loop.** Force a per-row delete to fail (revoke the permission in another session, or stop the database). Confirm you never see *"Deleted"* and *"Failed to delete"* fight over the single toast slot, and that the dialog does not get stuck in a deleting state.
- [ ] **13. State reset.** Close and reopen the dialog. Confirm the typed-confirmation box is empty and you are back on the review screen — a retained value would let a second delete skip confirmation entirely.

## Tier 4 — concurrency and permissions

- [ ] **14. Fingerprint 409.** Open the dialog for a client. In a second session, insert a new billing for that client. Click Delete All. Expect a 409, a *"this changed while you were reviewing"* toast, and the tree re-rendering with the new billing.
- [ ] **15. Nullify blind spot.** Same setup, but change only a **nullify** count (reassign extra billing records to the client). Expect **no** 409 — nullify counts are deliberately excluded from the fingerprint. Confirm you are comfortable with that.
- [ ] **16. Permission self-heal.** Open the dialog, revoke `billings:edit` from the role in another session, then click Delete All. Expect a 403 naming the missing permission and the tree re-rendering with locked rows — not an endless retry loop.
- [ ] **17. Tightened rule.** With a role holding `clients:delete` but **not** `partners:edit`: deleting a client that has partner links should now be blocked, because `partner_clients` is a cascade group. This is a deliberate behaviour change — confirm it does not break a workflow someone relies on.
- [ ] **18. Known bypass (documented, not fixed).** With a token holding `partners:delete` but not `billings:edit`, call `DELETE /api/partners/{id}` directly. It **will** succeed and cascade the billing records. Confirm you accept this; the dialog's cascade gate is a UI guarantee, not an enforced invariant.

## Tier 5 — performance and the unmigrated routes

- [ ] **19. Widest entity.** Open the dialog for the partner with the most billing records, network tab open. Record the `GET /api/dependencies` latency. Above ~2s, the cascade-counting cost needs revisiting — it also widens the race window below.
- [ ] **20. Unmigrated routes.** Spot-check three delete flows still using the old `confirm()` — a billing, a payment, a cost model. Their FK failures should now show the readable 409 text, and it must **not** mention a dialog they don't have.

---

## Residual risks — known before merge

1. **The cascade race is narrowed, not closed.** The delete re-resolves inside the transaction, but Postgres READ COMMITTED snapshots per *statement*, not per transaction. A cascade child inserted between the resolver's last query and the `DELETE` is destroyed unreviewed. Blockers are safe regardless (`RESTRICT` → `23503` → 409). Accepted deliberately; recorded in the spec's out-of-scope section. **The fingerprint means "you reviewed the tree as it stood moments before deletion", not "you reviewed exactly what was deleted."**
2. **No test exercises a real transaction.** `db.transaction` is mocked everywhere. Rollback-on-error and the `23503` mapping rest on Postgres's real behaviour, unverified in CI.
3. **Cascade counts are estimates.** The resolver samples three rows and extrapolates, so the number on the confirmation screen may not be exact for wide fan-outs.
4. **Eight of the fourteen wrapped delete routes still use plain `confirm()`.** Migrating them is follow-up work: billings, partner bills, payments, partner payments, partner POs, cost resources, payment terms, cost models.
5. **An unrelated commit rides along.** `e36c297 docs(specs): auth hardening design` came from a concurrent session working in the same checkout before this branch was isolated. Docs-only; drop it from the PR if you want a clean diff.

## If something fails

The full audit trail — every review finding, fix round, ruling, and deferred item — is in
`.superpowers/sdd/2026-08-18-dependency-aware-delete/progress.md` (git-ignored, worktree-local).
