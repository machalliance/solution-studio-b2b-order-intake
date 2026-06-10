# Production Considerations
## Agentic B2B Order Intake — Moving from Prototype to Deployment

This document describes what the prototype deliberately does not address, and what an organization would need to resolve before running this system against real orders, real customers, and real ERP systems. It is intended for technical teams and decision-makers evaluating a path from demo to production.

The prototype is designed to show what is possible — a working, end-to-end agentic order intake pipeline that any developer can run in under an hour. It succeeds at that goal. What it does not do is carry the operational, security, compliance, and reliability expectations of a system handling live commercial transactions. The gaps described here are deliberate. Closing them is the work of a production implementation.

---

## Security

**API key management.** The prototype stores the Anthropic API key and all configuration in a plain `.env` file. In production, secrets must not live in files checked near a code repository or visible on a filesystem. A dedicated secrets manager — HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, or an equivalent — should hold all credentials. Application services pull them at startup via authenticated API calls, not from files. Keys should be rotated on a defined schedule.

**No authentication on the Agent Control Interface.** The interface at port 3000 is open to anyone who can reach the server. In a local Docker environment this is fine. In any networked deployment, access to the control interface must be protected — at minimum by network-level controls (firewall rules, VPN requirement), and ideally by an identity-aware proxy or SSO integration. Operators taking action on Human Review items must be authenticated individuals, not anonymous network clients.

**No TLS between services.** Inter-service communication inside the Docker network is unencrypted. In a cloud deployment, services communicating across network boundaries — even within a private VPC — should use TLS. The pipeline API, ERP adapter endpoints, and Mailpit SMTP should all be TLS-terminated in production.

**HTTP API rate limiting.** The pipeline's .env includes controls that limit processing throughput — MAILPIT_POLL_INTERVAL_MS governs inbound email polling frequency, MAX_LINE_ITEMS caps complexity per order, and SKU_MAX_CANDIDATES and CUSTOMER_MAX_CANDIDATES bound the scope of each AI resolution call. What the prototype does not have is HTTP-level rate limiting on the pipeline's own REST endpoints. A production deployment should apply rate limiting at the ingress level, particularly on the Human Review action endpoints and any inbound webhook if SendGrid Inbound Parse is adopted.

**Mailpit is a development tool.** Mailpit is excellent for local development and demonstrations. It accepts all SMTP connections without authentication and stores messages in memory. It is not designed for production email handling. Inbound email in production should come through a provider with authentication, spam filtering, and SPF/DKIM/DMARC enforcement.

**Phishing and spoofing.** The prototype's legitimacy check relies on Claude's judgment about whether an email looks like a purchase order. Claude is good at this, but it is not a substitute for proper sender authentication. In production, the email channel should validate SPF and DKIM records before processing any message, and should have a configured allowlist or denylist of sender domains for buyers expected to submit orders.

---

## Personally Identifiable Information (PII)

Purchase orders contain PII. Buyer names, email addresses, phone numbers, company addresses, and occasionally individual contact details all flow through the pipeline and are stored in the database. This has regulatory implications that the prototype does not address.

**Data at rest.** The PostgreSQL database stores raw order content, extracted fields, and audit log entries in plain text. Production deployments need encryption at rest for the database volume. Most cloud database services (RDS, Cloud SQL, Azure Database) enable this by default; a self-hosted PostgreSQL deployment requires explicit configuration.

**Data minimization.** The prototype stores the full raw content of every inbound order — including the original email body or EDI file. Depending on your jurisdiction and data classification requirements, storing the full original may not be necessary once extraction is complete. A production implementation should define retention rules: what is stored, for how long, and what is purged once an order reaches a terminal state.

**Data retention and deletion.** The prototype has no data retention policy and no mechanism for deleting individual records. Under GDPR (relevant for orders from EU-based buyers) and CCPA (relevant for California-based buyers), individuals have rights regarding their personal data. A production system needs to be able to identify and delete PII on request, and to define how long order data is retained before automatic purging.

