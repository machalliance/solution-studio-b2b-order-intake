-- Migration 007: Extend audit_log event_type check constraint
-- Adds event types introduced by the LangGraph human-in-the-loop implementation:
--   review_actioned - operator actioned a review item (approve/reject/clarify)
--   reject_sent     - formal rejection sent (EDI 855) or silent reject logged
ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_event_type_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_event_type_check CHECK (event_type IN (
    'intake',
    'extraction',
    'sku_resolution',
    'customer_lookup',
    'validation',
    'routing',
    'erp_submission',
    'clarify_sent',
    'reject_sent',
    'review_actioned',
    'error'
  ));
