# Session Resume — 2026-05-21 (continued)

## To pick up where we left off:

```
./claude_resume.sh
```

or: `claude -r f471ec9a-f9ed-4063-b27e-dce6fc0a9f89`

---

## What was completed this session

### Audit Log
- Rebuilt as document-centric: one card per order, expandable with full pipeline trace
- Extracted order detail (buyer, line items, errors highlighted inline), extraction reasoning, routing decision
- Raw document collapsible section
- Stage pills coloured by outcome (red validation, amber customer, green ERP, amber routing)
- Document type badges: `repeat order`, `amendment`, `cancellation`, `spam`, `bec`, `inquiry`
- Confidence score in section header
- `clarify_sent` audit event now stores full email subject + body

### Routing Logic (major overhaul)
Decision cascade (top-to-bottom, first match wins):
1. BEC/phishing → silent reject
2. Spam → silent reject  
3. Known sender + unreadable (≤5% confidence or no_order_extracted) → clarify (unreadable reply)
4. Inquiry + known sender → clarify (redirect to INQUIRY_CONTACT_EMAIL)
5. Inquiry + unknown → silent reject
6. Duplicate PO / no order + unknown sender → reject
7. Repeat order / amendment / cancellation + known → review
8. Same + unknown → reject
9. Unknown sender + unreadable → reject
10. Customer unresolved / SKU issues / low confidence → review
11. Missing fields / unmatched SKUs → clarify
12. ≥85% confidence → submit
13. Fallback → review

### Document Types (new)
Extraction now classifies: `new_order`, `repeat_order`, `amendment`, `cancellation`, `inquiry`, `spam`, `bec`
- Repeat order and amendments always go to review (never auto-submit)
- Cancellations route to review for known customers
- BEC/spam always silent reject

### Customer Lookup Fix
- `resolveCustomer` now passes `senderEmail` as fallback so domain matching works even when extraction returned nothing (e.g. degraded PDF)

### EDI Outbound
- Auto-864 generation: EDI clarify route now auto-generates 864 Text Message to edi-outbound/
- EDI reject: 855 PO Acknowledgement generated via Human Review
- Human Review modal shows 864/855 preview with raw EDI collapsible, notes NTE updates live

### Email Identity (all env-var driven)
- `PIPELINE_NOTIFICATION_FROM` — outbound reply From address
- `INTAKE_EMAIL_ADDRESS` — the listening inbox address
- `INQUIRY_CONTACT_EMAIL` — shown in inquiry auto-replies

### Clarification Emails
- Unreadable document: explains why PDF couldn't be read, asks for resubmission
- Inquiry redirect: directs to INQUIRY_CONTACT_EMAIL
- Standard: shows full order detail with [?] on missing fields
- Operator notes appended as extra NTE line in EDI 864

### MACH Compliance
- SendGrid adapter synced to full Mailpit interface parity
- EDI poll interval → `EDI_POLL_INTERVAL_MS` env var
- `isDuplicatePO` SQL fully parameterised
- Background agent added JSDoc documentation to all 27 pipeline source files
- Routing node header comment documents full decision cascade

### Performance
- SKU resolution parallelised with `Promise.all` — 25-line orders no longer sequential

### Test Corpus
- 29 new corpus files created (email-10 to email-23, edi-10 to edi-24)
- Manifest supports `//` JSONC comments for section headers
- Expected outcomes updated for all unknown-buyer tests (reject → review)
- Duplicate PO test (edi-12), empty file (edi-18), corrupted XLSX (edi-20), etc.

### Bug Fixes
- Outbound clarification email was being re-ingested as new order (fixed: filter by ownFrom)
- Pipeline restart reprocessing (fixed: _seedSeen on startup)
- Double routing audit event (fixed: removed duplicate writeAuditEvent from reject/review nodes)
- Cancellation emails routing as submit (fixed: documentType routing + no_line_items business rule)
- Degraded PDF misclassified as inquiry (fixed: unreadable check now fires before inquiry check)

---

## Left incomplete / known issues

- **MACH interface contracts** — adapter factory index.js files don't formally document what methods a replacement must implement. Need `@typedef` interface definitions.
- **Logging adapter dead facade** — `PostgresLoggingAdapter.writeEvent()` exists but nodes call `writeAuditEvent()` directly. Either wire it or remove it.
- **`build864MessageLines` dual-shape** — snake_case in routes.js vs camelCase in clarify.js (currently adapted, but fragile).
- **Human-in-the-loop graph resume** — review node never actually resumes the graph (Milestone 2). Operator actions update DB directly; `graph` parameter in routes is unused.

## Key reminders

- Always `docker compose build <service> && docker compose up -d <service>` after source changes
- DB: `b2border` user, `b2border` password, `b2border` database
- Never push to remote — local commits only
- Clear all test data before each test run (resets seen-sets + Mailpit + edi-outbound)
- 25-line order (email-16) takes longer even with parallel SKU resolution — it's doing 25 Claude calls

## Next tasks

1. Add formal interface contract `@typedef` to each adapter factory index.js
2. Fix logging adapter (wire nodes through it or remove)
3. Fix `build864MessageLines` dual-shape inconsistency
4. Continue corpus testing
