# B2B Order Intake Pipeline

A production-grade B2B order intake pipeline. Inbound purchase orders - arriving by email or EDI - are automatically extracted, validated, and routed using AI, with a human-in-the-loop review queue for edge cases.

Built on composable, independently-deployable services where every integration point - ERP, email, EDI, customer lookup - is swappable without touching business logic.

---

## What it does

- **AI-powered extraction** - Claude reads free-form emails, PDFs, CSVs, XLSX spreadsheets, and X12 850 EDI documents and produces structured order entities with self-assessed confidence scores
- **LangGraph orchestration** - the entire pipeline runs as a stateful LangGraph graph; each order is a graph invocation with nodes for intake, extraction, validation, routing, and outcomes — making the flow explicit, inspectable, and resumable
- **Multi-channel ingestion** - email and EDI channels are fully independent and pluggable; adding a new channel requires one new adapter class
- **Pluggable adapters** - ERP, notification, customer lookup, SKU resolution, logging, and EDI outbound are all behind defined interfaces; swap any implementation by changing a single `.env` value
- **Human-in-the-loop** - LangGraph `interruptBefore` + PostgreSQL checkpointer pauses the graph at review, persists state across restarts, and resumes through the full pipeline when the operator acts
- **Formal EDI responses** - X12 864 Text Message (clarification) and X12 855 PO Acknowledgement (rejection) generated automatically or on operator request
- **Headless UI** - the React Agent Control Interface consumes the pipeline exclusively through REST endpoints; the UI is entirely decoupled from business logic
- **Environment-driven configuration** - every threshold, path, interval, and adapter selection is an environment variable; nothing is hardcoded

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Inbound Channels                         │
│   ┌────────────────────┐       ┌─────────────────────────────┐  │
│   │   Email Channel    │       │       EDI Channel           │  │
│   │  poll / webhook    │       │  polls inbox folder         │  │
│   │  plain text / PDF  │       │  X12 850 / CSV / XLSX       │  │
│   └────────┬───────────┘       └──────────────┬──────────────┘  │
└────────────┼──────────────────────────────────┼─────────────────┘
             │                                  │
             v                                  v
┌─────────────────────────────────────────────────────────────────┐
│                    LangGraph Pipeline                           │
│                                                                 │
│   Intake ──-> Extraction ──-> Validation ──-> Routing             │
│               (Claude AI)   (SKU / Customer                     │
│                              / Inventory)     │                 │
│                                               ├──-> Submit ──-> ERP Adapter
│                                               ├──-> Clarify ──-> Notification Adapter
│                                               ├──-> Reject ──-> EDI Outbound Adapter
│                                               └──-> Review ◄──────────────────────┐
│                                                     │  (interrupt + checkpoint)  │
└─────────────────────────────────────────────────────┼──────────────────────────  │
                                                      v                            │
