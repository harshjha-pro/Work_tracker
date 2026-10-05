import { useEffect, useState, type ReactNode } from 'react';
import type { Task, TaskStatus, User } from '../lib/types';
import { STATUS_LABEL } from '../lib/master';
import { isOverdue } from '../lib/compliance';
import { cx } from '../lib/util';
import { useApp } from '../store';

// ---------- icons (inline, stroke-based) ----------
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icon = {
  home: () => (<svg viewBox="0 0 24 24" {...P}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></svg>),
  work: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  tasks: () => (<svg viewBox="0 0 24 24" {...P}><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17" /></svg>),
  calendar: () => (<svg viewBox="0 0 24 24" {...P}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>),
  more: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg>),
  clients: () => (<svg viewBox="0 0 24 24" {...P}><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M16 9h2a2 2 0 0 1 2 2v10" /><path d="M8 7h4M8 11h4M8 15h4M3 21h18" /></svg>),
  engagements: () => (<svg viewBox="0 0 24 24" {...P}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></svg>),
  team: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2c2.8.3 5 2.7 5 5.8" /></svg>),
  master: () => (<svg viewBox="0 0 24 24" {...P}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M8 14h3M8 17h6" /></svg>),
  settings: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>),
  audit: () => (<svg viewBox="0 0 24 24" {...P}><path d="M12 8v4l2.5 2.5" /><path d="M3.05 11a9 9 0 1 1 .5 4" /><path d="M3 4v5h5" /></svg>),
  templates: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 6h5a3 3 0 0 1 3 3v0a3 3 0 0 0 2 2.8M7 18h5a3 3 0 0 0 3-3v0a3 3 0 0 1 2-2.8" /></svg>),
  plus: () => (<svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>),
  back: () => (<svg viewBox="0 0 24 24" {...P}><path d="m15 18-6-6 6-6" /></svg>),
  chevron: () => (<svg viewBox="0 0 24 24" {...P}><path d="m9 18 6-6-6-6" /></svg>),
  left: () => (<svg viewBox="0 0 24 24" {...P}><path d="m15 18-6-6 6-6" /></svg>),
  right: () => (<svg viewBox="0 0 24 24" {...P}><path d="m9 18 6-6-6-6" /></svg>),
  close: () => (<svg viewBox="0 0 24 24" {...P}><path d="M18 6 6 18M6 6l12 12" /></svg>),
  lock: () => (<svg viewBox="0 0 24 24" {...P}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>),
  unlock: () => (<svg viewBox="0 0 24 24" {...P}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></svg>),
  copy: () => (<svg viewBox="0 0 24 24" {...P}><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>),
  edit: () => (<svg viewBox="0 0 24 24" {...P}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>),
  trash: () => (<svg viewBox="0 0 24 24" {...P}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>),
  hourglass: () => (<svg viewBox="0 0 24 24" {...P}><path d="M6 2h12M6 22h12M7 2c0 5 10 6 10 10S7 17 7 22M17 2c0 5-10 6-10 10s10 5 10 10" /></svg>),
  check: () => (<svg viewBox="0 0 24 24" {...P}><path d="M20 6 9 17l-5-5" /></svg>),
  switch: () => (<svg viewBox="0 0 24 24" {...P}><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7" /></svg>),
  inbox: () => (<svg viewBox="0 0 24 24" {...P}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13L22 12v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7z" /></svg>),
};

export function Avatar({ user, size }: { user?: User; size?: 'sm' }) {
  const initials = user ? user.name.replace(/^(CA|Dr\.) /, '').split(' ').map((p) => p[0]).slice(0, 2).join('') : '?';
  return <span className={cx('avatar', size)}>{initials}</span>;
}

export function statusTone(status: TaskStatus, overdue: boolean): string {
  if (overdue) return 'bad';
  switch (status) {
    case 'filed':
      return 'ok';
    case 'filed_late':
      return 'warn';
    case 'pending_from_client':
      return 'warn';
    case 'under_review':
      return 'review';
    case 'in_progress':
      return 'info';
    default:
      return '';
  }
}

export function StatusPill({ task }: { task: Pick<Task, 'status' | 'effectiveDue'> }) {
  const overdue = isOverdue(task);
  return (
    <span className={cx('pill', statusTone(task.status, overdue))}>
      {STATUS_LABEL[task.status]}
      {overdue ? ' · Overdue' : ''}
    </span>
  );
}

export function Pill({ tone, children, plain }: { tone?: string; children: ReactNode; plain?: boolean }) {
  return <span className={cx('pill', tone, plain && 'plain')}>{children}</span>;
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
  narrow,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  narrow?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('sheet', narrow && 'narrow')} role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h2 className="grow">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon.close />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** In-page confirmation (no window.confirm). */
export function Confirm({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      narrow
      footer={
        <>
          <button className="btn grow" onClick={onClose}>
            Cancel
          </button>
          <button
            className={cx('btn grow', danger ? 'danger' : 'primary')}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="muted">{body}</div>
    </Sheet>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, block }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; block?: boolean }) {
  return (
    <div className={cx('seg', block && 'block')} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx(value === o.value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Icon.inbox />}
      <div>{children}</div>
    </div>
  );
}

export function Toast() {
  const toast = useApp((s) => s.toast);
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    setVisible(toast.id);
    const t = setTimeout(() => setVisible(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || visible !== toast.id) return null;
  return (
    <div className="toast" role="status">
      {toast.text}
    </div>
  );
}

export function PageHead({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: boolean }) {
  const goBack = useApp((s) => s.back);
  return (
    <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {back && (
          <button className="icon-btn" onClick={goBack} aria-label="Back" style={{ marginLeft: -8, marginTop: -4 }}>
            <Icon.back />
          </button>
        )}
        <div className="stack-sm">
          <h1>{title}</h1>
          {sub && <div className="muted small">{sub}</div>}
        </div>
      </div>
      {actions && <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>{actions}</div>}
    </div>
  );
}

export function BudgetBar({ used, budget, staffView }: { used: number; budget?: number; staffView?: boolean }) {
  if (!budget) return null;
  const pct = (used / budget) * 100;
  // Staff see a neutral signal — budgets inform, they never blame
  const tone = staffView ? (pct >= 100 ? 'warn' : '') : pct >= 100 ? 'bad' : pct >= 85 ? 'warn' : '';
  return (
    <div className="stack-sm">
      <div className="row between small">
        <span className="muted">{staffView ? 'Engagement Budget' : 'Budget used'}</span>
        <span className="num">
          {staffView ? `Hours Logged ${fmtH(used)} of ${fmtH(budget)}` : `${fmtH(used)} of ${fmtH(budget)}`}
        </span>
      </div>
      <div className={cx('progress', tone)}>
        <span style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

export function fmtH(h: number) {
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')} h`;
}
