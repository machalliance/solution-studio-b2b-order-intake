import { useState, useCallback, useRef, useEffect } from 'react';
import LiveFeed        from './views/LiveFeed.jsx';
import OrderDetail     from './views/OrderDetail.jsx';
import HumanReview     from './views/HumanReview.jsx';
import SubmittedOrders from './views/SubmittedOrders.jsx';
import AuditLog        from './views/AuditLog.jsx';
import TestCorpus      from './views/TestCorpus.jsx';

const NAV = [
  { id: 'feed',      label: 'Live Feed' },
  { id: 'review',    label: 'Human Review' },
  { id: 'submitted', label: 'Submitted Orders' },
  { id: 'audit',     label: 'Audit Log' },
  { id: 'corpus',    label: 'Test Corpus' },
];

const HEALTH_LABELS = {
  pipeline:    'Pipeline',
  db:          'Database',
  inboundMail: 'Email',   // label overridden by response data (Mailpit / SendGrid)
  erp:         'ERP',
};

function HealthPopover({ onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(null);

  useEffect(() => {
    fetch('/api/health/all')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} style={styles.popover}>
      <div style={styles.popoverTitle}>Service Health</div>
      {loading && <div style={styles.popoverRow}>Checking...</div>}
      {!loading && !data && <div style={{ ...styles.popoverRow, color: '#e05c5c' }}>Failed to reach pipeline</div>}
      {!loading && data && Object.entries(HEALTH_LABELS).map(([key, fallbackLabel]) => {
        const svc = data[key];
        const label = svc?.label || fallbackLabel;
        return (
          <div key={key} style={styles.popoverRow}>
            <span style={{ ...styles.dot, background: svc?.ok ? '#3cb371' : '#e05c5c' }} />
            <span style={styles.popoverSvc}>{label}</span>
            {svc && !svc.ok && (svc.error || svc.note) &&
              <span style={styles.popoverErr}>{svc.error || svc.note}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [view,            setView]            = useState('feed');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [returnView,      setReturnView]      = useState('feed');
  const [clearing,        setClearing]        = useState(false);
  const [healthOpen,      setHealthOpen]      = useState(false);
  const [mailpitUrl,         setMailpitUrl]         = useState('');
  const [liveFeedLimit,      setLiveFeedLimit]      = useState(100);
  const [inboundMailProvider, setInboundMailProvider] = useState('mailpit');

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(d => {
        // Build Mailpit URL from the browser's current hostname + the configured port.
        // Using window.location.hostname means the link works whether the UI is accessed
        // via localhost, a VM IP, or a remote host - no hardcoded address needed.
        if (d.mailpitPort) setMailpitUrl(`http://${window.location.hostname}:${d.mailpitPort}`);
        if (d.liveFeedLimit) setLiveFeedLimit(d.liveFeedLimit);
        if (d.inboundMailProvider) setInboundMailProvider(d.inboundMailProvider);
      })
      .catch(() => {});
  }, []);

  const clearTestData = useCallback(async () => {
    if (!window.confirm('Delete all orders, line items, audit log, and ERP submissions?\n\nThis cannot be undone.')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/test/clear', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      setView('feed');
    } catch (err) {
      alert(`Clear failed: ${err.message}`);
    } finally {
      setClearing(false);
    }
  }, []);

  function openOrder(orderId) {
    setReturnView(view);
    setSelectedOrderId(orderId);
    setView('detail');
  }

  function back() {
    setSelectedOrderId(null);
    setView(returnView);
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <span style={styles.title}>B2B Order Intake - Agent Control Interface</span>
        <div style={styles.headerRight}>
          <nav style={styles.nav}>
            {NAV.map(n => (
              <button key={n.id} onClick={() => setView(n.id)}
                style={{ ...styles.navBtn, ...(view === n.id ? styles.navBtnActive : {}) }}>
                {n.label}
              </button>
            ))}
          </nav>

          <div style={styles.divider} />

          {mailpitUrl && (
            <a href={mailpitUrl} target="_blank" rel="noopener noreferrer" style={styles.toolBtn}>
              Mail
            </a>
          )}

          <div style={{ position: 'relative' }}>
            <button onClick={() => setHealthOpen(o => !o)} style={styles.toolBtn}>
              Health
            </button>
            {healthOpen && <HealthPopover onClose={() => setHealthOpen(false)} />}
          </div>

          <button onClick={clearTestData} disabled={clearing} style={styles.clearBtn}>
            {clearing ? 'Clearing...' : 'Clear All Test Data'}
          </button>
        </div>
      </header>

      <main style={styles.main}>
        {view === 'feed'      && <LiveFeed onSelectOrder={openOrder} limit={liveFeedLimit} />}
        {view === 'detail'    && <OrderDetail orderId={selectedOrderId} onBack={back} />}
        {view === 'review'    && <HumanReview onSelectOrder={openOrder} />}
        {view === 'submitted' && <SubmittedOrders />}
        {view === 'audit'     && <AuditLog />}
        {view === 'corpus'    && <TestCorpus />}
      </main>
    </div>
  );
}

const styles = {
  app:          { fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f5f7fa' },
  header:       { background: '#0B1F33', color: 'white', padding: '12px 24px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title:        { fontSize: '16px', fontWeight: 600 },
  headerRight:  { display: 'flex', alignItems: 'center', gap: '10px' },
  nav:          { display: 'flex', gap: '8px' },
  divider:      { width: '1px', height: '22px', background: 'rgba(255,255,255,0.2)', margin: '0 4px' },
  toolBtn:      { background: 'transparent', border: '1px solid rgba(255,255,255,0.4)',
                  color: 'white', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer',
                  fontSize: '13px', textDecoration: 'none', display: 'inline-block', lineHeight: '1.4',
                  outline: 'none' },
  clearBtn:     { background: 'transparent', border: '1px solid #e05c5c', color: '#e05c5c',
                  padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                  outline: 'none' },
  navBtn:       { background: 'transparent', border: '1px solid rgba(255,255,255,0.3)',
                  color: 'white', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer',
                  outline: 'none' },
  navBtnActive: { background: '#194C85', border: '1px solid rgba(255,255,255,0.8)' },
  main:         { padding: '24px', maxWidth: '1400px', margin: '0 auto' },
  popover:      { position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 100,
                  background: 'white', color: '#1a1a2e', border: '1px solid #ddd',
                  borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  minWidth: '220px', padding: '8px 0' },
  popoverTitle: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: '#888', padding: '4px 16px 8px' },
  popoverRow:   { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 16px', fontSize: '13px' },
  dot:          { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  popoverSvc:   { flex: 1 },
  popoverErr:   { fontSize: '11px', color: '#e05c5c', maxWidth: '100px', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
};