┌─────────────────────────────────────────────────────────────────┐                │
│                  Agent Control Interface (React)                │                │
│  Live Feed │ Human Review │ Submitted Orders │ Audit Log        │ ───────────────┘
│                    operator approves / rejects / clarifies       │
└─────────────────────────────────────────────────────────────────┘
                              │
                   REST API (Express) - /api/v1/*
                              │
                    PostgreSQL 16 (orders / audit log
                                   / LangGraph checkpoints)
```

### Adapters - the swap points

| Adapter | Interface method | Default | Swap to |
|---------|-----------------|---------|---------|
| ERP | `submitOrder(order)` | Stub (DB) | SAP, NetSuite, Dynamics 365 |
| Inbound Email | `start(onMessage)` | Mailpit polling (dev) | SendGrid Inbound Parse (prod) |
| Notification | `sendClarification(to, order, opts)` | Mailpit / SMTP | SendGrid, SES, Postmark |
| Customer Lookup | `lookup(criteria)` | JSON file | Salesforce, NetSuite CRM |
| SKU Resolver | `resolve(sku, desc, catalogue)` | Claude AI | GPT-4, on-prem model |
| Extraction | `extract(content, ctx)` | Claude AI | Any LLM |
| Logging | `writeEvent(event)` | PostgreSQL | Datadog, CloudWatch |
| EDI Outbound | `send(type, poNumber, content)` | File system | VAN API, AS2 |

Change `INBOUND_MAIL_PROVIDER=sendgrid` and the pipeline receives email via webhook instead of polling - no graph changes required.

---

## Prerequisites

An [Anthropic API key](https://console.anthropic.com/) is required on all platforms.

**Linux**
- Docker Engine + Docker Compose - install from Docker's official repository (Ubuntu example below; see [docs.docker.com](https://docs.docker.com/engine/install/) for other distributions):
  ```bash
  sudo apt update && sudo apt install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker $USER && newgrp docker
  ```
- Git (`sudo apt install -y git`)

**macOS**
- [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) (includes Docker Engine and Docker Compose)
- Git (via Xcode Command Line Tools or Homebrew)

**Windows**
- [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) with WSL2 backend enabled (recommended)
- Git for Windows or Git inside WSL2

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd b2b-order-intake

# 2. Configure - only one required change
cp .env.example .env
# Edit .env and set: ANTHROPIC_API_KEY=sk-ant-...

# 3. Start all services
docker compose up -d

# 4. Wait ~30 seconds for services to initialise, then open
#    Agent Control Interface:  http://localhost:3000
#    Pipeline API health:      http://localhost:3002/health
```

All other `.env` values have working defaults for local development. No database setup, no external accounts beyond Anthropic.

---

## Running your first order

The pipeline ships with a 52-test corpus covering every routing path.

1. Open the **Agent Control Interface** at `http://localhost:3000`
2. Navigate to **Test Corpus**
3. Click **Run** next to `email-01` - a well-formed purchase order from a known buyer
4. Switch to **Live Feed** - the order appears within a few seconds
5. Click the order row to see the full extraction, validation, routing, and ERP submission in the **Audit Log**

### Key test cases to explore

| Test | Channel | Expected outcome | What it shows |
|------|---------|-----------------|---------------|
| `email-01` | Email | Submit | Happy path - all fields present, SKUs resolved, customer matched |
| `email-02` | Email | Clarify | Missing quantity -> AI sends personalised clarification to buyer |
| `email-03` | Email | Reject | Spam detection -> silent reject, no reply |
| `edi-01` | EDI | Submit | Clean X12 850 -> auto-submitted to ERP |
| `edi-04` | EDI | Review | No-stock item -> Human Review queue |
| `edi-07` | EDI | Review | Unknown trading partner -> operator identifies account |
| `email-09` | Email | Review | AI fuzzy customer match -> operator confirms |
| Run any EDI test twice | EDI | Reject + 855 | Duplicate PO -> automatic X12 855 rejection |

### Human-in-the-loop review

When an order routes to **Human Review**:
1. Navigate to the **Human Review** tab
2. Click **Approve to ERP** to submit, **Send Clarification** to request more information, or **Reject**
3. For EDI orders, Reject offers a choice: formal X12 855 acknowledgement or silent reject
4. The LangGraph graph resumes from its checkpointed state - the full pipeline (ERP submission, 864/855 generation, notification) runs through the graph nodes, not the API

---

## Configuration reference

Copy `.env.example` to `.env` before starting. The only required change is `ANTHROPIC_API_KEY`.

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

### Adapter selection

| Variable | Default | Options |
|----------|---------|---------|
| `ERP_ADAPTER` | `stub` | `stub` / add: `netsuite`, `sap` |
| `INBOUND_MAIL_PROVIDER` | `mailpit` | `mailpit` (dev polling), `sendgrid` (production webhook) |
| `EMAIL_PROVIDER` | `mailpit` | `mailpit`, `sendgrid` |
| `CUSTOMER_LOOKUP` | `json` | `json` / add: `salesforce` |
| `EXTRACTION_PROVIDER` | `claude` | `claude` |
| `SKU_RESOLVER` | `claude` | `claude` |
| `LOGGING_ADAPTER` | `postgres` | `postgres` / add: `datadog` |
| `EDI_OUTBOUND_PROVIDER` | `file` | `file` / add: `van`, `as2` |
| `CHANNEL_ADAPTERS` | `email,edi` | comma-separated list |

### Confidence thresholds

| Variable | Default | Effect |
|----------|---------|--------|
| `CONFIDENCE_SUBMIT_THRESHOLD` | `70` | Auto-submit when extraction confidence >= this |
| `CONFIDENCE_REVIEW_THRESHOLD` | `50` | Route to Human Review when confidence < this |
| `CONFIDENCE_UNREADABLE_THRESHOLD` | `5` | Treat as unreadable, request resubmission |
| `SKU_AUTO_THRESHOLD` | `90` | Auto-accept AI SKU match at this confidence |
| `SKU_REVIEW_THRESHOLD` | `50` | Surface SKU candidates for operator selection |
| `CUSTOMER_AUTO_THRESHOLD` | `90` | Auto-accept AI customer match at this confidence |

### Processing limits

| Variable | Default | Description |
|----------|---------|-------------|
| `DUPLICATE_PO_WINDOW_DAYS` | `30` | Days to check for duplicate PO numbers |
| `MAX_LINE_ITEMS` | `100` | Orders exceeding this route to review |
| `GRAPH_TIMEOUT_MS` | `60000` | Max ms a graph invocation may run |

### EDI paths (inside container)

| Variable | Default | Description |
|----------|---------|-------------|
| `EDI_INBOX_PATH` | `/app/edi-inbox` | Drop X12/CSV/XLSX files here |
| `EDI_ERROR_PATH` | `/app/edi-error` | Processed and errored files archived here |
| `EDI_OUTBOUND_PATH` | `/app/edi-outbound` | 864/855 replies written here |

---

## Swapping an adapter

To replace the stub ERP with a real integration:

1. Create `services/pipeline/src/adapters/erp/netsuite.js` implementing the `ERPAdapter` interface:
   ```js
   export class NetSuiteERPAdapter {
     async submitOrder(order) {
       // POST to NetSuite REST API
       // return { orderId, status, submittedAt }
     }
   }
   ```

2. Register it in `services/pipeline/src/adapters/erp/index.js`:
   ```js
   case 'netsuite': return new NetSuiteERPAdapter();
   ```

3. Set in `.env`:
   ```
   ERP_ADAPTER=netsuite
   ```

4. Rebuild: `docker compose build pipeline && docker compose up -d pipeline`

No other files change. The graph nodes, routing logic, and UI are unaffected.

The same pattern applies to every adapter. Interface contracts (`@typedef`) are documented in each `adapters/*/index.js` factory file.

---

## API reference

All endpoints are under `/api/v1/`. The Agent Control Interface consumes these exclusively - the UI has no direct database access.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/orders` | Paginated order list (`?limit=50&offset=0`) |
| `GET` | `/api/v1/orders/:id` | Order detail with line items |
| `GET` | `/api/v1/orders/review/queue` | Pending human review orders |
| `GET` | `/api/v1/orders/:id/edi-preview` | Preview 864/855 before sending (`?action=clarify\|reject`) |
| `POST` | `/api/v1/orders/:id/review` | Operator action: `{ action, notes, formalReject }` |
| `GET` | `/api/v1/erp/orders` | ERP submission list |
| `GET` | `/api/v1/erp/orders/:id` | ERP submission detail |
| `GET` | `/api/v1/audit/grouped` | Audit log grouped by order |
| `GET` | `/api/v1/audit` | Flat audit event list with filters |
| `GET` | `/api/v1/config` | Runtime config for the UI |
| `GET` | `/api/v1/health/all` | Aggregate health check |
| `POST` | `/api/v1/test/clear` | Reset all test data (`ENABLE_TEST_ENDPOINTS=true`) |
| `GET` | `/api/v1/test/manifest` | Test corpus manifest |
| `POST` | `/api/v1/test/run` | Inject a corpus test case |

