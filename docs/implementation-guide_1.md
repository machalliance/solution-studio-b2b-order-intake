# Implementation Guide
## Agentic B2B Order Intake — Prototype to Pilot Backlog

This guide is structured as a sequenced backlog of tasks for moving from the working prototype to a production-adjacent pilot — a deployment running against real orders, real customers, and a real ERP system. Tasks are organized into four phases. Each task includes a scope and priority in the format (Scope · Priority) — scope runs Small (a day or less), Medium (two to five days), Large (one to two weeks), or Extra Large (more than two weeks); priority is Required or Recommended. Dependencies are noted inline.

"Production-adjacent" means: real data flowing through, real decisions being made, operators using the system daily — but with appropriate guardrails, close monitoring, and a defined rollback plan. It is not full production hardening across all dimensions simultaneously. The goal of a pilot is to validate the system against your actual order mix before committing to broad rollout.

---

## Phase 1 — Security and Infrastructure
*Prerequisite work before any real data enters the system.*

---

### Secrets Management

**1.1.1 — Migrate API keys and credentials to a secrets manager** (Medium · Required)
API keys, database credentials, and email provider keys should move out of `.env` files and into a secrets manager — HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, or any equivalent. The pipeline service should pull secrets at startup, and all credentials should be removed from version control history. A secrets manager also makes future credential rotation straightforward when your security policy requires it.

---

### Network Security

**1.2.1 — Enable TLS on all service endpoints** (Medium · Required)
TLS termination for the pipeline API, Agent Control Interface, and any externally reachable endpoints is worth addressing early — in most cloud deployments this is handled at the load balancer or ingress level. Internal service communication that crosses network boundaries should also use TLS.

**1.2.2 — Restrict Agent Control Interface access** (Small · Required)
The Agent Control Interface should sit behind a VPN, IP allowlist, or identity-aware proxy. Operator-facing interfaces should not be open to the public internet, even during a pilot. Access and conditions should be documented.

**1.2.3 — Add HTTP rate limiting to the pipeline API** (Small · Recommended) *depends on 1.2.1*
Rate limiting at the ingress level on the Human Review action endpoints is worth configuring. The limits should be generous enough not to impede operators but strict enough to prevent abuse. Rate-limit violations could be logged to the audit log.

---

### Authentication

**1.3.1 — Add authentication to the Agent Control Interface** (Large · Required)
The current interface has no login. SSO or OAuth integration appropriate to your organization's identity provider should be added (Azure AD, Okta, Google Workspace, or equivalent). Human Review actions should be tied to an authenticated operator identity and logged with that identity in the audit trail. It is worth determining whether all operators need the same access level or whether distinct roles are appropriate — for example, a read-only observer versus a reviewer who can approve or reject orders.

---

### Container Orchestration

**1.4.1 — Move to production-grade deployment infrastructure** (Extra Large · Required)
Docker Compose is appropriate for local development and demonstration but is not well-suited to a live deployment. The right infrastructure depends on your organization's existing platform — a managed container service, a VM with a process supervisor, or a container orchestration platform are all reasonable options. The application's existing Docker images require no changes regardless of which infrastructure approach is taken; only the orchestration layer changes.

**1.4.2 — Configure resource limits per service** (Small · Required) *depends on 1.4.1*
CPU and memory limits for each service should be based on observed usage during demonstration. The pipeline service has the most variable resource profile given its AI API calls — starting generous and tuning down from pilot metrics is a reasonable approach.

---

## Phase 2 — Data and Integration
*Connecting real systems and loading real data.*

---

### Customer Data

**2.1.1 — Export and clean your customer master data** (Medium · Required)
The prototype uses a small `customers.json` file with four fictional accounts. Real customer records should include whatever fields your team uses to uniquely identify buyers — account ID, company name, known email domains, and address are the fields the cascade currently uses. The cleaner and more complete the data, the better the customer identity resolution will perform.

**2.1.2 — Build or configure a production CustomerLookupAdapter** (Large · Required) *depends on 2.1.1*
Depending on where your authoritative customer data lives — a CRM, an ERP, a database — implement a CustomerLookupAdapter that queries it directly. The adapter interface is already defined; the implementation connects to your system. If your customer data is in Salesforce, for example, the adapter makes Salesforce API calls. If it's in your ERP, query the ERP. The pipeline code does not change.

