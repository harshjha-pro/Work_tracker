import { useState } from 'react';
import { useApp, useMe } from '../store';
import { baseLockAt, can, isoAt, lockLabel } from '../lib/access';
import { addDays, fmtDate, fmtDateTime, today, weekStart } from '../lib/dates';
import { userById } from '../lib/selectors';
import { Empty, Field, PageHead, Sheet } from '../components/ui';

const DAY_OPTIONS = [
  { value: 5, label: 'Saturday (same week)' },
  { value: 6, label: 'Sunday (end of week)' },
  { value: 7, label: 'Monday (following week)' },
  { value: 8, label: 'Tuesday (following week)' },
];

export function LockExtendSheet({ weekStart: ws, userId, onClose }: { weekStart: string; userId: string | null; onClose: () => void }) {
  const db = useApp((s) => s.db);
  const extend = useApp((s) => s.extendLock);
  const notify = useApp((s) => s.notify);
  const [who, setWho] = useState<string>(userId ?? '');
  const [date, setDate] = useState(addDays(today(), 2));
  const [time, setTime] = useState('18:00');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  return (
    <Sheet
      title={`Extend lock · week of ${fmtDate(ws)}`}
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            onClick={() => {
              if (!reason.trim()) return setErr('Give a reason, e.g. “Peak GST filing week”.');
              const until = isoAt(date, time);
              if (new Date(until) <= new Date()) return setErr('The new lock time must be in the future.');
              extend(ws, who || null, until, reason.trim());
              notify('Lock extended');
              onClose();
            }}
          >
            Extend
          </button>
        </>
      }
    >
      <p className="muted small">Normally locks {fmtDateTime(baseLockAt(db, ws).toISOString())}. Entries become editable again until the new time.</p>
      <Field label="For" htmlFor="lx-who">
        <select id="lx-who" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {db.users.filter((u) => u.role !== 'partner').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Editable until" htmlFor="lx-date">
          <input id="lx-date" className="input" type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time" htmlFor="lx-time">
          <input id="lx-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Reason" htmlFor="lx-reason">
        <input id="lx-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Sheet>
  );
}

export function Settings() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const setLock = useApp((s) => s.setLockSettings);
  const notify = useApp((s) => s.notify);
  const [day, setDay] = useState(db.lockSettings.dayOffset);
  const [time, setTime] = useState(db.lockSettings.time);
  const [extendWeek, setExtendWeek] = useState<string | null>(null);
  if (!can.setLockTime(me.role)) {
    return (
      <div>
        <PageHead title="Weekly Lock" />
        <div className="card"><Empty>Only Partners and Practice Admin change firm settings.</Empty></div>
      </div>
    );
  }
  const lastWeek = addDays(weekStart(today()), -7);
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <PageHead title="Weekly Lock" sub={`Entries lock every ${lockLabel(db)}. Locked weeks stay reliable for billing.`} />
      <section className="card stack">
        <h2>Lock time</h2>
        <div className="grid-2">
          <Field label="Lock on" htmlFor="lock-day">
            <select id="lock-day" className="input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="At" htmlFor="lock-time">
            <input id="lock-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <button
          className="btn primary"
          style={{ alignSelf: 'flex-start' }}
          disabled={day === db.lockSettings.dayOffset && time === db.lockSettings.time}
          onClick={() => {
            setLock(day, time);
            notify('Lock time saved');
          }}
        >
          Save lock time
        </button>
      </section>

      <section className="card stack">
        <div className="section-head">
          <h2>Extensions</h2>
          {can.extendLock(me.role) ? (
            <div className="row-wrap">
              <button className="btn sm" onClick={() => setExtendWeek(lastWeek)}>Extend last week</button>
              <button className="btn sm" onClick={() => setExtendWeek(weekStart(today()))}>Extend this week</button>
            </div>
          ) : (
            <span className="xs muted">Only a Partner can extend</span>
          )}
        </div>
        {db.lockExtensions.length ? (
          <div className="list">
            {[...db.lockExtensions].reverse().map((x) => (
              <div key={x.id} className="list-item" style={{ cursor: 'default', padding: '10px 0' }}>
                <div className="grow">
                  <div className="small strong">Week of {fmtDate(x.weekStart)} · {x.userId ? userById(db, x.userId)?.name : 'Everyone'}</div>
                  <div className="xs muted">Until {fmtDateTime(x.until)} · {x.reason} · by {userById(db, x.by)?.name}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted small">No extensions yet.</div>
        )}
      </section>
      {extendWeek && <LockExtendSheet weekStart={extendWeek} userId={null} onClose={() => setExtendWeek(null)} />}
    </div>
  );
}