---

## Services

| Service | Port | Description |
|---------|------|-------------|
| Agent Control Interface | `3000` | React UI - order feed, review queue, audit log |
| Pipeline API | `3002` | Express REST API + LangGraph graph |
| PostgreSQL | `5432` | Orders, audit log, LangGraph checkpoints |
| Mailpit | `8025` | Local email server for development |
| ERP Stub | `3001` | Simulated ERP - stores submitted orders |

---

## Updating

**Configuration change only** (`.env` values, thresholds, adapter selection):
```bash
nano .env
docker compose up -d pipeline
```

**Source code update** (new release tarball):
```bash
# Transfer the new tarball to the server, then:
docker compose down

# Preserve your .env across the update
cp .env ../b2b-order-intake.env.backup
cd ..
rm -rf b2b-order-intake
tar -xzf b2b-order-intake.tar.gz
cp b2b-order-intake.env.backup b2b-order-intake/.env

cd b2b-order-intake
docker compose build && docker compose up -d
```

Existing order data, audit log, and ERP submissions are stored in the PostgreSQL volume and survive updates. To wipe all data and start fresh use the **Clear All Test Data** button in the UI or `POST /api/v1/test/clear`.

---

## Troubleshooting

**Orders not appearing after injection**
Check `docker logs b2b-order-intake-pipeline-1 2>&1 | tail -20` for structured JSON error logs. Each log line includes `orderId` and `channel` for filtering.