**2.1.3 — Validate cascade performance against real data** (Small · Required) *depends on 2.1.2*
Running the test corpus through the pipeline against your real customer data is a useful early check — it shows how the five-step cascade performs on your actual buyer mix before any real orders arrive. `CUSTOMER_AUTO_THRESHOLD` and `CUSTOMER_REVIEW_THRESHOLD` may need adjustment based on what you observe; the right values depend on your customer name variability and address data quality.

---

### Inventory Data

**2.2.1 — Replace seed inventory with real SKU catalog** (Medium · Required)
The prototype seeds six fictional SKUs. Real product catalog data should include accurate stock status, backorder flags, and descriptions. The more descriptive the SKU descriptions, the better the AI SKU resolver performs on fuzzy buyer SKU matches.

**2.2.2 — Build or configure a production InventoryAdapter** (Large · Required) *depends on 2.2.1*
For a true pilot, inventory availability should reflect real-time stock levels rather than static seed data. Implement an InventoryAdapter that queries your inventory system at order validation time. If real-time inventory is not available initially, a daily-refreshed cache is a reasonable intermediate step.

**2.2.3 — Build a buyer SKU mapping table** (Medium · Recommended)
Many B2B buyers use their own SKU codes that differ from yours. Building a mapping table of known buyer SKU aliases to your internal SKUs will improve the exact-match rate significantly, reducing AI fuzzy matching load and improving accuracy. This data often already exists as tribal knowledge in your customer service team — capturing it systematically is the work.

---

### ERP Integration

**2.3.1 — Implement a production ERPAdapter** (Extra Large · Required)
This is the most significant integration task. The ERPAdapter should submit orders to your ERP in the format it expects, handle ERP-side validation errors gracefully, and return a confirmation that the order was received. The adapter pattern means no pipeline code changes — only a new adapter implementation. The complexity depends entirely on your ERP's API maturity. Modern ERPs (NetSuite, Dynamics 365, SAP S/4HANA via OData) have well-documented APIs; older systems may require middleware.

**2.3.2 — Map MACH ODM order structure to your ERP schema** (Medium · Required) *depends on 2.3.1*
The pipeline's extracted order follows the MACH Alliance Open Data Model. Your ERP may use different field names, different units, or different customer/product identifiers. The mapping should be documented before implementing the adapter. Particular attention should go to: line item numbering conventions, unit of measure codes, customer account identifiers, and address format.

**2.3.3 — Test ERP error handling** (Small · Required) *depends on 2.3.1*
Submitting orders that your ERP will reject — duplicate order numbers, invalid customer accounts, out-of-range quantities — is a useful pre-launch test. The pipeline should handle those rejections gracefully, log them to the audit trail, and route the order to the appropriate outcome without crashing.

---

### Email Channel

**2.4.1 — Configure real inbound email** (Medium · Required)
Mailpit is a development-only tool and should be replaced with a production-grade inbound email handler. The pipeline's `EMAIL_PROVIDER` adapter is designed to be swapped — SendGrid Inbound Parse is the currently implemented production option, but any provider that can POST inbound messages to a webhook endpoint is a viable candidate. Whichever provider is chosen, the pipeline will need a public-facing HTTPS webhook endpoint and appropriate DNS configuration for your order intake address.

**2.4.1a — Implement webhook signature verification** (Small · Required) *depends on 2.4.1*
The inbound webhook endpoint should verify request signatures before processing — without this, the endpoint accepts data from any source. Most email providers offer a signed request mechanism; verification should be implemented in the email channel adapter for whichever provider is used.

**2.4.2 — Configure outbound clarification email** (Small · Required) *depends on 2.4.1*
Outbound clarification emails should be configured for whichever provider is in use — the relevant keys and sender address belong in your secrets manager, not in `.env`. Clarification replies should be verified to arrive reliably and not be caught by spam filters, with the sender address aligned to your email domain's SPF and DKIM records.

**2.4.3 — Configure sender authentication validation** (Medium · Recommended) *depends on 2.4.1*
In the email channel adapter, add SPF and DKIM validation before processing any inbound message. An allowlist of known buyer domains could be configured. Messages that fail authentication or come from unknown domains should be logged and routed to Human Review rather than silently dropped.

