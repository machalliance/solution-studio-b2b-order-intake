import { useState, useEffect } from 'react';
import { Section, KVTable, shared } from '../components/OrderView.jsx';

export default function SubmittedOrders() {
  const [orders,   setOrders]   = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch('/api/erp/orders')
      .then(r => r.json())
      .then(d => setOrders(d.submissions || []));
  }, []);

  const companyName = o => o.company_name || o.buyer_company || '-';

  return (
    <div>
      <h2 style={s.heading}>Submitted Orders ({orders.length})</h2>
      {orders.length === 0 && <p style={s.empty}>No orders submitted to ERP yet.</p>}
      <table style={s.table}>
        <thead>
          <tr>{['ERP Order ID','PO Number','Company','Submitted At',''].map(h =>
            <th key={h} style={s.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.erp_order_id} style={s.row}>
              <td style={s.td}><code style={s.code}>{o.erp_order_id}</code></td>
              <td style={s.td}>{o.po_number || '-'}</td>
              <td style={s.td}>{companyName(o)}</td>
              <td style={s.td}>{new Date(o.submitted_at).toLocaleString()}</td>
              <td style={s.td}>
                <button
                  onClick={() => setSelected(selected?.erp_order_id === o.erp_order_id ? null : o)}
                  style={s.btnView}>
                  {selected?.erp_order_id === o.erp_order_id ? 'Hide' : 'View'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && <ERPDetail order={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ERPDetail({ order, onClose }) {
  const p     = order.payload || {};
  const buyer = p.buyer       || {};
  const lines = p.lineItems   || [];
  const fmtAddr = a => a ? [a.street, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ') : null;

  return (
    <div style={s.detail}>
      <div style={s.detailHeader}>
        <strong>ERP Submission - {p.poNumber || order.erp_order_id}</strong>
        <button onClick={onClose} style={s.closeBtn}>x</button>
      </div>

      <Section title="Order">
        <KVTable rows={[
          ['PO Number',     p.poNumber                  || '-'],
          ['Order Date',    p.orderDate                 || '-'],
          ['Delivery Date', p.requestedDeliveryDate     || '-'],
          ['Currency',      p.currency                  || '-'],
          ['Ship To',       fmtAddr(p.shippingAddress)  || '-'],
        ]} />
      </Section>

      <Section title="Buyer">
        <KVTable rows={[
          ['Company',    buyer.companyName || '-'],
          ['Email',      buyer.email       || '-'],
          ['Phone',      buyer.phone       || '-'],
          ['Account ID', buyer.accountId   || '-'],
        ]} />
      </Section>

      {lines.length > 0 && (
        <Section title="Line Items">
          <table style={shared.lineTable}>
            <thead>
              <tr>{['Line','Buyer SKU','Resolved SKU','Description','Qty','UOM','Unit Price','Total','Backorder'].map(h =>
                <th key={h} style={shared.lineTh}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.lineNumber} style={shared.lineRow}>
                  <td style={shared.lineTd}>{l.lineNumber}</td>
                  <td style={shared.lineTd}><code style={shared.lineCode}>{l.buyerSku}</code></td>
                  <td style={shared.lineTd}><code style={{ ...shared.lineCode, color: '#2E7D32', background: '#d1fae5' }}>{l.resolvedSkuId || '-'}</code></td>
                  <td style={shared.lineTd}>{l.productDescription || '-'}</td>
                  <td style={shared.lineTd}>{l.quantity}</td>
                  <td style={shared.lineTd}>{l.unitOfMeasure || '-'}</td>
                  <td style={shared.lineTd}>{l.unitPrice != null ? `$${l.unitPrice}` : '-'}</td>
                  <td style={shared.lineTd}>{l.unitPrice && l.quantity ? `$${(l.unitPrice * l.quantity).toFixed(2)}` : '-'}</td>
                  <td style={shared.lineTd}>{l.backorder ? `Yes${l.backorderEta ? ` (${l.backorderEta})` : ''}` : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

const s = {
  heading:      { fontSize: '20px', fontWeight: 600, color: '#0B1F33', marginBottom: '16px' },
  empty:        { color: '#999', fontStyle: 'italic' },
  table:        { width: '100%', borderCollapse: 'collapse', background: 'white',
                  borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  th:           { background: '#0B1F33', color: 'white', padding: '10px 14px',
                  textAlign: 'left', fontSize: '12px', textTransform: 'uppercase' },
  row:          { borderBottom: '1px solid #e8eef4' },
  td:           { padding: '10px 14px', fontSize: '13px' },
  code:         { fontFamily: 'monospace', fontSize: '12px', color: '#194C85' },
  btnView:      { background: '#194C85', color: 'white', border: 'none', padding: '4px 10px',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  detail:       { marginTop: '20px' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: '12px', fontSize: '14px', fontWeight: 600, color: '#0B1F33' },
  closeBtn:     { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#666' },
};