**The AI provider.** All order content sent to Claude for extraction and resolution passes through Anthropic's API. Anthropic's usage policy states that it does not use API inputs to train models. That policy should be reviewed directly at anthropic.com and evaluated against your organization's data governance requirements before processing orders containing customer PII. If the jurisdiction or data classification of your buyers requires data residency, this is a key consideration when choosing or configuring the AI extraction provider.

**The audit log.** The prototype's audit log records AI reasoning strings verbatim. If Claude includes buyer information in its reasoning output — which it may, since reasoning about an order necessarily involves the order's content — then the audit log itself contains PII and is subject to the same retention and deletion requirements as the order records.

---

## Audit Logging

The prototype includes a functional audit log: every pipeline event writes a record to PostgreSQL, including the event type, timestamp, outcome, confidence score, and AI reasoning. This is a solid foundation.

What a production audit log additionally requires:

**Tamper evidence.** The prototype's audit table can be modified by anyone with database access. A production audit trail should be immutable. Options include append-only tables with revoked UPDATE and DELETE privileges for the application user, write-through to an immutable log service, or cryptographic chaining of log entries.

**Log export and SIEM integration.** Operational security teams need audit events to flow into a security information and event management (SIEM) system — Splunk, Datadog, CloudWatch, or equivalent. The prototype's logging adapter is designed to be swappable; a production logging adapter would forward events to the appropriate sink rather than writing only to PostgreSQL.

**Structured log format.** The prototype logs plain text messages to stdout. Production logging should use structured JSON, with consistent field names, so logs can be indexed, queried, and alerted on. The existing logging adapter pattern makes this straightforward to implement.

**Log retention policy.** How long audit events must be retained depends on your industry, jurisdiction, and internal compliance requirements. Define this before going live and configure database-level retention or archival accordingly.

---

## Observability

The prototype has minimal observability. Services log startup messages and errors to stdout. The Agent Control Interface shows order status. That is all.

Production operations require more:

**Application metrics.** Order throughput (orders per minute), routing outcome distribution (what percentage reach each outcome), AI API latency, queue depth for Human Review, and error rates are all operationally important. None of these are currently instrumented. A production deployment should expose metrics in a standard format — Prometheus is the common choice — and feed them to a dashboard.

**Health and alerting.** Each service exposes a `/health` endpoint, which Docker uses for health checks. In production, health check failures should trigger alerts to on-call staff, not just Docker restarts. An alerting layer — PagerDuty, OpsGenie, or a cloud-native equivalent — should be configured with thresholds for error rates, processing latency, and Human Review queue depth.

**Distributed tracing.** When an order fails or takes an unexpectedly long time, it is currently difficult to trace what happened across the intake → extraction → validation → routing path without reading the audit log manually. A production deployment would benefit from distributed tracing — OpenTelemetry is the open standard — so that each order's journey through the pipeline can be inspected as a single trace.

**The EDI channel.** The prototype's EDI channel polls a directory every two seconds. Production-grade file intake could use a watched storage location with event-driven notification (S3 event triggers, Azure Blob storage events, or equivalent) rather than polling, to reduce latency and eliminate the risk of missing files during a polling gap.

---

## AI Governance

The prototype makes autonomous decisions about real commercial transactions. Governance of those decisions is not optional.

**Confidence thresholds are policy decisions.** The thresholds that determine when an order auto-submits versus routes to Human Review (CONFIDENCE_SUBMIT_THRESHOLD, SKU_AUTO_THRESHOLD, CUSTOMER_AUTO_THRESHOLD) are configurable in `.env`. In production, changing these thresholds changes the behavior of a system making real financial commitments. They should be treated as policy, not configuration — reviewed, documented, and changed through a controlled process, not by editing a file.

**Model versioning.** The prototype targets a specific Claude model version. When a new model version is released, behavior may change — extraction quality, confidence calibration, and reasoning style can all shift between versions. A production deployment should have a process for evaluating model updates before deploying them, including regression testing against the synthetic corpus.

