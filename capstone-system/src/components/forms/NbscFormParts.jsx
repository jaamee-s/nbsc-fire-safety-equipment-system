// Shared pieces for NBSC official forms (header, footer, lines, checkboxes).
import './nbscForms.css';
import { NBSC_LOGO_SRC, BAGONG_PILIPINAS_SRC } from './formFormat';

/** Underlined fill-in blank. */
export function Line({ value, style, className = '' }) {
  return (
    <span className={`nbsc-line ${className}`} style={style}>
      {value ?? ''}
    </span>
  );
}

/** Square checkbox with label. */
export function Check({ checked, label }) {
  return (
    <span className="nbsc-check">
      <span className="nbsc-check__box" aria-checked={!!checked} role="checkbox">
        {checked ? '✓' : ''}
      </span>
      <span>{label}</span>
    </span>
  );
}

/** Signature line with caption underneath. */
export function SignLine({ name, caption, style }) {
  return (
    <span className="nbsc-sign" style={style}>
      <span className="nbsc-sign__line">
        <span className="nbsc-filled">{name || ''}</span>
      </span>
      {caption && <span className="nbsc-sign__caption">{caption}</span>}
    </span>
  );
}

/** Top header with logo, college name, and the Document Code box. */
export function NbscFormHeader({ docCode, issueStatus, revNo, effectiveDate, pageNo = '1 of 1' }) {
  return (
    <>
      <div className="nbsc-header">
        <img className="nbsc-header__logo" src={NBSC_LOGO_SRC} alt="NBSC logo" />
        <div className="nbsc-header__text">
          <div className="nbsc-header__republic">Republic of the Philippines</div>
          <div className="nbsc-header__college">NORTHERN BUKIDNON STATE COLLEGE</div>
          <div className="nbsc-header__address">Manolo Fortich, 8703 Bukidnon</div>
          <div className="nbsc-header__motto">
            Creando Futura, Transformationis Vitae, Ductae a Deo
          </div>
        </div>
        <div className="nbsc-doccode">
          <div className="nbsc-doccode__title">Document Code Number</div>
          <div className="nbsc-doccode__code">{docCode}</div>
          <div className="nbsc-doccode__grid">
            <div className="lbl">Issue Status</div>
            <div className="lbl">Rev No.</div>
            <div className="lbl">Effective Date</div>
            <div className="lbl">Page No.</div>
            <div className="val">{issueStatus}</div>
            <div className="val">{revNo}</div>
            <div className="val">{effectiveDate}</div>
            <div className="val">{pageNo}</div>
          </div>
        </div>
      </div>
      <div className="nbsc-rule" />
    </>
  );
}

/** Bottom footer: Bagong Pilipinas logo, Facebook page, website. */
export function NbscFormFooter() {
  return (
    <div className="nbsc-footer">
      <div className="nbsc-footer__rule" />
      <div className="nbsc-footer__row">
        <img className="nbsc-footer__bp" src={BAGONG_PILIPINAS_SRC} alt="Bagong Pilipinas" />
        <span className="nbsc-footer__item">
          <svg className="nbsc-footer__icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="#1877F2" />
            <path
              d="M13.4 19v-6.2h2.1l.3-2.4h-2.4V8.9c0-.7.2-1.2 1.2-1.2h1.3V5.6c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.8H8.7v2.4h2.1V19h2.6z"
              fill="#fff"
            />
          </svg>
          NorthernBukidnonStateCollegeOfficial
        </span>
        <span className="nbsc-footer__item">
          <svg className="nbsc-footer__icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="5" width="20" height="14" rx="1" fill="none" stroke="#5b7fc4" strokeWidth="1.6" />
            <path d="M2.5 5.5 12 13l9.5-7.5" fill="none" stroke="#5b7fc4" strokeWidth="1.6" />
          </svg>
          www.nbsc.edu.ph
        </span>
      </div>
    </div>
  );
}
