import { useState, useEffect } from 'react';
import {
  computeBlendedScore,
  ConfidenceBreakdown,
  ExtractedOrder,
  TraceEvent,
  Section,
  KVTable,
  fmtError,
  shared,
} from '../components/OrderView.jsx';

/**
 * Standalone order detail view - used by Live Feed (click) and Human Review (View Detail).
 * Uses the same shared components as the Audit Log expanded view for consistency.
 */
export default function OrderDetail({ orderId, onBack }) {
  const [order,  setOrder]  = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!orderId) return;
    setOrder(null);
    setEvents([]);
    fetch(`/api/orders/${orderId}`)
      .then(r => r.json())
      .then(d => setOrder(d.order || null));
    fetch(`/api/audit?orderId=${orderId}&limit=50`)
      .then(r => r.json())
      .then(d => setEvents(d.events || []));
  }, [orderId]);

  if (!order) return <div style={styles.loading}>Loading...</div>;

  const byType        = Object.fromEntries(events.map(e => [e.event_type, e]));
  const errors        = byType.validation?.metadata?.businessRuleErrors || [];
  const skuStatuses   = byType.validation?.metadata?.skuStatuses       || [];
  const customerFound = byType.validation?.metadata?.customerFound;
  const blended       = computeBlendedScore(order.confidence_score, skuStatuses, customerFound);
  const meta          = order.channel_metadata || {};
  const extracted     = order.extracted_order  || {};

  return (
    <div>
      <button onClick={onBack} style={styles.back}>Back</button>
      <h2 style={styles.heading}>
        {order.po_number || order.order_id?.slice(0, 8) || 'Order Detail'}
      </h2>

      <Section title="Source">
        {order.channel === 'email' ? (
          <KVTable rows={[
            ['From',    meta.from    || '-'],
            ['To',      meta.to      || '-'],
            ['Subject', meta.subject || '-'],
            ['Date',    meta.date ? new Date(meta.date).toLocaleString() : '-'],
          ]} />
        ) : (
          <KVTable rows={[
            ['File',    meta.filename || '-'],
            ['Channel', 'EDI'],
          ]} />
        )}
      </Section>

      {extracted && Object.keys(extracted).length > 0 && (
        <Section title={
          order.confidence_score != null
            ? `Extracted order - extraction confidence ${order.confidence_score}%` +
              (blended != null && blended !== order.confidence_score ? ` . overall ${blended}%` : '')
            : 'Extracted order'
        }>
          {order.confidence_score != null && (
            <ConfidenceBreakdown
              extraction={order.confidence_score}
              blended={blended}
              skuStatuses={skuStatuses}
              customerFound={customerFound}
            />
          )}
          <ExtractedOrder order={extracted} errors={errors} skuStatuses={skuStatuses} />
        </Section>
      )}

      {order.ai_reasoning && (
        <Section title="Extraction reasoning">
          <div style={shared.reasoning}>{order.ai_reasoning}</div>
        </Section>
      )}

      {errors.length > 0 && (
        <Section title="Validation errors">
          <ul style={shared.errList}>
            {errors.map(e => <li key={e} style={shared.errItem}>{fmtError(e)}</li>)}
          </ul>
        </Section>
      )}

      {order.routing_reason && (
        <Section title="Routing decision">
          <div style={shared.routingReason}>{order.routing_reason}</div>
        </Section>
      )}

      <Section title="Pipeline trace">
        <div style={shared.timeline}>
          {events.map(ev => <TraceEvent key={ev.event_id} ev={ev} />)}
        </div>
      </Section>
    </div>
  );
}

const styles = {
  loading: { padding: '40px', textAlign: 'center', color: '#888' },
  back:    { background: 'none', border: 'none', color: '#194C85', cursor: 'pointer',
             fontSize: '14px', padding: '0', marginBottom: '8px' },
  heading: { fontSize: '20px', fontWeight: 600, color: '#0B1F33', margin: '8px 0 16px' },
};
