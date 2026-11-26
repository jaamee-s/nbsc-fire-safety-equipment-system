/* =====================================================================
   FormPrintPage.jsx — /forms/jor/:id/print and /forms/pr/:id/print

   Shows one official form in its A4 layout with a "Print / Save as PDF"
   button. Opened in a new tab from the dashboard; it uses the same login.
   ===================================================================== */
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import JobOrderRequestForm from './components/forms/JobOrderRequestForm'
import PurchaseRequestForm from './components/forms/PurchaseRequestForm'
import { formsErrorMessage } from './officialForms'

const pageStyle = { minHeight: '100vh', background: 'var(--gray-bg, #f1f5f9)', padding: '20px 16px 40px' }
const barStyle = {
  maxWidth: '210mm',
  margin: '0 auto 14px',
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-end',
  flexWrap: 'wrap'
}

export default function FormPrintPage({ kind, id }) {
  const [state, setState] = useState({ row: null, items: [], error: null })

  // While this page is open, printing shows only the form (nbscForms.css).
  useEffect(() => {
    document.body.classList.add('nbsc-printing')
    return () => document.body.classList.remove('nbsc-printing')
  }, [])

  useEffect(() => {
    async function load() {
      const table = kind === 'jor' ? 'job_order_requests' : 'purchase_requests'
      const { data, error } = await supabase.from(table).select('*').eq('id', id).single()
      if (error) return setState({ row: null, items: [], error: formsErrorMessage(error) })
      let items = []
      if (kind === 'pr') {
        const res = await supabase
          .from('purchase_request_items')
          .select('*')
          .eq('purchase_request_id', id)
          .order('line_no')
        if (res.error) return setState({ row: null, items: [], error: formsErrorMessage(res.error) })
        items = res.data || []
      }
      document.title = kind === 'jor' ? `Job Order Request ${data.jor_no || ''}`.trim() : `Purchase Request ${data.pr_no || ''}`.trim()
      setState({ row: data, items, error: null })
    }
    load()
  }, [kind, id])

  return (
    <div className="nbsc-print-root" style={pageStyle}>
      <div className="nbsc-no-print" style={barStyle}>
        <a className="btn btn-secondary btn-sm" href="/" style={{ textDecoration: 'none' }}>
          Back to dashboard
        </a>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()} disabled={!state.row}>
          Print / Save as PDF
        </button>
      </div>

      {state.error ? (
        <p className="form-error" style={{ maxWidth: '210mm', margin: '0 auto' }}>
          Could not load the form: {state.error}
        </p>
      ) : !state.row ? (
        <p style={{ maxWidth: '210mm', margin: '0 auto', color: 'var(--text-muted)' }}>Loading...</p>
      ) : kind === 'jor' ? (
        <JobOrderRequestForm data={state.row} />
      ) : (
        <PurchaseRequestForm data={state.row} items={state.items} />
      )}
    </div>
  )
}
