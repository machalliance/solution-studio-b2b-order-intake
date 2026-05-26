import { useState, useEffect, useCallback } from 'react';

export default function HumanReview({ onSelectOrder }) {
  const [orders,       setOrders]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [modal,        setModal]        = useState(null);  // EDI clarify/reject preview modal
  const [rejectModal,  setRejectModal]  = useState(null); // { order } - formal vs silent choice

  const fetchQueue = useCallback(async () => {
    const res  = await fetch('/api/orders/review/queue');
    const data = await res.json();
    setOrders(data.orders || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  async function submitAction(orderId, action, notes = '', formalReject = false) {
    await fetch(`/api/orders/${orderId}/review`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, notes, formalReject }),
    });
    setModal(null);
    setRejectModal(null);
    fetchQueue();
  }

  async function handleAction(order, action) {
    if (action === 'approve') {
      await submitAction(order.order_id, 'approve');
      return;
    }

    if (action === 'reject') {
      // Always show the reject modal so the operator consciously chooses
      // between a formal 855 (EDI trading partners) and a silent reject
      setRejectModal({ order });
      return;
    }

    if (action === 'clarify') {
      if (order.channel === 'email') {
        await submitAction(order.order_id, 'clarify');
        return;
      }
      // EDI clarify: show 864 preview modal
      setModal({ order, action: 'clarify', preview: null, notes: '', rawOpen: false, loading: true });
      try {
        const res  = await fetch(`/api/orders/${order.order_id}/edi-preview?action=clarify`);
        const data = await res.json();
        setModal(m => ({ ...m, preview: data, loading: false }));
      } catch (err) {
        setModal(m => ({ ...m, preview: { error: err.message }, loading: false }));
      }
    }
  }

  return (
    <div>
      <h2 style={s.heading}>Human Review Queue ({orders.length})</h2>
      {loading && <p style={s.empty}>Loading queue...</p>}
      {!loading && orders.length === 0 && (
        <p style={s.empty}>Queue is empty - no orders awaiting review.</p>
      )}
      {orders.map(o => (
        <div key={o.order_id} style={s.card}>
          <div style={s.cardHeader}>
            <div>
              <span style={s.poNum}>{o.po_number || o.order_id.slice(0, 8)}</span>
              <span style={s.channelBadge}>{o.channel?.toUpperCase()}</span>
            </div>
            <span style={s.meta}>{o.content_type} . {new Date(o.created_at).toLocaleString()}</span>
          </div>
          <p style={s.reason}>{o.routing_reason}</p>
          <div style={s.actions}>
            <button onClick={() => onSelectOrder(o.order_id)} style={s.btnSecondary}>View Detail</button>
            <button onClick={() => handleAction(o, 'approve')} style={s.btnApprove}>Approve -> ERP</button>
            <button onClick={() => handleAction(o, 'clarify')} style={s.btnClarify}>Send Clarification</button>
            <button onClick={() => handleAction(o, 'reject')}  style={s.btnReject}>Reject</button>
          </div>
        </div>
      ))}

      {modal && (
        <EdiPreviewModal
          modal={modal}
          onNotesChange={notes => setModal(m => ({ ...m, notes }))}
          onRawToggle={() => setModal(m => ({ ...m, rawOpen: !m.rawOpen }))}
          onConfirm={() => submitAction(modal.order.order_id, modal.action, modal.notes)}
          onCancel={() => setModal(null)}
        />
      )}

      {rejectModal && (
        <RejectModal
          order={rejectModal.order}
          onFormal={() => submitAction(rejectModal.order.order_id, 'reject', '', true)}
          onSilent={() => submitAction(rejectModal.order.order_id, 'reject', '', false)}
          onCancel={() => setRejectModal(null)}
        />
      )}
    </div>
  );
}