---

## Phase 3 — Observability and Operations
*Making the system visible, measurable, and operable.*

---

### Logging and Monitoring

**3.1.1 — Implement structured JSON logging** (Small · Required)
Replace the current plain-text stdout logging with structured JSON. Consistent field names across services allow logs to be indexed, queried, and alerted on in any log management system.

**3.1.2 — Configure log aggregation** (Small · Required) *depends on 3.1.1*
Forward logs from all services to a central log management system — Datadog, CloudWatch, Splunk, or equivalent. Configure log retention in line with your audit requirements. Ensure the audit log events (currently in PostgreSQL) are also forwarded.

**3.1.3 — Add application metrics** (Medium · Required) *depends on 3.1.1*
The pipeline service should emit metrics: orders received per minute, routing outcome distribution, AI API latency (p50, p95), Human Review queue depth, and error rate. Exposing these in a standard metrics format (Prometheus is a common choice) and feeding a dashboard (Grafana, Datadog, or equivalent) gives operators the visibility they need.

**3.1.4 — Configure operational alerting** (Small · Recommended) *depends on 3.1.3*
Alert thresholds could be configured for: error rate above baseline, AI API latency exceeding acceptable bounds, Human Review queue exceeding a defined depth, and any service health check failure. Alerts should reach on-call staff through your incident management tool.

---

### Database Operations

**3.2.1 — Enable encryption at rest** (Small · Required)
Database-level encryption at rest should be enabled. On most managed database services this is straightforward to configure; on self-hosted instances it typically requires filesystem-level encryption. The specifics depend on your hosting environment.

**3.2.2 — Configure automated backups** (Small · Required)
Configure daily automated backups with point-in-time recovery enabled. Verify restore works before going live — not after.

**3.2.3 — Add rollback migrations** (Medium · Recommended)
Each forward migration should have a corresponding rollback SQL script. The rollback procedure should be documented. At least one rollback should be tested before the pilot begins.

**3.2.4 — Define data retention and implement purging** (Medium · Required)
Decide how long order records, audit events, and raw order content are retained. Implement a scheduled purging job that deletes or anonymizes records beyond the retention window, in compliance with your data governance requirements.

---

### Deployment Process

**3.3.1 — Implement a safe deployment strategy** (Large · Required) *depends on 1.4.1*
Deploying directly over a running system should be avoided — blue/green, canary, and rolling deployments are all valid approaches depending on your infrastructure. Whichever strategy is used, it is worth defining what a healthy new deployment looks like before any traffic switches to it.

**3.3.2 — Document deployment and rollback runbook** (Small · Required) *depends on 3.3.1*
A deployment runbook covering new version deployment, validation, rollback, and escalation is worth maintaining. Anyone on call during a deployment should be able to follow it without needing additional context.

---

## Phase 4 — Pilot Operations and Tuning
*Running with real orders and tuning based on what you observe.*

---

### Confidence Threshold Tuning

**4.1.1 — Define pilot success criteria and instrument metrics before go-live** (Small · Required)
Before processing the first real order, success criteria should be defined in measurable terms: target auto-submit rate, acceptable Human Review queue depth, maximum error rate, operator response time on review items. These criteria gate the transition from pilot to rollout — without them you cannot make an objective go/no-go decision. Metric collection should be confirmed and a dashboard showing these figures in real time should be available before go-live.

**4.1.2 — Run the synthetic corpus against your production configuration** (Small · Required) *depends on Phase 2 complete*
Before the first real order, all 18 release corpus test cases should be run through the pipeline pointed at your real customer data, real inventory, and real ERP (in a test environment). Routing outcomes should match expectations. Any mismatch is a signal to investigate before go-live — not after.

**4.1.3 — Tune confidence thresholds based on real data** (Medium · Required) *depends on 4.1.1*
Adjust `CONFIDENCE_SUBMIT_THRESHOLD`, `SKU_AUTO_THRESHOLD`, and `CUSTOMER_AUTO_THRESHOLD` based on what the first week of real orders reveals. The right thresholds are specific to your order mix and buyer behavior — they are difficult to set correctly from synthetic data alone. Every threshold change, the reason for it, and the date should be recorded.

