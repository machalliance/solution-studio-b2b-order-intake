import { useState, useEffect, useCallback } from 'react';
import {
  computeBlendedScore,
  ConfidenceBreakdown,
  ExtractedOrder,
  TraceEvent,
  Section,
  KVTable,
  fmtError,
  shared,
  SKU_STATUS_STYLE,
  SKU_STATUS_LABEL,
} from '../components/OrderView.jsx';

const STAGE_ORDER = ['intake','extraction','customer_lookup','sku_resolution','validation','routing','erp_submission'];
const STAGE_LABEL = {
  intake:          'Intake',
  extraction:      'Extract',
  customer_lookup: 'Customer',
  sku_resolution:  'SKU',
  validation:      'Validate',
  routing:         'Route',
  erp_submission:  'ERP',
};

const DOC_TYPE_STYLE = {
  repeat_order: { background: '#dbeafe', color: '#1e40af' },
  amendment:    { background: '#fef3c7', color: '#92400e' },
  cancellation: { background: '#fee2e2', color: '#991b1b' },
  inquiry:      { background: '#e0f2fe', color: '#0369a1' },
  spam:         { background: '#f3f4f6', color: '#6b7280' },
  bec:          { background: '#fce7f3', color: '#9d174d' },
};

const OUTCOME_STYLE = {
  submit: { background: '#d1fae5', color: '#065f46' },
  review: { background: '#fef3c7', color: '#92400e' },
  reject: { background: '#fee2e2', color: '#991b1b' },
};

const CHANNEL_STYLE = {
  email: { background: '#dbeafe', color: '#1e40af' },
  edi:   { background: '#ede9fe', color: '#5b21b6' },
};

