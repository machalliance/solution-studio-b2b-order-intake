import { useState, useEffect, useCallback } from 'react';

const OUTCOME_COLOURS = {
  submit:  '#2E7D32',
  review:  '#1565C0',
  clarify: '#E65100',
  reject:  '#C62828',
};

const STATUS_STYLE = {
  idle:    { color: '#999',  background: '#f5f7fa', border: '1px solid #dde3ec' },
  running: { color: 'white', background: '#1565C0', border: '1px solid #1565C0' },
  done:    { color: 'white', background: '#2E7D32', border: '1px solid #2E7D32' },
  error:   { color: 'white', background: '#C62828', border: '1px solid #C62828' },
};

export default function TestCorpus() {
  const [tests,            setTests]            = useState([]);
  const [statuses,         setStatuses]         = useState({});
  const [errors,           setErrors]           = useState({});
  const [previews,         setPreviews]         = useState({});
  const [loading,          setLoading]          = useState(true);
  const [loadErr,          setLoadErr]          = useState(null);
  const [inboundProvider,  setInboundProvider]  = useState('mailpit');

  useEffect(() => {
    fetch('/api/test/manifest')
      .then(r => r.json())
      .then(d => setTests(d.tests || []))
      .catch(e => setLoadErr(e.message))
      .finally(() => setLoading(false));
    fetch('/api/config')
      .then(r => r.json())
      .then(d => { if (d.inboundMailProvider) setInboundProvider(d.inboundMailProvider); })
      .catch(() => {});
  }, []);

  const runTest = useCallback(async (id) => {
    setStatuses(s => ({ ...s, [id]: 'running' }));
    setErrors(e => { const n = { ...e }; delete n[id]; return n; });
    try {
      const res  = await fetch('/api/test/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      setStatuses(s => ({ ...s, [id]: 'done' }));
    } catch (err) {
      setStatuses(s => ({ ...s, [id]: 'error' }));
      setErrors(e => ({ ...e, [id]: err.message }));
    }
  }, []);

  const togglePreview = useCallback(async (id) => {
    if (previews[id] !== undefined) {
      setPreviews(p => ({ ...p, [id]: undefined }));
      return;
    }

    setPreviews(p => ({ ...p, [id]: { loading: true } }));
    try {
      const res  = await fetch(`/api/test/preview/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setPreviews(p => ({ ...p, [id]: { data } }));
    } catch (err) {
      setPreviews(p => ({ ...p, [id]: { error: err.message } }));
    }
  }, [previews]);

  const runGroup = useCallback(async (groupTests) => {
    for (const t of groupTests) {
      await runTest(t.id);
      await new Promise(r => setTimeout(r, 1200));
    }
  }, [runTest]);

  if (loading) return <p style={styles.empty}>Loading test manifest...</p>;
  if (loadErr)  return <p style={{ ...styles.empty, color: '#C62828' }}>Failed to load manifest: {loadErr}</p>;

  const email = tests.filter(t => t.channel === 'email');
  const edi   = tests.filter(t => t.channel === 'edi');

  return (
    <div>
      <h2 style={styles.heading}>Test Corpus</h2>
      <p style={styles.subtitle}>
        Clear all test data first to reset deduplication, then run tests individually or as a group.
      </p>
      <TestGroup label="Email" tests={email} statuses={statuses} errors={errors}
        previews={previews} onRun={runTest} onRunAll={() => runGroup(email)}
        onTogglePreview={togglePreview}
        note={inboundProvider === 'sendgrid'
          ? 'SendGrid mode: email tests are injected directly into the pipeline graph (SMTP bypassed).'
          : null} />
      <TestGroup label="EDI" tests={edi} statuses={statuses} errors={errors}
        previews={previews} onRun={runTest} onRunAll={() => runGroup(edi)}
        onTogglePreview={togglePreview} />
    </div>
  );
}

function TestGroup({ label, tests, statuses, errors, previews, onRun, onRunAll, onTogglePreview, note }) {
  const anyRunning = tests.some(t => statuses[t.id] === 'running');

  return (
    <div style={styles.group}>
      <div style={styles.groupHeader}>
        <div>
          <span style={styles.groupTitle}>
            {label} <span style={styles.groupCount}>- {tests.length} tests</span>
          </span>
          {note && <div style={styles.groupNote}>{note}</div>}
        </div>
        <button onClick={onRunAll} disabled={anyRunning} style={styles.runAllBtn}>
          {anyRunning ? 'Running...' : `Run all ${label}`}
        </button>
      </div>

      <table style={styles.table}>
        <colgroup>
          <col style={{ width: '28%' }} />
          <col style={{ width: '38%' }} />
          <col style={{ width: '90px' }} />
          <col style={{ width: '72px' }} />
          <col style={{ width: '130px' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={styles.th}>Test</th>
            <th style={styles.th}>What it tests</th>
            <th style={{ ...styles.th, textAlign: 'center' }}>Expected</th>
            <th style={{ ...styles.th, textAlign: 'center' }}>Status</th>
            <th style={{ ...styles.th, textAlign: 'center' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t, i) => {
            const status  = statuses[t.id] || 'idle';
            const err     = errors[t.id];
            const preview = previews[t.id];
            const previewOpen = !!preview;

            return (
              <>
                <tr key={t.id} style={{ ...styles.row, ...(i % 2 === 1 ? styles.rowAlt : {}),
                  ...(previewOpen ? styles.rowExpanded : {}) }}>
                  <td style={styles.td}>
                    <div style={styles.testLabel}>{t.label}</div>
                    <div style={styles.testFile}>{t.file.split('/').pop()}</div>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.testDesc}>{t.description}</div>
                    {err && <div style={styles.errMsg}>{err}</div>}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <span style={{ ...styles.outcomeBadge,
                      background: OUTCOME_COLOURS[t.expected_outcome] || '#999' }}>
                      {t.expected_outcome}
                    </span>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <span style={{ ...styles.statusBadge, ...STATUS_STYLE[status] }}>
                      {status}
                    </span>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <div style={styles.actions}>
                      <button onClick={() => onTogglePreview(t.id)} style={styles.previewBtn}>
                        {previewOpen ? '^ Hide' : 'v Preview'}
                      </button>
                      <button
                        onClick={() => onRun(t.id)}
                        disabled={status === 'running'}
                        style={{ ...styles.runBtn, ...(status === 'running' ? styles.runBtnBusy : {}) }}
                      >
                        {status === 'running' ? '...' : 'Run'}
                      </button>
                    </div>
                  </td>
                </tr>

                {previewOpen && (
                  <tr key={`${t.id}-preview`} style={styles.previewRow}>
                    <td colSpan={5} style={styles.previewCell}>
                      <PreviewPanel preview={preview} filename={t.file.split('/').pop()} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PreviewPanel({ preview, filename }) {
  if (preview.loading) return <div style={styles.previewLoading}>Loading preview...</div>;
  if (preview.error)   return <div style={styles.previewError}>Error: {preview.error}</div>;

  const { data } = preview;
  if (!data) return null;

  if (data.type === 'text') return <TextPreview content={data.content} ext={data.ext} />;
  if (data.type === 'email') return <EmailPreview data={data} />;
  if (data.type === 'table') return <TablePreview data={data} filename={filename} />;
  return <div style={styles.previewLoading}>Unknown preview type: {data.type}</div>;
}

function TextPreview({ content, ext }) {
  return (
    <div>
      <div style={styles.previewLabel}>{ext === '.edi' ? 'X12 EDI' : 'CSV'} - raw content</div>
      <pre style={styles.pre}>{content}</pre>
    </div>
  );
}

function EmailPreview({ data }) {
  return (
    <div>
      <div style={styles.previewLabel}>Email</div>
      <div style={styles.emailMeta}>
        {[['From', data.from], ['To', data.to], ['Subject', data.subject], ['Date', data.date]].map(([l, v]) => (
          <div key={l} style={styles.metaRow}>
            <span style={styles.metaLabel}>{l}</span>
            <span style={styles.metaValue}>{v || '-'}</span>
          </div>
        ))}
      </div>

      {data.body && (
        <>
          <div style={styles.previewLabel}>Body</div>
          <pre style={styles.pre}>{data.body}</pre>
        </>
      )}

      {data.attachments?.length > 0 && data.attachments.map(a => (
        <div key={a.filename} style={styles.attachmentBlock}>
          <div style={styles.attachmentHeader}>
            Attachment: <strong>{a.filename}</strong>
            <span style={styles.attachmentMeta}>
              {a.contentType} . {(a.sizeBytes / 1024).toFixed(1)} KB
              {a.pages != null && ` . ${a.pages} page${a.pages !== 1 ? 's' : ''}`}
            </span>
          </div>
          {a.text && (
            <>
              <div style={styles.previewLabel}>PDF text content</div>
              <pre style={styles.pre}>{a.text}</pre>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function TablePreview({ data, filename }) {
  return (
    <div>
      {data.sheets.map(sheet => (
        <div key={sheet.name}>
          <div style={styles.previewLabel}>
            {filename}{data.sheets.length > 1 ? ` - sheet: ${sheet.name}` : ''}
            <span style={styles.rowCount}>{sheet.rows.length} rows</span>
          </div>
          <div style={styles.tableWrap}>
            <table style={styles.dataTable}>
              <thead>
                <tr>{sheet.headers.map((h, i) => <th key={i} style={styles.dataTh}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {sheet.rows.map((row, i) => (
                  <tr key={i} style={i % 2 === 1 ? { background: '#fafbfd' } : {}}>
                    {row.map((cell, j) => <td key={j} style={styles.dataTd}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  heading:         { fontSize: '20px', fontWeight: 600, color: '#0B1F33', marginBottom: '4px' },
  subtitle:        { color: '#666', fontSize: '13px', marginBottom: '24px' },
  empty:           { color: '#999', fontStyle: 'italic' },

  group:           { background: 'white', borderRadius: '8px', marginBottom: '24px',
                     boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' },
  groupHeader:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                     padding: '12px 20px', background: '#0B1F33' },
  groupTitle:      { fontSize: '14px', fontWeight: 600, color: 'white' },
  groupCount:      { fontWeight: 400, opacity: 0.6 },
  groupNote:       { fontSize: '12px', fontWeight: 600, color: '#7dd3fc', marginTop: '4px' },
  runAllBtn:       { background: 'transparent', border: '1px solid rgba(255,255,255,0.45)',
                     color: 'white', padding: '5px 14px', borderRadius: '4px',
                     cursor: 'pointer', fontSize: '12px' },

  table:           { width: '100%', borderCollapse: 'collapse' },
  th:              { padding: '8px 14px', fontSize: '11px', fontWeight: 700, color: '#555',
                     textTransform: 'uppercase', letterSpacing: '0.04em',
                     borderBottom: '2px solid #e8eef4', background: '#f8fafc', textAlign: 'left' },
  row:             { borderBottom: '1px solid #f0f3f7' },
  rowAlt:          { background: '#fafbfd' },
  rowExpanded:     { background: '#EBF1F8' },
  td:              { padding: '10px 14px', verticalAlign: 'middle' },

  testLabel:       { fontSize: '13px', fontWeight: 600, color: '#0B1F33', marginBottom: '2px' },
  testFile:        { fontSize: '11px', color: '#aaa', fontFamily: 'monospace' },
  testDesc:        { fontSize: '13px', color: '#444', lineHeight: '1.4' },
  errMsg:          { fontSize: '11px', color: '#C62828', marginTop: '3px' },

  outcomeBadge:    { display: 'inline-block', fontSize: '11px', fontWeight: 700, color: 'white',
                     padding: '2px 9px', borderRadius: '10px', textTransform: 'uppercase' },
  statusBadge:     { display: 'inline-block', fontSize: '11px', padding: '2px 8px',
                     borderRadius: '3px', minWidth: '52px', textAlign: 'center' },

  actions:         { display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' },
  previewBtn:      { background: 'transparent', border: '1px solid #cdd5e0', color: '#555',
                     padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  runBtn:          { background: '#194C85', color: 'white', border: 'none',
                     padding: '5px 14px', borderRadius: '4px', cursor: 'pointer',
                     fontSize: '13px', fontWeight: 500 },
  runBtnBusy:      { background: '#ccc', cursor: 'not-allowed' },

  previewRow:      { background: '#f0f4fa' },
  previewCell:     { padding: '16px 20px', borderBottom: '2px solid #dde6f0' },
  previewLoading:  { color: '#888', fontStyle: 'italic', fontSize: '13px' },
  previewError:    { color: '#C62828', fontSize: '13px' },
  previewLabel:    { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                     letterSpacing: '0.05em', color: '#888', marginBottom: '6px',
                     marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' },
  rowCount:        { fontWeight: 400, color: '#aaa', textTransform: 'none', letterSpacing: 0 },

  pre:             { background: '#1e2a3a', color: '#d4e0ef', padding: '14px 16px',
                     borderRadius: '5px', fontSize: '12px', fontFamily: 'monospace',
                     whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                     maxHeight: '380px', overflowY: 'auto', margin: 0 },

  emailMeta:       { background: 'white', border: '1px solid #e0e7ef', borderRadius: '5px',
                     padding: '10px 14px', marginBottom: '4px' },
  metaRow:         { display: 'flex', gap: '12px', padding: '3px 0',
                     borderBottom: '1px solid #f5f7fa', fontSize: '13px' },
  metaLabel:       { width: '64px', color: '#888', flexShrink: 0, fontWeight: 600 },
  metaValue:       { color: '#222', wordBreak: 'break-all' },

  attachmentBlock: { border: '1px solid #dde6f0', borderRadius: '5px',
                     padding: '10px 14px', marginTop: '10px', background: 'white' },
  attachmentHeader:{ fontSize: '13px', color: '#333', marginBottom: '4px' },
  attachmentMeta:  { marginLeft: '10px', color: '#888', fontSize: '11px' },

  tableWrap:       { overflowX: 'auto', borderRadius: '5px',
                     border: '1px solid #e0e7ef', maxHeight: '360px', overflowY: 'auto' },
  dataTable:       { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  dataTh:          { background: '#f0f4fa', padding: '6px 12px', fontWeight: 600,
                     textAlign: 'left', borderBottom: '2px solid #dde6f0',
                     whiteSpace: 'nowrap', position: 'sticky', top: 0 },
  dataTd:          { padding: '5px 12px', borderBottom: '1px solid #f0f3f7', color: '#333' },
};