function RejectModal({ order, onFormal, onSilent, onCancel }) {
  const isEdi = order.channel === 'edi';
  return (
    <div style={s.overlay}>
      <div style={{ ...s.modalBox, maxWidth: '420px' }}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>Reject Order</span>
          <span style={s.modalPo}>{order.po_number || order.order_id.slice(0, 8)}</span>
        </div>
        <div style={{ ...s.modalBody, fontSize: '14px', color: '#374151', lineHeight: '1.6' }}>
          {isEdi ? (
            <>
              <p style={{ margin: '0 0 12px' }}>
                How should the trading partner be notified?
              </p>
              <p style={{ margin: '0 0 6px', fontSize: '13px', color: '#555' }}>
                <strong>Send 855 Rejection</strong> - sends a formal X12 855 Purchase Order
                Acknowledgement (BAK02=RJ) to the trading partner's outbound queue.
              </p>
              <p style={{ margin: '0', fontSize: '13px', color: '#555' }}>
                <strong>Silent reject</strong> - no outbound message. Use for unknown senders
                or cases where notifying the sender is not appropriate.
              </p>
            </>
          ) : (
            <p style={{ margin: 0 }}>
              The order will be silently rejected - no notification will be sent to the sender.
            </p>
          )}
        </div>
        <div style={s.modalFooter}>
          <button onClick={onCancel} style={s.btnCancel}>Cancel</button>
          {isEdi && (
            <button onClick={onFormal} style={s.btnReject}>Send 855 Rejection</button>
          )}
          <button onClick={onSilent} style={{ ...s.btnReject, background: '#6b7280' }}>
            Silent Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function EdiPreviewModal({ modal, onNotesChange, onRawToggle, onConfirm, onCancel }) {
  const { order, action, preview, notes, rawOpen, loading } = modal;
  const isClarify = action === 'clarify';
  const title     = isClarify ? 'Send Clarification (864 Text Message)' : 'Reject Order (855 PO Acknowledgement)';

  return (
    <div style={s.overlay}>
      <div style={s.modalBox}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>{title}</span>
          <span style={s.modalPo}>{order.po_number || order.order_id.slice(0, 8)}</span>
        </div>

        {loading && <div style={s.modalBody}>Generating preview...</div>}

        {!loading && preview?.error && (
          <div style={{ ...s.modalBody, color: '#C62828' }}>Error: {preview.error}</div>
        )}

        {!loading && preview && !preview.error && (
          <div style={s.modalBody}>

            <div style={s.previewLabel}>Message to trading partner</div>
            <div style={s.messageBox}>
              {preview.messageLines?.map((l, i) => <div key={i}>{l}</div>)}
            </div>

            {isClarify && (
              <>
                <div style={s.previewLabel}>Additional notes (optional)</div>
                <textarea
                  value={notes}
                  onChange={e => onNotesChange(e.target.value)}
                  placeholder="Add any operator notes to include in the message..."
                  style={s.notesInput}
                  rows={3}
                />
              </>
            )}

            <div style={s.rawToggleRow} onClick={onRawToggle}>
              <span style={s.rawToggleLabel}>
                {rawOpen ? '^' : 'v'} Original inbound EDI
              </span>
            </div>
            {rawOpen && (
              <pre style={s.rawEdi}>{preview.rawEdi}</pre>
            )}

            <div style={s.previewLabel}>Outbound EDI ({isClarify ? '864' : '855'})</div>
            <pre style={s.ediPreview}>{injectNotesIntoEdi(preview.ediContent, notes)}</pre>
          </div>
        )}

        <div style={s.modalFooter}>
          <button onClick={onCancel} style={s.btnCancel}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading || !!preview?.error}
            style={isClarify ? s.btnClarify : s.btnReject}
          >
            {isClarify ? 'Send 864 Clarification' : 'Send 855 Rejection'}
          </button>
        </div>
      </div>
    </div>
  );
}

function injectNotesIntoEdi(ediContent, notes) {
  if (!notes?.trim() || !ediContent) return ediContent;
  const noteLine   = `NTE**Additional notes: ${notes.replace(/[~*]/g, ' ')}`;
  const lastNteIdx = ediContent.lastIndexOf('\nNTE**');
  if (lastNteIdx === -1) return ediContent.replace(/\nSE\*/, `\n${noteLine}~\nSE*`);
  return ediContent.slice(0, lastNteIdx) + `\n${noteLine}~` + ediContent.slice(lastNteIdx);
}

const s = {
  heading:      { fontSize: '20px', fontWeight: 600, color: '#0B1F33', marginBottom: '16px' },
  empty:        { color: '#999', fontStyle: 'italic' },

  card:         { background: 'white', borderRadius: '8px', padding: '16px 20px',
                  marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  borderLeft: '4px solid #1565C0' },
  cardHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: '8px' },
  poNum:        { fontWeight: 600, color: '#0B1F33', marginRight: '8px' },
  channelBadge: { fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '3px',
                  background: '#ede9fe', color: '#5b21b6' },
  meta:         { color: '#999', fontSize: '12px' },
  reason:       { color: '#555', fontSize: '13px', margin: '0 0 12px' },
  actions:      { display: 'flex', gap: '8px', flexWrap: 'wrap' },

  btnSecondary: { background: '#f0f3f7', border: 'none', padding: '6px 14px',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  btnApprove:   { background: '#2E7D32', color: 'white', border: 'none', padding: '6px 14px',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  btnClarify:   { background: '#E65100', color: 'white', border: 'none', padding: '6px 14px',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  btnReject:    { background: '#C62828', color: 'white', border: 'none', padding: '6px 14px',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  btnCancel:    { background: '#f0f3f7', border: 'none', padding: '6px 18px',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },

  overlay:      { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modalBox:     { background: 'white', borderRadius: '10px', width: '680px', maxWidth: '95vw',
                  maxHeight: '88vh', display: 'flex', flexDirection: 'column',
                  boxShadow: '0 8px 40px rgba(0,0,0,0.25)' },
  modalHeader:  { padding: '16px 20px', borderBottom: '1px solid #e8eef4',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle:   { fontWeight: 600, fontSize: '15px', color: '#0B1F33' },
  modalPo:      { fontFamily: 'monospace', fontSize: '13px', color: '#194C85',
                  background: '#EBF1F8', padding: '2px 8px', borderRadius: '3px' },
  modalBody:    { padding: '20px', overflowY: 'auto', flex: 1 },
  modalFooter:  { padding: '14px 20px', borderTop: '1px solid #e8eef4',
                  display: 'flex', justifyContent: 'flex-end', gap: '10px' },

  previewLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#888', marginBottom: '6px', marginTop: '14px' },
  messageBox:   { background: '#f8fafc', border: '1px solid #e0e7ef', borderRadius: '5px',
                  padding: '12px 14px', fontSize: '13px', color: '#1a202c', lineHeight: '1.7' },
  notesInput:   { width: '100%', padding: '8px 10px', border: '1px solid #cdd5e0',
                  borderRadius: '4px', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' },
  rawToggleRow: { display: 'flex', alignItems: 'center', cursor: 'pointer',
                  padding: '8px 0', marginTop: '10px' },
  rawToggleLabel:{ fontSize: '12px', color: '#555', fontWeight: 500 },
  rawEdi:       { background: '#1e2a3a', color: '#d4e0ef', padding: '12px 14px',
                  borderRadius: '5px', fontSize: '11px', fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', margin: '6px 0 0' },
  ediPreview:   { background: '#f3f4f6', color: '#374151', padding: '12px 14px',
                  borderRadius: '5px', fontSize: '11px', fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto',
                  margin: '6px 0 0', border: '1px solid #e0e7ef' },
};
