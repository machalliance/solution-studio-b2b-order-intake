/**
 * Shared order detail display components used by both AuditLog and OrderDetail.
 * Extracting here ensures both views are pixel-identical - one source of truth.
 */

export const SKU_STATUS_STYLE = {
  exact:   { background: '#d1fae5', color: '#065f46' },
  auto:    { background: '#dbeafe', color: '#1e40af' },
  review:  { background: '#fef3c7', color: '#92400e' },
  clarify: { background: '#fee2e2', color: '#991b1b' },
};
export const SKU_STATUS_LABEL = { exact: 'Exact', auto: 'AI match', review: 'Review', clarify: 'Unresolved' };

/**
 * Blends extraction confidence with SKU and customer resolution quality.
 * Extraction confidence only measures how well the document was read.
 * Penalties: -20 per clarify SKU, -10 per review SKU, -20 if customer unresolved.
 */
export function computeBlendedScore(extractionConf, skuStatuses, customerFound) {
  if (extractionConf == null) return null;
  let penalty = 0;
  for (const sku of (skuStatuses || [])) {
    if (sku.status === 'clarify') penalty += 20;
    else if (sku.status === 'review') penalty += 10;
  }
  if (customerFound === false) penalty += 20;
  return Math.max(0, Math.round(extractionConf - penalty));
}

export function ConfidenceBreakdown({ extraction, blended, skuStatuses, customerFound }) {
  const rows = [];
  rows.push({ label: 'Extraction confidence', value: `${extraction}%`, note: 'how well the document was read' });
  const clarifyLines = (skuStatuses || []).filter(s => s.status === 'clarify');
  const reviewLines  = (skuStatuses || []).filter(s => s.status === 'review');
  if (clarifyLines.length > 0) {
    const lineNums = clarifyLines.map(s => s.line).join(', ');
    rows.push({ label: `Unresolved SKU${clarifyLines.length > 1 ? 's' : ''} (line${clarifyLines.length > 1 ? 's' : ''} ${lineNums})`, value: `-${clarifyLines.length * 20}`, note: 'no inventory match found' });
  }
  if (reviewLines.length > 0) {
    const lineNums = reviewLines.map(s => s.line).join(', ');
    rows.push({ label: `Ambiguous SKU${reviewLines.length > 1 ? 's' : ''} (line${reviewLines.length > 1 ? 's' : ''} ${lineNums})`, value: `-${reviewLines.length * 10}`, note: 'operator selection required' });
  }
  if (customerFound === false) rows.push({ label: 'Customer unresolved', value: '-20', note: 'no matching account found' });

  const hasDeductions = blended != null && blended !== extraction;
  return (
    <div style={shared.confBreakdown}>
      {rows.map((r, i) => (
        <div key={i} style={{ ...shared.confBreakdownRow, ...(i === rows.length - 1 && hasDeductions ? shared.confBreakdownTotal : {}) }}>
          <span style={shared.confBreakdownLabel}>{r.label}</span>
          <span style={shared.confBreakdownNote}>{r.note}</span>
          <span style={{ ...shared.confBreakdownValue, color: r.value.startsWith('-') ? '#991b1b' : '#374151' }}>{r.value}</span>
        </div>
      ))}
      {hasDeductions && (
        <div style={{ ...shared.confBreakdownRow, ...shared.confBreakdownOverall }}>
          <span style={shared.confBreakdownLabel}>Overall confidence</span>
          <span style={shared.confBreakdownNote} />
          <span style={{ ...shared.confBreakdownValue, fontWeight: 700, color: blended >= 70 ? '#065f46' : blended >= 50 ? '#92400e' : '#991b1b' }}>{blended}%</span>
        </div>
      )}
    </div>
  );
}

