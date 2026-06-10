# Setup Instructions
## Agentic B2B Order Intake — Local Development Setup

These instructions cover everything needed to get the prototype running on a local machine. The expected setup time is 30–60 minutes, most of which is Docker pulling images on the first run.

---

## Prerequisites

**Docker** — Docker Desktop is the simplest option on macOS and Windows. On Linux, Docker Engine with the Compose plugin is the standard approach. Either way, verify both are available before starting:

```bash
docker --version
docker compose version
```

Both commands should return a version number. If `docker compose` is not found, try `docker-compose` (with a hyphen) — older installations use the standalone binary.

**An Anthropic API key** — the pipeline uses Claude for order extraction and resolution. An API key is available at [console.anthropic.com](https://console.anthropic.com). A new account includes sufficient free credits to run the full test corpus multiple times.

**Git** — for cloning the repository. Alternatively, the repository can be downloaded as a zip or tar archive directly from GitHub without Git installed — see Step 1.

**A terminal** — any shell works. On Windows, PowerShell, Git Bash, and WSL are all fine.

---

## Step 1 — Get the Code

**Option A — Git clone:**

```bash
git clone https://github.com/machalliance/solution-studio-b2b-order-intake.git
cd solution-studio-b2b-order-intake
```

**Option B — Download and extract (no Git required):**

Download the archive from GitHub:

```
https://github.com/machalliance/solution-studio-b2b-order-intake/archive/refs/heads/main.tar.gz
```

Then extract it:

```bash
# macOS / Linux
tar -xzf main.tar.gz
cd solution-studio-b2b-order-intake-main

# Windows (PowerShell)
tar -xzf main.tar.gz
cd solution-studio-b2b-order-intake-main
```

GitHub also offers a zip download from the same page if you prefer — use your operating system's built-in extraction tool or any archive utility.

---

## Step 2 — Configure the Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` in any text editor. The only value that needs to be set before the first run is the Anthropic API key:

```
ANTHROPIC_API_KEY=your-api-key-here
```

Everything else in `.env` has sensible defaults for local development. A few values worth knowing about:

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | The Claude model used for extraction and resolution |
| `CONFIDENCE_SUBMIT_THRESHOLD` | `85` | Orders at or above this score are auto-submitted (integer, 0–100) |
| `CONFIDENCE_REVIEW_THRESHOLD` | `50` | Orders above this but below the submit threshold go to Human Review |
| `INBOUND_MAIL_POLL_INTERVAL_MS` | `5000` | How often the email channel checks for new messages (milliseconds) |
| `INBOUND_MAIL_PROVIDER` | `mailpit` | Inbound email backend — `mailpit` for local dev, `sendgrid` for production |
| `EMAIL_PROVIDER` | `mailpit` | Outbound email backend — `mailpit` for local dev, `sendgrid` for production |
| `ZERO_PRICE_ACTION` | `review` | Policy when a line item has a zero price — `reject`, `review`, or `approve` |
| `MAX_LINE_ITEMS` | `100` | Maximum line items per order |
| `ERP_STUB_URL` | `http://erp-stub:3001` | Internal URL of the ERP stub service |

The full list of variables with descriptions is in `.env.example`.

---

## Step 3 — Start the Services

```bash
docker compose up --build
```

The `--build` flag is only needed on the first run or after pulling new changes. Subsequent starts can use:

```bash
docker compose up
```

To run services in the background and free up the terminal, add the `-d` flag:

```bash
docker compose up -d
```

Logs are still accessible via `docker compose logs <service-name>` when running detached.

Docker will pull the required base images and build the application containers. On a typical broadband connection this takes a few minutes the first time. When all services are ready, the terminal output will settle and you should see log lines from each service.

Five services run in total:

| Service | Port | Purpose |
|---|---|---|
| `agent-ui` | 3000 | Agent Control Interface |
| `erp-stub` | 3001 | Simulated ERP system |
| `pipeline` | 3002 | Order processing pipeline |
| `mailpit` | 8025 | Local email server (UI + SMTP) |
| `postgres` | 5432 | Database |

To verify all five containers are healthy:

```bash
docker compose ps
```

All services should show a `healthy` status. If any show `starting`, wait a few seconds and run the command again — the pipeline service waits for the database to be fully ready before it starts.

---

## Step 4 — Open the Agent Control Interface

Navigate to [http://localhost:3000](http://localhost:3000) in a browser. The Live Feed tab should be visible and empty — no orders have been processed yet.

---

## Step 5 — Process Your First Order

### Using the Test Corpus page

Navigate to the **Test Corpus** tab in the Agent Control Interface. The page shows all available tests organized by channel — 25 email tests and 24 EDI tests — each with a name, description of what it exercises, and the expected outcome shown as a colored badge (Submit, Clarify, Review, or Reject).

Before running tests, use **Clear All Test Data** (top right of the nav bar) to reset deduplication. Then either run tests individually using the **Run** button next to each test, or run all tests in a channel group at once using **Run all Email** or **Run all EDI**. Each test also has a **Preview** button to inspect the raw file before sending it.

Results appear in the Live Feed as each order is processed.

### Alternatively — via the EDI drop folder

Any file placed in the `edi-inbox/` directory at the root of the repository is picked up by the EDI channel adapter:

```bash
cp corpus/edi/order-001-valid.csv edi-inbox/
```

On success the file is moved to `edi-error/` with a `processed-` prefix (e.g. `processed-order-001-valid.csv`). On failure it stays in `edi-error/` without the prefix.

### Alternatively — via the email channel

In local development, email is handled through Mailpit. Any SMTP client pointed at `localhost:1025` can send a message to the intake address and it will be picked up on the next poll. The Test Corpus page is the easier option for structured test cases.

Outbound emails (clarification replies, ERP confirmations) are visible in Mailpit via the **Mail** button in the nav bar, or at [http://localhost:8025](http://localhost:8025).

---

## Step 6 — Read the Live Feed

Orders appear in the **Live Feed** as they are processed, showing channel, content type, PO number, confidence score, and routing outcome. Click any order ID to open the Order Detail view, which shows the full extracted fields, per-field confidence scores, and the AI reasoning behind the routing decision.

---

## Step 7 — Work the Human Review Queue

Orders the agent could not fully resolve land in the **Human Review** tab. Each card shows the PO number, channel, content type, timestamp, and the specific reason it was routed to review — for example, "ambiguous SKUs with candidates for operator selection on line: 1."

Click **View Detail** to see the full order, extracted fields, and AI reasoning before deciding. From the queue, three actions are available:

**Approve → ERP** — submits the order to the ERP stub as-is.

**Send Clarification** — behavior varies by channel:
- For email orders, a reply is sent to the buyer.
- For EDI orders, a dialog opens showing a pre-filled X12 864 Text Message addressed to the trading partner. An optional notes field lets the operator add context before clicking **Send 864 Clarification**.

**Reject** — a dialog asks how the trading partner should be notified:
- **Send 855 Rejection** — sends a formal X12 855 Purchase Order Acknowledgement (BAK02=RJ) to the trading partner's outbound queue.
- **Silent Reject** — no outbound message. Appropriate for unknown senders or spam where notifying the sender is not appropriate.

---

## Stopping the Services

```bash
docker compose down
```

This stops and removes the containers but preserves the database volume. Orders processed in a previous session will still be in the audit log when the services are restarted.

To stop and remove all data including the database:

```bash
docker compose down -v
```

---

## Channel Configuration

### Email channel

Inbound and outbound email providers are configured separately. `INBOUND_MAIL_PROVIDER` controls how orders arrive (default: `mailpit`); `EMAIL_PROVIDER` controls how outbound clarification emails are sent (default: `mailpit`). In local development both point to Mailpit.

For a production deployment, setting `INBOUND_MAIL_PROVIDER=sendgrid` enables SendGrid Inbound Parse — emails sent to the configured intake address are delivered to the pipeline via webhook in real time. Once configured, you can send a real email to the configured intake address from any mail client and the pipeline will receive, parse, and process it exactly as it would a buyer order. This is a useful end-to-end test before go-live. Configure `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and `SENDGRID_WEBHOOK_SECRET` in `.env` or your secrets manager.

Outbound clarification emails in local development are caught by Mailpit and visible at [http://localhost:8025](http://localhost:8025).

### EDI channel

The EDI channel watches the `edi-inbox/` directory. Supported file types are CSV, XLSX, and X12 850 EDI — the content parser is selected automatically based on file extension.

Processed files are moved to `edi-error/` with a `processed-` prefix on success, or left without the prefix on failure. Outbound EDI responses (X12 864 clarifications and 855 rejections generated by Human Review actions) are written to `edi-outbound/`.

### Adding a new channel

New channel adapters can be added by implementing the channel adapter interface defined in `services/pipeline/src/channels/`. The pipeline's LangGraph graph does not change — only a new adapter module and registration in the adapter factory are needed.

---

## Common Troubleshooting

**`docker compose up` fails immediately with a port conflict**

One of the required ports (3000, 3001, 3002, 5432, or 8025) is already in use. Identify which:

```bash
lsof -i :3000   # macOS / Linux
netstat -ano | findstr :3000   # Windows
```

Either stop the conflicting process or change the port mapping in `docker-compose.yml`. The internal container ports do not need to change — only the host-side mapping.

**The pipeline container exits on startup**

The most common cause is a missing or malformed `ANTHROPIC_API_KEY` in `.env`. Check the pipeline logs:

```bash
docker compose logs pipeline
```

An invalid key produces an authentication error on the first API call. Verify the key is correct in the Anthropic console and that there are no extra spaces or line breaks in `.env`.

**Orders appear in `edi-errors/` instead of the Live Feed**

The file may be malformed or in an unsupported format. Check the pipeline logs for the specific error:

```bash
docker compose logs pipeline --tail 50
```

Common causes include: an XLSX file saved in an incompatible version, a CSV with non-standard delimiters, or an X12 file with a missing ISA segment. The test corpus files in `corpus/edi/` are all known-good references.

**The Live Feed shows orders but they are not appearing in the database**

The audit log is written to PostgreSQL. If the database container is unhealthy, log writes may fail silently. Check the database status:

```bash
docker compose ps postgres
docker compose logs postgres --tail 20
```

Restarting the database container is usually sufficient:

```bash
docker compose restart postgres
```

**Mailpit is not receiving clarification emails**

Verify the pipeline logs show the clarification send attempt. If the send is attempted but the email does not appear in Mailpit, confirm that `EMAIL_PROVIDER` is set to `mailpit` (or left unset, which defaults to Mailpit) and that `SMTP_HOST` and `SMTP_PORT` are not overriding the defaults.

**The Agent Control Interface loads but shows no orders after processing**

The UI polls the pipeline API on a short interval. A hard refresh (Ctrl+Shift+R or Cmd+Shift+R) will re-fetch the latest state. If the Live Feed remains empty after a confirmed successful order processing, check the pipeline logs for any database write errors.

**A service shows `unhealthy` in `docker compose ps`**

Each service defines a health check. An unhealthy status usually means the service crashed after starting. Inspect the logs:

```bash
docker compose logs <service-name> --tail 50
```

Restarting the affected service is often sufficient:

```bash
docker compose restart <service-name>
```

If a service repeatedly becomes unhealthy, the most common causes are: insufficient memory allocated to Docker (increase the memory limit in Docker Desktop settings), a port conflict that Docker did not catch at startup, or a corrupted database volume (resolve with `docker compose down -v` followed by `docker compose up --build`).

---

## Resetting to a Clean State

**Test data only — use the button**

The **Clear All Test Data** button in the top-right of the nav bar wipes all orders, audit events, and ERP submissions from the database without touching the running services. This is the quickest way to reset between test runs — no restart needed.

**Full reset — Docker**

To stop all services and remove all data including the database volume:

```bash
docker compose down -v
docker compose up --build
```