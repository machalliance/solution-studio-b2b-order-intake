import { useState, useEffect } from 'react';

const POLL_MS = 5000;

const OUTCOME_COLOURS = {
  clarify: '#E65100', reject: '#C62828',
  review:  '#1565C0', submit: '#2E7D32',
  null:    '#666',
};

export default function LiveFeed({ onSelectOrder, limit = 100 }) {
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);

  async function fetchOrders() {
    try {
      const res  = await fetch(`/api/orders?limit=${limit}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err) {
      console.error('LiveFeed fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, POLL_MS);
    return () => clearInterval(interval);
  }, [limit]);

  if (loading) return <p>Loading orders...</p>;

  return (
    <div>
      <h2 style={styles.heading}>Live Order Feed</h2>
      {orders.length === 0 && <p style={styles.empty}>No orders yet. Drop a file in edi-inbox/ or send an email via Mailpit.</p>}
      <table style={styles.table}>
        <thead>
          <tr>
            {['Order ID','Channel','Type','PO Number','Confidence','Outcome','Received'].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.order_id} style={styles.row} onClick={() => onSelectOrder(o.order_id)}>
              <td style={styles.td}><code style={styles.code}>{o.order_id.slice(0,8)}...</code></td>
              <td style={styles.td}>{o.channel}</td>
              <td style={styles.td}>{o.content_type}</td>
              <td style={styles.td}>{o.po_number || '-'}</td>
              <td style={styles.td}>{o.confidence_score != null ? `${o.confidence_score}%` : '-'}</td>
              <td style={styles.td}>
                <span style={{ ...styles.badge, background: OUTCOME_COLOURS[o.routing_outcome] || '#666' }}>
                  {o.routing_outcome || o.status}
                </span>
              </td>
              <td style={styles.td}>{new Date(o.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  heading: { fontSize: '20px', fontWeight: 600, marginBottom: '16px', color: '#0B1F33' },
  empty:   { color: '#666', fontStyle: 'italic' },
  table:   { width: '100%', borderCollapse: 'collapse', background: 'white',
             borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  th:      { background: '#0B1F33', color: 'white', padding: '10px 14px',
             textAlign: 'left', fontSize: '12px', textTransform: 'uppercase' },
  row:     { cursor: 'pointer', borderBottom: '1px solid #e8eef4' },
  td:      { padding: '10px 14px', fontSize: '13px', color: '#333' },
  badge:   { color: 'white', padding: '2px 8px', borderRadius: '12px',
             fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' },
  code:    { fontFamily: 'monospace', fontSize: '12px', color: '#194C85' },
};