export function ExtractedOrder({ order, errors, skuStatuses = [] }) {
  const lineErrors = {};
  for (const e of errors) {
    const m = e.match(/^line_(\d+)_(.+)$/);
    if (m) { lineErrors[m[1]] = lineErrors[m[1]] || []; lineErrors[m[1]].push(m[2].replace(/_/g, ' ')); }
  }
  const headerMissing = new Set(errors.filter(e => e.startsWith('missing_')));
  const skuStatusMap  = Object.fromEntries((skuStatuses || []).map(ss => [String(ss.line), ss.status]));

  const buyer   = order.buyer || {};
  const fmtAddr = a => a ? [a.street, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ') : '-';
  const val     = (v, errKey) => (v != null && v !== '') ? v : headerMissing.has(errKey) ? <span style={shared.missingField}>[missing]</span> : '-';

  return (
    <div>
      <KVTable rows={[
        ['PO Number',  val(order.poNumber,  'missing_poNumber')],
        ['Order Date', val(order.orderDate, 'missing_orderDate')],
        ['Currency',   order.currency || '-'],
        ['Delivery',   order.requestedDeliveryDate || '-'],
      ]} />
      <div style={shared.subHead}>Buyer</div>
      <KVTable rows={[
        ['Company',    val(buyer.companyName, 'missing_buyer_company')],
        ['Email',      val(buyer.email,       'missing_buyer_email')],
        ['Account ID', buyer.accountId || '-'],
        ['Phone',      buyer.phone     || '-'],
        ['Address',    fmtAddr(buyer.address)],
      ]} />
      {order.shippingAddress && (
        <><div style={shared.subHead}>Ship To</div><KVTable rows={[['Address', fmtAddr(order.shippingAddress)]]} /></>
      )}
      {order.lineItems?.length > 0 && (
        <>
          <div style={shared.subHead}>Line Items</div>
          <table style={shared.lineTable}>
            <thead>
              <tr>{['#','SKU','Description','Qty','UOM','Unit Price','Match'].map(h => <th key={h} style={shared.lineTh}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {order.lineItems.map((item, idx) => {
                const n    = String(item.lineNumber);
                const errs = lineErrors[n] || [];
                const siblings    = order.lineItems.filter(i => String(i.lineNumber) === n);
                const isConflict  = siblings.length > 1;
                const conflictIdx = siblings.indexOf(item);
                const conflictLabel = isConflict ? String.fromCharCode(65 + conflictIdx) : null;
                const hasQtyErr = !isConflict && errs.some(e => e.includes('quantity'));
                const st = skuStatusMap[n];
                return (
                  <tr key={idx} style={isConflict ? shared.lineRowConflict : errs.length ? shared.lineRowErr : shared.lineRow}>
                    <td style={shared.lineTd}>
                      {item.lineNumber}
                      {conflictLabel && <span style={shared.conflictLabel}>{conflictLabel}</span>}
                    </td>
                    <td style={shared.lineTd}><code style={shared.lineCode}>{item.buyerSku || '-'}</code></td>
                    <td style={shared.lineTd}>{item.productDescription || '-'}</td>
                    <td style={{ ...shared.lineTd, ...(hasQtyErr ? shared.lineTdErr : {}) }}>
                      {item.quantity != null ? item.quantity : hasQtyErr ? <span style={shared.missingField}>[missing]</span> : '-'}
                    </td>
                    <td style={shared.lineTd}>{item.unitOfMeasure || '-'}</td>
                    <td style={shared.lineTd}>{item.unitPrice != null ? item.unitPrice : '-'}</td>
                    <td style={shared.lineTd}>
                      {st ? <span style={{ ...shared.badge, ...SKU_STATUS_STYLE[st], fontSize: '10px', padding: '1px 6px' }}>{SKU_STATUS_LABEL[st] || st}</span> : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function TraceEvent({ ev }) {
  const meta     = ev.metadata || {};
  const hasError = ev.outcome === 'reject' || ev.event_type === 'error';
  const hasMeta  = Object.keys(meta).length > 0;
  return (
    <div style={shared.traceRow}>
      <div style={{ ...shared.dot, background: hasError ? '#f87171' : '#6ee7b7' }} />
      <div style={shared.traceBody}>
        <div style={shared.traceHeader}>
          <code style={shared.traceType}>{ev.event_type}</code>
          {ev.outcome && <span style={shared.traceOutcome}>{ev.outcome}</span>}
          <span style={shared.traceTime}>{new Date(ev.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        {ev.ai_reasoning && <div style={shared.traceReasoning}>{ev.ai_reasoning}</div>}
        {hasMeta && <pre style={shared.traceMeta}>{JSON.stringify(meta, null, 2)}</pre>}
      </div>
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <div style={shared.section}>
      <div style={shared.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

export function KVTable({ rows }) {
  return (
    <table style={shared.kvTable}><tbody>
      {rows.map(([k, v]) => (
        <tr key={k}><td style={shared.kvKey}>{k}</td><td style={shared.kvVal}>{v}</td></tr>
      ))}
    </tbody></table>
  );
}

export function fmtError(e) {
  const m = e.match(/^line_(\d+)_(.+)$/);
  if (m) return `Line ${m[1]}: ${m[2].replace(/_/g, ' ')}`;
  if (e.startsWith('missing_')) return `Missing: ${e.replace('missing_', '').replace(/_/g, ' ')}`;
  return e.replace(/_/g, ' ');
}

// Shared styles used by all exported components
export const shared = {
  section:      { background: 'white', borderRadius: '8px', marginBottom: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '16px 20px' },
  sectionTitle: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.07em', color: '#888', marginBottom: '10px' },
  kvTable:      { borderCollapse: 'collapse', fontSize: '13px' },
  kvKey:        { padding: '3px 20px 3px 0', color: '#888', fontWeight: 500, whiteSpace: 'nowrap', verticalAlign: 'top' },
  kvVal:        { padding: '3px 0', color: '#1a202c' },
  subHead:      { fontSize: '11px', fontWeight: 600, color: '#555', textTransform: 'uppercase',
                  letterSpacing: '0.05em', margin: '12px 0 4px' },
  missingField: { color: '#991b1b', fontStyle: 'italic' },
  badge:        { fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '3px',
                  letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  lineTable:       { width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '4px' },
  lineTh:          { textAlign: 'left', padding: '4px 10px 4px 0', color: '#888', fontWeight: 600,
                     borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' },
  lineRow:         { borderBottom: '1px solid #f0f4f8' },
  lineRowErr:      { borderBottom: '1px solid #f0f4f8', background: '#fff5f5' },
  lineRowConflict: { borderBottom: '1px solid #f0f4f8', background: '#fffbeb' },
  conflictLabel:   { fontSize: '10px', fontWeight: 700, color: '#92400e', background: '#fef3c7',
                     padding: '1px 4px', borderRadius: '3px', marginLeft: '5px' },
  lineTd:          { padding: '4px 10px 4px 0', verticalAlign: 'top' },
  lineTdErr:       { color: '#991b1b' },
  lineCode:        { fontFamily: 'monospace', fontSize: '11px', color: '#194C85',
                     background: '#EBF1F8', padding: '1px 4px', borderRadius: '3px' },
  reasoning:    { fontSize: '13px', color: '#374151', lineHeight: '1.7', background: '#f3f4f6',
                  padding: '12px 14px', borderRadius: '6px', whiteSpace: 'pre-wrap' },
  routingReason:{ fontSize: '13px', color: '#374151', lineHeight: '1.6' },
  errList:      { margin: 0, padding: '0 0 0 18px' },
  errItem:      { fontSize: '13px', color: '#991b1b', fontFamily: 'monospace', marginBottom: '3px' },
  confBreakdown:      { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px',
                        padding: '8px 12px', marginBottom: '14px', fontSize: '12px' },
  confBreakdownRow:   { display: 'flex', alignItems: 'baseline', gap: '8px', padding: '2px 0' },
  confBreakdownLabel: { fontWeight: 500, color: '#374151', minWidth: '220px' },
  confBreakdownNote:  { flex: 1, color: '#9ca3af', fontStyle: 'italic', fontSize: '11px' },
  confBreakdownValue: { fontFamily: 'monospace', fontWeight: 500, minWidth: '40px', textAlign: 'right' },
  confBreakdownTotal: { borderTop: '1px solid #e2e8f0', marginTop: '4px', paddingTop: '6px' },
  confBreakdownOverall: { marginTop: '2px' },
  timeline:     { display: 'flex', flexDirection: 'column', gap: '10px' },
  traceRow:     { display: 'flex', gap: '12px', alignItems: 'flex-start' },
  dot:          { width: '10px', height: '10px', borderRadius: '50%', marginTop: '4px', flexShrink: 0 },
  traceBody:    { flex: 1 },
  traceHeader:  { display: 'flex', alignItems: 'center', gap: '8px' },
  traceType:    { fontSize: '12px', color: '#194C85', background: '#EBF1F8',
                  padding: '1px 6px', borderRadius: '3px', fontFamily: 'monospace' },
  traceOutcome: { fontSize: '11px', color: '#555' },
  traceTime:    { fontSize: '11px', color: '#aaa', marginLeft: 'auto' },
  traceReasoning: { fontSize: '12px', color: '#555', lineHeight: '1.5', marginTop: '4px', whiteSpace: 'pre-wrap' },
  traceMeta:    { fontSize: '11px', color: '#777', fontFamily: 'monospace', whiteSpace: 'pre-wrap',
                  margin: '4px 0 0 0', background: '#f3f4f6', padding: '6px 10px', borderRadius: '4px' },
};
