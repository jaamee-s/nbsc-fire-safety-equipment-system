// Formatters and image paths shared by the NBSC official forms.

// Put the official image files in /public/forms/ (see the forms note in the README).
export const NBSC_LOGO_SRC = '/forms/nbsc-logo.png';
export const BAGONG_PILIPINAS_SRC = '/forms/bagong-pilipinas.png';

/** "2026-11-26" or Date -> "11/26/2026". Date-only strings are parsed without timezone shift. */
export function fmtDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${m}/${d}/${y}`;
  }
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

/** Date + time, for "Date/Time Completed". */
export function fmtDateTime(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const pesoFmt = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 1234.5 -> "1,234.50"; blank for null/undefined/empty. */
export function fmtMoney(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? pesoFmt.format(n) : '';
}