**"Anthropic API key invalid"**
Confirm `ANTHROPIC_API_KEY` in `.env` starts with `sk-ant-` and has not expired.

**EDI files not being picked up**
Confirm the file extension is `.edi`, `.csv`, or `.xlsx`. Check `EDI_INBOX_PATH` is `/app/edi-inbox` (absolute, not relative). Files processed previously are in `edi-error/` with a `processed-` prefix.

**Port already in use**
Edit `.env` and change the conflicting port (e.g. `AGENT_UI_PORT=3100`), then `docker compose up -d`.

**Human Review approve not completing**
Check logs for `"Graph resume failed"`. The LangGraph checkpointer requires the order to have been processed in the current session (checkpoints are cleared with test data).

**Clearing test data**
Use the **Clear All Test Data** button in the Agent Control Interface, or `POST /api/v1/test/clear`. This truncates all order, audit, ERP, and LangGraph checkpoint data and resets the seen-set so the same test files can be re-run.

**Switching to SendGrid Inbound Parse (production email)**
1. Set `INBOUND_MAIL_PROVIDER=sendgrid` in `.env`
2. In the SendGrid dashboard: Mail Settings / Inbound Parse / Add Host & URL
   - URL: `https://<your-public-host>/api/v1/email/inbound`
   - Enable "POST the raw, full MIME message"
3. Optionally set `SENDGRID_INBOUND_WEBHOOK_KEY` to a shared secret and configure it in the SendGrid webhook settings for request validation
4. Apply: `docker compose up -d pipeline`

---

## Tech stack

| Component | Technology |
|-----------|-----------|
| AI orchestration | [LangGraph](https://github.com/langchain-ai/langgraphjs) (StateGraph + PostgresSaver) |
| AI model | [Claude](https://anthropic.com) (extraction, SKU resolution, customer matching) |
| Pipeline API | Node.js / Express |
| Agent Control Interface | React (Vite) |
| Database | PostgreSQL 16 |
| Email (dev) | Mailpit / nodemailer / mailparser |
| Email (prod) | SendGrid Inbound Parse / mailparser |
| EDI | ANSI X12 (850 / 864 / 855) |
| Containerisation | Docker Compose |

---

## License

Copyright (c) 2026 MACH Alliance. MIT License - see [LICENSE](LICENSE) for details.