**Human Review as a governance checkpoint.** The Human Review outcome is the system's explicit acknowledgment that it cannot fully resolve an order. Production operations should track and analyze the Human Review queue: what types of orders land there, which customers generate the most exceptions, and whether the volume changes over time. Increasing Human Review rates may signal data quality issues or model behavior changes worth investigating.

**Systematic review of outcomes.** Production governance requires periodic review of a sample of auto-submitted orders to verify that autonomous decisions were correct. This is analogous to quality sampling in any high-volume process. The audit log provides the necessary trail; the sampling and review process is organizational, not technical.

**Error handling and fallback.** The prototype routes orders that fail at the extraction or validation stage to the Human Review queue or logs them to the error folder. In production, there should be a defined escalation path for orders that fail processing entirely — a human must be notified, and no order should be silently lost.

---

## Cost Controls

The prototype makes API calls to Claude for three purposes: extraction, SKU resolution, and customer identity resolution. Each call consumes tokens and generates cost. At demonstration scale this is negligible; at production volume it is a line item that needs to be managed.

The prototype does not track or report API usage. A production implementation should:

- Log token usage per order, per call type, to the audit log or a dedicated metrics table.
- Set hard limits on API spending through the Anthropic console or your cloud billing controls.
- Monitor average tokens per order and alert if it rises unexpectedly — which may indicate prompt issues or unusually large orders.
- Consider the tradeoff between model capability and cost. The `ANTHROPIC_MODEL` environment variable allows switching models; a less capable but faster and cheaper model may be appropriate for high-volume, simple orders, with a more capable model reserved for complex or high-value ones.

The prototype also runs five Docker services continuously. In a cloud deployment, the infrastructure cost of always-on services — even when order volume is zero overnight — is real. Consider scaling-to-zero patterns for the pipeline service if order intake is batch-oriented rather than continuous.

---

## Rollback and Recovery

The prototype is not designed for zero-downtime deployment or rollback.

**Database migrations.** The migration runner applies SQL files in sequence. There are no rollback migrations. In production, every migration could have a corresponding rollback script, and the deployment process should be able to reverse a migration if a release is rolled back. Tools like Flyway or Liquibase provide migration management with rollback support.

**Blue/green deployment.** `docker compose up` replaces running containers in-place. In production, new versions could be deployed alongside the current version, validated, and traffic switched — not deployed over a running system. Most container orchestration platforms (Kubernetes, ECS, Cloud Run) support this natively.

**State recovery.** If the pipeline service crashes mid-processing, orders in flight may not reach a terminal state. The LangGraph interrupt mechanism preserves Human Review state, but an order that crashes during extraction or validation may remain in an intermediate database state. Production deployments need a monitoring job that identifies stale in-progress orders and either retries or escalates them.

**The ERP stub.** The stub accepts and stores order submissions but does not connect to any real ERP system. Replacing it with a real ERP adapter is the primary integration work of a production deployment. That adapter must handle ERP-side errors — rejected orders, duplicate detection, downstream validation failures — and surface them back through the pipeline's outcome model.

---

## Production-Grade Design at the Core

None of the above should be read as a reason to avoid this approach. The prototype makes sound architectural choices that carry directly into production:

The adapter factory pattern means every integration point — ERP, email provider, AI extraction, customer lookup, logging — can be replaced without modifying the pipeline. This is what makes the system genuinely vendor-neutral.

The confidence threshold system means the pipeline's risk tolerance is configurable, not hardcoded. Operations teams can tune it as they gain confidence in the system's accuracy on their specific order mix.

The audit log, even in its prototype form, provides a complete, queryable record of every decision the agent made and why. That transparency is the foundation of responsible deployment, not an afterthought.

The Human Review queue is a first-class outcome — not an error state. Building human oversight into the routing model from the start is the right design for an autonomous system making consequential decisions.

The path from prototype to production is real work. But it is well-defined work, and the architecture is designed to support it.