---

### Operator Workflow

**4.2.1 — Train operators on the Agent Control Interface** (Small · Required)
Operators using the Human Review queue should understand what the agent is showing them — confidence scores, candidate lists, AI reasoning — and what their actions mean. A structured training session should be run before the pilot begins. Common scenarios and expected decisions are worth documenting.

**4.2.2 — Define and document escalation and fallback paths** (Small · Required)
Two separate concerns. Escalation: what happens when an operator disagrees with an auto-submitted order, or when the Human Review queue exceeds capacity? Fallback: if the pipeline goes down during business hours, operators should have a defined manual procedure so orders are not lost. Both should be documented before go-live.

**4.2.3 — Communicate the change to buyers** (Small · Required)
When you switch from manual processing, buyers may notice differences — a different tone in clarification emails, faster or slower response times, a different reply-from address. It is worth deciding whether buyers are informed proactively, and who owns that decision. Automated clarification email templates should be reviewed before they reach real buyers.

**4.2.4 — Implement a sampling review process** (Small · Recommended)
A weekly or fortnightly review of a random sample of auto-submitted orders to verify the agent's decisions were correct. A manual spot check of the audit log is sufficient — no tooling required. The process should be documented and ownership assigned.

---

### Cost Monitoring

**4.3.1 — Implement per-order token usage logging** (Small · Recommended)
Log the token count for each AI API call to the audit log or a dedicated metrics table. After the first week of real orders, calculate the average token cost per order and project monthly API costs at your expected volume. Adjust `ANTHROPIC_MODEL` if a different model offers a better cost-to-quality tradeoff for your order mix.

**4.3.2 — Verify your Anthropic API rate tier** (Small · Required)
The Anthropic API enforces tier-based rate limits on tokens per minute and requests per minute. Check your current tier in the Anthropic console and calculate whether it supports your expected order volume at peak. If not, request a tier increase before go-live — tier upgrades are not instant.

**4.3.3 — Configure API spend alerts** (Small · Required)
A monthly API spend alert in the Anthropic console is worth setting. It is worth defining what happens if spending exceeds the alert threshold — who is notified, and whether automatic action is taken.

---

### Pilot Review and Go/No-Go

**4.4.1 — Conduct four-week pilot review** (Small · Required) *depends on all Phase 4 tasks*
At the end of the pilot period, compare actual metrics against the success criteria defined in task 4.1.1. Findings should be documented, outstanding issues listed, and an explicit go/no-go decision made on broader rollout. If no-go, the changes needed before the next pilot attempt should be captured.

---

## Sequencing Summary

The table below shows the recommended sequence across phases. Phases 1 and 2 can proceed in parallel where there are no dependencies between epics. Phase 3 should begin alongside Phase 2 — you want observability in place before real orders arrive. Phase 4 begins when Phases 1, 2, and 3 are complete.

| Phase | Focus | Key dependency | Suggested duration |
|---|---|---|---|
| 1 — Security & Infrastructure | Pre-requisite hardening | None | Weeks 1–3 |
| 2 — Data & Integration | Real systems connected | Phase 1 complete | Weeks 2–6 |
| 3 — Observability & Operations | Visibility before go-live | Parallel with Phase 2 | Weeks 3–6 |
| 4 — Pilot Operations | Real orders, real tuning | Phases 1–3 complete | Weeks 7–10 |

A realistic path from prototype to a running pilot is eight to twelve weeks, depending on ERP integration complexity (task 2.3 is the most variable), the maturity of your internal infrastructure for container deployment, and the availability of customer and inventory data in a usable format.

---

## What Is Out of Scope for a Pilot

The following items from the production considerations document are noted but deliberately out of scope for a first pilot. They represent the work of moving from pilot to full production:

- Full distributed tracing (OpenTelemetry implementation)
- Automated compliance reporting and right-to-erasure workflows
- A/B testing framework for model version comparison
- Multi-region deployment or disaster recovery
- Formal change management process for confidence threshold adjustments
- Integration with procurement or vendor management systems beyond the ERP

A successful pilot validates the core loop — order intake, AI processing, human review, ERP submission — against your real data. Everything else is scoped for the next phase.
