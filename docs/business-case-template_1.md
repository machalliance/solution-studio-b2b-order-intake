# Business Case Template
## Agentic B2B Order Intake — Cost Savings Model

This template helps your organization quantify the labour and error-cost savings available from deploying an agentic B2B order intake pipeline. The accompanying spreadsheet (`business-case-model.xlsx`) contains the model. This document explains the methodology, assumptions, and sources.

---

## How to use the model

Open `business-case-model.xlsx`. The **Model** sheet contains two sections:

- **Section A — Current State:** enter your actual numbers (highlighted in yellow). The sheet calculates your current monthly cost of manual order intake.
- **Section B — Projected State:** enter the automation rate you expect to achieve. The sheet calculates projected costs and the resulting saving.

All input cells are shown in **blue text**. All calculated cells are in **black text** and should not be edited.

The **Sensitivity** sheet shows monthly savings across a range of automation rates so you can model conservative, base, and optimistic scenarios without changing the main inputs.

The **Sources** sheet lists every cited figure with a direct URL.

---

## Inputs explained

### Orders processed per month
The total number of inbound purchase orders your team currently handles manually, across all channels and formats. Count every order that requires a human to read, interpret, validate, and enter into your ERP — including those that are ultimately rejected or sent back for clarification.

### Average minutes per order (manual)
How long a staff member spends on a single order, from receiving it to completing ERP entry or sending a clarification reply.

**Default: 12 minutes**
This is the midpoint of the range documented in industry research:
- Emporix (2026) documents a real B2B distributor averaging approximately 8 minutes per order before automation. Source: [emporix.com/blog/b2b-order-processing-automation-ai](https://www.emporix.com/blog/b2b-order-processing-automation-ai)
- 2hatslogic (2025) reports 10–15 minutes as the typical range for B2B manual order entry. Source: [2hatslogic.com/blog/why-smbs-should-automate-order-capture](https://www.2hatslogic.com/blog/why-smbs-should-automate-order-capture/)

If you have your own measurement, use it in preference to the default.

### Staff fully-loaded hourly cost
The total hourly cost of the staff member processing orders — including salary, benefits, overhead, and management. A reasonable starting point for most organizations is 1.25–1.4× base salary divided by annual hours worked. Use your own figure.

### Current error rate (%)
The percentage of orders that contain at least one field-level error requiring correction — a wrong quantity, mismatched SKU, incorrect shipping address, or similar.

**Default: 2%**
This is the midpoint of the range documented in B2B order entry research:
- Conexiom (2025), citing APQC data entry benchmarks, reports 1–3% error rate for manual order entry. Source: [conexiom.com/blog/the-real-cost-of-manual-order-entry-in-b2b-operations](https://conexiom.com/blog/the-real-cost-of-manual-order-entry-in-b2b-operations)
- Nventory (2025) notes that at a 3% per-field error rate across 9+ fields, approximately 24% of orders contain at least one error. Source: [nventory.io/blog/manual-order-processing-costs](https://nventory.io/blog/manual-order-processing-costs)

### Estimated cost per order error
The internal cost of correcting a single order error — staff time for rework, credit note processing, customer communication, and any fulfillment delays. This figure varies widely by organization and order value. Enter your own estimate based on experience. Do not use a default — this is too organization-specific to generalize.

### Expected automation rate (%)
The percentage of inbound orders the agent is expected to handle end-to-end without human intervention — i.e., auto-submitted to ERP after passing all validation checks.

**Default: 67%**
This is the industry average reported in Esker's June 2025 benchmark based on data from hundreds of Customer Service departments using AI-driven order management. Top-performing organizations exceed 90%. Source: [esker.com/blog/customer-service/how-order-management-benchmarks-can-guide-smarter-business-decisions](https://www.esker.com/blog/customer-service/how-order-management-benchmarks-can-guide-smarter-business-decisions/)

This default reflects established deployments — a new implementation should model conservatively using the Sensitivity sheet. Your actual rate depends on buyer mix, order format quality, and ERP integration maturity.

---

## What the model calculates

**Current monthly labour cost** = Orders × (Minutes per order ÷ 60) × Hourly cost

**Current monthly error cost** = Orders × Error rate × Cost per error

**Total current monthly cost** = Labour cost + Error cost

**Projected monthly labour cost** = Human-handled orders × (Minutes per order ÷ 60) × Hourly cost
*(Human-handled orders = total orders × (1 − automation rate))*
*(Auto-submitted orders require no manual handling time)*

**Projected monthly error cost** = Human-handled orders × Error rate × Cost per error
*(Auto-submitted orders have no manual re-keying errors)*

**Monthly saving** = Current total − Projected total

**Annual saving** = Monthly saving × 12

**Payback period** = Implementation cost ÷ Monthly saving

---

## What this model does not include

This model measures **direct labour and error-correction costs only**. A full business case would also quantify:

- **Speed to revenue:** orders that auto-submit in seconds rather than hours or days reduce order-to-cash cycle time.
- **Customer experience:** faster, more accurate order processing reduces buyer frustration and follow-up queries.
- **Scalability:** the agent handles volume growth without proportional headcount increases.
- **Opportunity cost:** staff freed from intake can redirect time to higher-value activities.

None of these are modelled because they require organization-specific data that cannot be generalized. They represent additional value not captured in these figures.

---

## Methodology notes

The model is intentionally conservative:

1. It assumes human-review and clarification orders still require the **full manual processing time** — in practice, the agent's pre-filled data and reasoning can reduce operator time significantly.
2. It assumes auto-submitted orders have **zero entry errors** — in practice, the agent can also make extraction errors, though at a lower rate than manual entry.
3. It does not model implementation cost amortization, only a simple payback period.

These choices mean the model understates total savings. Actual returns will be higher.

---

## Sources

All cited figures and their source URLs are listed in the **Sources** sheet of the accompanying spreadsheet. A summary:

| Figure | Source | URL |
|---|---|---|
| 8–15 min per order | Emporix (2026), 2hatslogic (2025) | emporix.com, 2hatslogic.com |
| €25–€100 per order | Emporix (2026) | emporix.com |
| 87% time reduction | Emporix (2026) | emporix.com |
| 1–3% error rate | Conexiom (2025) | conexiom.com |
| ~24% of orders with ≥1 error | Nventory (2025) | nventory.io |
| 67% average touchless rate | Esker benchmark, Jun 2025 | esker.com |
| 90%+ touchless for top performers | Esker benchmark, Jun 2025 | esker.com |
| Manual orders 2x more error-prone | Conexiom (2025) | conexiom.com |
| Manual orders 33% more likely to ship late | Conexiom (2025) | conexiom.com |
| CSR spends up to 80% of day on manual entry | Conexiom (2025) | conexiom.com |
| $43 per PO manual cost (2020) | Aberdeen / IBM Sterling (2020) | community.ibm.com |
| 33% of POs have errors — manual (2020) | Aberdeen / IBM Sterling (2020) | community.ibm.com |
| $182 to fix a manual PO error (2020) | Aberdeen / IBM Sterling (2020) | community.ibm.com |

**Note on Aberdeen data:** The $43, 33%, and $182 figures are from 2020 research across 165 organizations. They are included for directional context. If more current data is available for your organization or sector, use that in preference.

---

## Disclaimer

This template is provided for illustrative planning purposes. All inputs marked in yellow should be replaced with your organization's actual data before presenting the output to decision-makers. The default values are drawn from published industry research as cited — they are not guarantees of the outcomes your organization will achieve.