export default function AuditLog() {
  const [documents, setDocuments] = useState([]);
  const [expanded,  setExpanded]  = useState({});
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/audit/grouped?limit=100');
      const data = await res.json();
      setDocuments(data.documents || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(id => {
    setExpanded(e => ({ ...e, [id]: !e[id] }));
  }, []);

  return (
    <div>
      <div style={s.topBar}>
        <h2 style={s.heading}>Audit Log</h2>
        <button onClick={load} style={s.refreshBtn}>Refresh</button>
      </div>

      {loading && <div style={s.empty}>Loading...</div>}
      {!loading && documents.length === 0 && (
        <div style={s.empty}>No documents processed yet.</div>
      )}
      {!loading && documents.map(doc => (
        <DocRow
          key={doc.order_id}
          doc={doc}
          open={!!expanded[doc.order_id]}
          onToggle={() => toggle(doc.order_id)}
        />
      ))}
    </div>
  );
}

function DocRow({ doc, open, onToggle }) {
  const events       = doc.events || [];
  const byType       = Object.fromEntries(events.map(e => [e.event_type, e]));
  const outcome      = doc.routing_outcome;
  const oStyle       = OUTCOME_STYLE[outcome] || { background: '#f3f4f6', color: '#374151' };
  const cStyle       = CHANNEL_STYLE[doc.channel] || { background: '#f3f4f6', color: '#374151' };
  const meta         = doc.channel_metadata || {};
  const errors       = byType.validation?.metadata?.businessRuleErrors || [];
  const skuStatuses  = byType.validation?.metadata?.skuStatuses || [];
  const customerFound= byType.validation?.metadata?.customerFound;
  const source       = doc.channel === 'email' ? (meta.subject || meta.from || '-') : (meta.filename || '-');
  const ranStages    = STAGE_ORDER.filter(s => byType[s]);
  const extraction   = doc.confidence_score;
  const blended      = computeBlendedScore(extraction, skuStatuses, customerFound);
  const blendedColor = blended == null ? '#555'
                     : blended >= 70   ? '#065f46'
                     : blended >= 50   ? '#92400e'
                     : '#991b1b';

  return (
    <div style={s.card}>
      <div style={s.summaryRow} onClick={onToggle}>

        <div style={s.dateCell}>
          <div style={s.dateMain}>{fmtDate(doc.created_at)}</div>
          <div style={s.dateSub}>{fmtTime(doc.created_at)}</div>
        </div>

        <span style={{ ...s.badge, ...cStyle }}>{(doc.channel || '?').toUpperCase()}</span>

        <div style={s.sourceCell}>
          <div style={s.sourceMain}>{source}</div>
          <div style={s.sourceSub}>{doc.buyer_company || doc.sender_email || '-'}</div>
        </div>

        <div style={s.poCell}>
          {doc.po_number || <span style={s.muted}>-</span>}
          {doc.extracted_order?.documentType && doc.extracted_order.documentType !== 'new_order' && (
            <span style={{ ...s.docTypeBadge, ...DOC_TYPE_STYLE[doc.extracted_order.documentType] }}>
              {doc.extracted_order.documentType.replace('_', ' ')}
            </span>
          )}
        </div>

        <div style={s.stagesCell}>
          {ranStages.map(st => {
            let extra = {};
            if (st === 'erp_submission') {
              extra = s.pillGreen;
            } else if (st === 'validation' && (
              errors.length > 0 ||
              byType.validation?.metadata?.customerFound === false
            )) {
              extra = s.pillRed;
            } else if (st === 'customer_lookup' &&
                       byType.customer_lookup?.metadata?.fuzzyMatched === false &&
                       byType.validation?.metadata?.customerFound === false) {
              extra = s.pillAmber;
            } else if (st === 'routing') {
              if (outcome === 'submit')  extra = s.pillGreen;
              else if (outcome === 'review' || outcome === 'clarify') extra = s.pillAmber;
              else if (outcome === 'reject') extra = s.pillRed;
            }
            return <span key={st} style={{ ...s.stagePill, ...extra }}>{STAGE_LABEL[st]}</span>;
          })}
        </div>

        {blended != null && (
          <div style={s.confCell}>
            <div style={{ fontWeight: 600, color: blendedColor }}>{blended}%</div>
          </div>
        )}

        <span style={{ ...s.outcomeBadge, ...oStyle }}>
          {outcome ? outcome.charAt(0).toUpperCase() + outcome.slice(1) : '-'}
        </span>

        <div style={s.chevron}>{open ? '^' : 'v'}</div>
      </div>

      {open && <Detail doc={doc} events={events} byType={byType} errors={errors}
                       skuStatuses={skuStatuses} blended={blended} />}
    </div>
  );
}

function Detail({ doc, events, byType, errors, skuStatuses, blended }) {
  const meta = doc.channel_metadata || {};
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div style={s.detail}>

      <Section title="Source">
        {doc.channel === 'email' ? (
          <KVTable rows={[
            ['From',    meta.from    || '-'],
            ['To',      meta.to      || '-'],
            ['Subject', meta.subject || '-'],
            ['Date',    meta.date ? new Date(meta.date).toLocaleString() : '-'],
          ]} />
        ) : (
          <KVTable rows={[
            ['File',    meta.filename  || '-'],
            ['Channel', 'EDI'],
          ]} />
        )}
      </Section>

      {doc.extracted_order && (
        <Section title="Extracted order">
          {doc.confidence_score != null && (
            <ConfidenceBreakdown
              extraction={doc.confidence_score}
              blended={blended}
              skuStatuses={skuStatuses}
              customerFound={byType.validation?.metadata?.customerFound}
            />
          )}
          <ExtractedOrder order={doc.extracted_order} errors={errors} skuStatuses={skuStatuses} />
        </Section>
      )}

      {doc.ai_reasoning && (
        <Section title="Extraction reasoning">
          <div style={shared.reasoning}>{doc.ai_reasoning}</div>
        </Section>
      )}

      {errors.length > 0 && (
        <Section title="Validation errors">
          <ul style={shared.errList}>
            {errors.map(e => <li key={e} style={shared.errItem}>{fmtError(e)}</li>)}
          </ul>
        </Section>
      )}

      {doc.routing_reason && (
        <Section title="Routing decision">
          <div style={shared.routingReason}>{doc.routing_reason}</div>
        </Section>
      )}

      <Section title="Pipeline trace">
        <div style={shared.timeline}>
          {events.map(ev => <TraceEvent key={ev.event_id} ev={ev} />)}
        </div>
      </Section>

      {doc.raw_content && (
        <Section title={
          <span style={s.rawToggle} onClick={() => setShowRaw(r => !r)}>
            Raw document {showRaw ? '^' : 'v'}
          </span>
        }>
          {showRaw && <pre style={s.rawContent}>{doc.raw_content}</pre>}
        </Section>
      )}

    </div>
  );
}

function fmtDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const s = {
  topBar:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' },
  heading:     { fontSize: '20px', fontWeight: 600, color: '#0B1F33', margin: 0 },
  refreshBtn:  { padding: '6px 14px', border: '1px solid #cdd5e0', borderRadius: '4px',
                 cursor: 'pointer', fontSize: '13px', background: 'white' },
  empty:       { textAlign: 'center', padding: '60px', color: '#888', fontSize: '14px' },

  card:        { background: 'white', borderRadius: '8px', marginBottom: '8px',
                 boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' },
  summaryRow:  { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                 cursor: 'pointer', userSelect: 'none' },

  dateCell:    { minWidth: '88px' },
  dateMain:    { fontSize: '13px', fontWeight: 500, color: '#1a202c' },
  dateSub:     { fontSize: '11px', color: '#888', marginTop: '2px' },

  badge:       { fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '3px',
                 letterSpacing: '0.05em', whiteSpace: 'nowrap' },

  sourceCell:  { flex: 2, minWidth: 0 },
  sourceMain:  { fontSize: '13px', fontWeight: 500, color: '#1a202c',
                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sourceSub:   { fontSize: '11px', color: '#888', marginTop: '2px' },

  poCell:      { minWidth: '110px', fontSize: '13px', fontFamily: 'monospace', color: '#194C85',
                 display: 'flex', flexDirection: 'column', gap: '3px' },
  docTypeBadge:{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px',
                 letterSpacing: '0.04em', textTransform: 'uppercase', alignSelf: 'flex-start',
                 fontFamily: 'system-ui, sans-serif' },
  muted:       { color: '#bbb' },

  stagesCell:  { flex: 3, display: 'flex', flexWrap: 'wrap', gap: '4px' },
  stagePill:   { fontSize: '11px', padding: '2px 7px', borderRadius: '10px',
                 background: '#e2e8f0', color: '#4a5568', whiteSpace: 'nowrap' },
  pillGreen:   { background: '#d1fae5', color: '#065f46' },
  pillAmber:   { background: '#fef3c7', color: '#92400e' },
  pillRed:     { background: '#fee2e2', color: '#991b1b' },

  confCell:        { fontSize: '13px', minWidth: '52px', textAlign: 'right' },
  confSub:         { fontSize: '10px', color: '#aaa', marginTop: '1px' },

  outcomeBadge:{ fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: '4px',
                 whiteSpace: 'nowrap' },
  chevron:     { fontSize: '11px', color: '#aaa', minWidth: '14px', textAlign: 'center' },

  // AuditLog-specific detail styles - shared display styles live in OrderView.jsx
  detail:      { borderTop: '1px solid #e8eef4', padding: '20px 24px', background: '#fafbfc' },
  rawToggle:   { cursor: 'pointer', userSelect: 'none', color: '#555' },
  rawContent:  { fontSize: '11px', fontFamily: 'monospace', color: '#374151', whiteSpace: 'pre-wrap',
                 background: '#f3f4f6', padding: '12px 14px', borderRadius: '6px',
                 maxHeight: '400px', overflowY: 'auto', margin: 0 },
};
