import { useState } from 'react';
import { useApp, useMe } from '../store';
import type { AckType, ChecklistStatus, FollowUp, Task } from '../lib/types';
import { ACK_LABEL, isFiled, isOpen, LOCATION_LABEL, STATUS_LABEL, ROLE_LABEL } from '../lib/master';
import { isOverdue } from '../lib/compliance';
import { can, visibleClientIds } from '../lib/access';
import { diffDays, fmtDate, fmtDateTime, fmtShort, relDue, today } from '../lib/dates';
import {
  clientById,
  currentPending,
  engagementById,
  firstName,
  pendingDays,
  taskBudget,
  templateByCode,
  typeByCode,
  userById,
} from '../lib/selectors';
import { cx } from '../lib/util';
import { BudgetBar, Confirm, Empty, Field, Icon, PageHead, Pill, Seg, Sheet, StatusPill, fmtH } from '../components/ui';

export function TaskDetail({ id }: { id: string }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const navigate = useApp((s) => s.navigate);
  const openSheet = useApp((s) => s.openSheet);
  const actions = useApp.getState();
  const task = db.tasks.find((t) => t.id === id);
  const [dialog, setDialog] = useState<null | 'pending' | 'filing' | 'review' | 'return' | 'na' | 'approve' | 'complete'>(null);

  if (!task || !visibleClientIds(db, me).has(task.clientId)) {
    return (
      <div>
        <PageHead title="Task" back />
        <div className="card">
          <Empty>This task isn't on any of your client teams.</Empty>
        </div>
      </div>
    );
  }

  const client = clientById(db, task.clientId)!;
  const eng = engagementById(db, task.engagementId);
  const tpl = templateByCode(db, task.templateCode)!;
  const type = typeByCode(db, task.complianceTypeCode);
  const open = isOpen(task.status);
  const filingIdx = tpl.filingStageIndex;
  const overdue = isOverdue(task);
  const pend = currentPending(task);
  const waitDays = pendingDays(task);
  const firstWork = db.entries.filter((e) => e.taskId === task.id).map((e) => e.date).sort()[0];
  const endDate = task.ack?.date ?? today();
  const firmDays = firstWork ? Math.max(0, diffDays(endDate, firstWork) + 1 - waitDays) : 0;
  const isManagerish = me.role === 'partner' || me.role === 'manager' || me.role === 'admin';
  const canAct = me.role !== 'admin' || true;
  const staffView = me.role === 'staff' || me.role === 'article';
  const budget = taskBudget(db, task);
  const entries = db.entries.filter((e) => e.taskId === task.id && (!staffView || e.userId === me.id)).sort((a, b) => b.date.localeCompare(a.date));
  const isChecker = task.checkerId === me.id || (can.review(me) && task.assignedTo !== me.id && me.role !== 'article');
  const team = db.clientTeam.filter((a) => a.clientId === task.clientId).map((a) => userById(db, a.userId)!);
  const completedLabel = task.kind === 'engagement' && task.ack?.number === 'Completed';

  return (
    <div className="stack-lg">
      <PageHead
        back
        title={task.title}
        sub={
          <button className="btn ghost sm" style={{ padding: 0, minHeight: 0 }} onClick={() => navigate({ name: 'client', id: client.id })}>
            <span className="mono">{client.code}</span>&nbsp;{client.name}
          </button>
        }
      />

      <div className="card stack">
        <div className="row-wrap between">
          <div className="row-wrap">
            {completedLabel ? <Pill tone="ok">Completed</Pill> : <StatusPill task={task} />}
            {task.provisional && <Pill tone="warn">Provisional date — AGM not recorded</Pill>}
          </div>
          <span className={cx('small strong', overdue && 'bad')} style={{ color: overdue ? 'var(--bad)' : undefined }}>
            {open ? relDue(task.effectiveDue) : ''}
          </span>
        </div>
        <dl className="kv">
          <dt>Due date</dt>
          <dd>
            <strong>{fmtDate(task.effectiveDue)}</strong>
            {task.effectiveDue !== task.originalDue && <span className="muted small"> · extended from {fmtDate(task.originalDue)}</span>}
          </dd>
          {type && (
            <>
              <dt>Compliance</dt>
              <dd>{type.name}</dd>
            </>
          )}
          <dt>Period</dt>
          <dd>{task.periodLabel || '—'}</dd>
          <dt>Engagement</dt>
          <dd>
            {eng ? (
              <button className="btn ghost sm" style={{ padding: 0, minHeight: 0 }} onClick={() => navigate({ name: 'engagement', id: eng.id })}>
                {eng.title}
              </button>
            ) : (
              '—'
            )}
          </dd>
          <dt>Assigned to</dt>
          <dd>
            {isManagerish && open ? (
              <select id="assignee" className="input" style={{ minHeight: 34, maxWidth: 260 }} value={task.assignedTo ?? ''} onChange={(e) => actions.assignTask(task.id, e.target.value)}>
                <option value="">Unassigned</option>
                {team.concat(client.managerId ? [userById(db, client.managerId)!] : []).filter(Boolean).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.designation}
                  </option>
                ))}
              </select>
            ) : (
              userById(db, task.assignedTo)?.name ?? '—'
            )}
          </dd>
          <dt>Checker</dt>
          <dd>{userById(db, task.checkerId)?.name ?? '—'} <span className="muted small">· {tpl.reviewLevel}</span></dd>
        </dl>
      </div>

      {task.ack && (
        <div className="ack-box stack-sm">
          {completedLabel ? (
            <div className="strong">Completed on {fmtDate(task.ack.date)}</div>
          ) : (
            <>
              <div className="eyebrow" style={{ color: 'var(--ok)' }}>{ACK_LABEL[task.ack.type]}</div>
              <div className="mono strong" style={{ overflowWrap: 'anywhere' }}>{task.ack.number}</div>
              <div className="small muted">
                {task.status === 'filed_late' ? 'Filed late' : 'Filed'} on {fmtDate(task.ack.date)}
                {task.status === 'filed_late' ? ` — ${diffDays(task.ack.date, task.effectiveDue)} day(s) after the due date` : ''}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      {canAct && (
        <div className="row-wrap">
          {(open || isFiled(task.status)) && (
            <button className="btn primary" onClick={() => openSheet({ taskId: task.id, clientId: task.clientId })}>
              <Icon.plus /> Log work
            </button>
          )}
          {open && task.status !== 'pending_from_client' && (
            <button className="btn" onClick={() => setDialog('pending')}>
              <Icon.hourglass /> Pending from Client
            </button>
          )}
          {task.status === 'pending_from_client' && (
            <button className="btn" onClick={() => actions.resumeFromPending(task.id)}>
              <Icon.check /> Data received — resume
            </button>
          )}
          {open && task.status !== 'under_review' && task.status !== 'pending_from_client' && (
            <button className="btn" onClick={() => setDialog('review')}>
              Submit for review
            </button>
          )}
          {task.status === 'under_review' && isChecker && me.role !== 'article' && (
            <>
              <button className="btn" onClick={() => setDialog('approve')}>
                <Icon.check /> Approve
              </button>
              <button className="btn" onClick={() => setDialog('return')}>
                Return with points
              </button>
            </>
          )}
          {open && filingIdx !== null && (
            <button className="btn" style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }} onClick={() => setDialog('filing')}>
              Record filing ({ACK_LABEL[tpl.ackType ?? 'other']})
            </button>
          )}
          {open && filingIdx === null && (
            <button className="btn" onClick={() => setDialog('complete')}>
              Mark completed
            </button>
          )}
          {open && isManagerish && (
            <button className="btn ghost" onClick={() => setDialog('na')}>
              Not applicable this period
            </button>
          )}
          {task.status === 'not_applicable' && isManagerish && (
            <button className="btn" onClick={() => actions.reopenTask(task.id)}>
              Reopen
            </button>
          )}
        </div>
      )}

      {task.status === 'not_applicable' && <div className="notice">Not applicable: {task.naReason}</div>}

      {(pend || waitDays > 0) && (
        <div className={cx('notice', pend ? 'warn' : '')}>
          {pend ? (
            <>
              <strong>Waiting on client since {fmtShort(pend.from.slice(0, 10))}</strong> — {pend.what}.{' '}
            </>
          ) : null}
          {waitDays} day{waitDays === 1 ? '' : 's'} waiting on the client · {firmDays} day{firmDays === 1 ? '' : 's'} of firm work. Client-side days are tracked
          separately and never counted against the team.
        </div>
      )}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* Stages */}
        <div className="card">
          <div className="card-head">
            <h2>Stages</h2>
            <span className="xs muted">{tpl.name} template</span>
          </div>
          <div className="stepper">
            {tpl.stages.map((s, i) => {
              const done = i < task.stageIndex || (isFiled(task.status) && i <= task.stageIndex);
              const current = i === task.stageIndex && !done;
              const isFilingStep = filingIdx !== null && i === filingIdx;
              const clickable = canAct && ((open && (filingIdx === null || i < filingIdx)) || (isFiled(task.status) && filingIdx !== null && i > filingIdx));
              const Label = clickable ? 'button' : 'div';
              return (
                <div key={s} className={cx('step', done && 'done', current && 'current')}>
                  <div className="rail-line">
                    <span className="dot">{done ? '✓' : i + 1}</span>
                    <span className="bar" />
                  </div>
                  <Label
                    className="label"
                    {...(clickable ? { onClick: () => actions.setTaskStage(task.id, i), title: 'Set as current stage' } : {})}
                  >
                    <span className={cx('name', current && 'strong')}>{s}</span>
                    {isFilingStep && open && <span className="xs muted">needs {ACK_LABEL[tpl.ackType ?? 'other']}</span>}
                    {current && <span className="xs" style={{ color: 'var(--accent)' }}>current</span>}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>

        {/* Effort */}
        <div className="card stack">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2>Effort</h2>
            <span className="num strong">{fmtH(budget.used)} logged</span>
          </div>
          <BudgetBar used={budget.used} budget={budget.budget} staffView={staffView} />
          {entries.length ? (
            <div className="list">
              {entries.slice(0, 12).map((e) => (
                <button key={e.id} className="list-item" style={{ padding: '8px 0' }} onClick={() => openSheet({ entryId: e.id })}>
                  <div className="grow">
                    <div className="small">
                      <strong>{firstName(userById(db, e.userId))}</strong> · {fmtShort(e.date)} · {e.stage}
                    </div>
                    <div className="xs muted ellipsis">{[e.description, e.outcome, e.location !== 'office' ? LOCATION_LABEL[e.location] : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="mono small">{fmtH(e.hours)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="muted small">{staffView ? 'You have not logged work on this yet.' : 'No work logged yet.'}</div>
          )}
        </div>
      </div>

      <Checklist task={task} />
      <FollowUps task={task} />

      <div className="card stack">
        <h2>History</h2>
        <div className="timeline">
          {[
            ...task.statusHistory.map((h) => ({ at: h.at, by: h.by, text: `${h.from ? `${STATUS_LABEL[h.from]} → ` : ''}${STATUS_LABEL[h.to]}${h.note ? ` — ${h.note}` : ''}` })),
            ...task.dueHistory.map((h) => ({
              at: h.at,
              by: h.by,
              text: `Due date ${fmtDate(h.from)} → ${fmtDate(h.to)} (${h.source.replace('_', ' ')}${h.reference ? ` · ${h.reference}` : ''})`,
            })),
          ]
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((h, i) => {
              const u = userById(db, h.by);
              return (
                <div key={i} className="t-item">
                  <span className="t-dot" />
                  <div>
                    <div>{h.text}</div>
                    <div className="xs faint">
                      {fmtDateTime(h.at)} · {u ? `${u.name}${u.role !== 'staff' && u.role !== 'article' ? ` (${ROLE_LABEL[u.role]})` : ''}` : 'System'}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {dialog === 'pending' && <PendingDialog task={task} onClose={() => setDialog(null)} />}
      {dialog === 'filing' && <FilingDialog task={task} onClose={() => setDialog(null)} />}
      {dialog === 'review' && <ReviewDialog task={task} onClose={() => setDialog(null)} />}
      {(dialog === 'return' || dialog === 'na' || dialog === 'approve') && (
        <NoteDialog
          title={dialog === 'return' ? 'Return to maker' : dialog === 'approve' ? 'Approve review' : 'Not applicable this period'}
          label={dialog === 'return' ? 'Review points' : dialog === 'approve' ? 'Note (optional)' : 'Reason'}
          required={dialog !== 'approve'}
          confirm={dialog === 'return' ? 'Return' : dialog === 'approve' ? 'Approve' : 'Mark not applicable'}
          onClose={() => setDialog(null)}
          onSubmit={(note) => {
            if (dialog === 'return') actions.reviewDecision(task.id, false, note);
            else if (dialog === 'approve') actions.reviewDecision(task.id, true, note);
            else actions.markNotApplicable(task.id, note);
          }}
        />
      )}
      {dialog === 'complete' && (
        <Confirm
          title="Mark as completed?"
          body="The engagement work item closes and moves out of open tasks. Hours already logged stay with it."
          confirmLabel="Mark completed"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            actions.setTaskStage(task.id, tpl.stages.length - 1);
            actions.recordFiling(task.id, 'other', 'Completed', today());
            if (eng) actions.setEngagementStatus(eng.id, 'completed');
            actions.notify('Marked completed');
          }}
        />
      )}
    </div>
  );
}

function PendingDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const markPending = useApp((s) => s.markPending);
  const outstanding = task.checklist.filter((c) => c.status !== 'received' && c.status !== 'not_applicable');
  const [what, setWhat] = useState('');
  const [items, setItems] = useState<string[]>(outstanding.filter((c) => c.status === 'requested').map((c) => c.name));
  const [extra, setExtra] = useState('');
  const [err, setErr] = useState('');
  return (
    <Sheet
      title="Pending from Client"
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            onClick={() => {
              const all = [...items, ...extra.split(',').map((x) => x.trim()).filter(Boolean)];
              const desc = what.trim() || all.join(', ');
              if (!desc) return setErr('Say what is pending, or pick the documents requested.');
              markPending(task.id, desc, all);
              onClose();
            }}
          >
            Mark pending
          </button>
        </>
      }
    >
      <p className="muted small">The clock for client-side waiting starts now and is tracked separately from your work days.</p>
      <Field label="What is pending?" htmlFor="pending-what">
        <input id="pending-what" className="input" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Sales register for September" />
      </Field>
      {outstanding.length > 0 && (
        <div className="field">
          <span className="label">Documents requested</span>
          <div className="stack-sm">
            {outstanding.map((c) => (
              <label key={c.id} className={cx('check', items.includes(c.name) && 'on')}>
                <input type="checkbox" checked={items.includes(c.name)} onChange={(e) => setItems((xs) => (e.target.checked ? [...xs, c.name] : xs.filter((x) => x !== c.name)))} />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <Field label="Other documents (comma separated)" htmlFor="pending-extra">
        <input id="pending-extra" className="input" value={extra} onChange={(e) => setExtra(e.target.value)} />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Sheet>
  );
}

function FilingDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const db = useApp((s) => s.db);
  const recordFiling = useApp((s) => s.recordFiling);
  const notify = useApp((s) => s.notify);
  const tpl = templateByCode(db, task.templateCode)!;
  const [type, setType] = useState<AckType>(tpl.ackType ?? 'other');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(today());
  const [err, setErr] = useState('');
  const late = date > task.effectiveDue;
  return (
    <Sheet
      title="Record filing"
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            onClick={() => {
              const r = recordFiling(task.id, type, number, date);
              if (!r.ok) return setErr(r.error);
              notify(r.message ?? 'Filed');
              onClose();
            }}
          >
            Save filing
          </button>
        </>
      }
    >
      <p className="muted small">The task closes only once an acknowledgment number is recorded.</p>
      <Field label="Acknowledgment type" htmlFor="ack-type">
        <select id="ack-type" className="input" value={type} onChange={(e) => setType(e.target.value as AckType)}>
          {(Object.keys(ACK_LABEL) as AckType[]).map((k) => (
            <option key={k} value={k}>{ACK_LABEL[k]}</option>
          ))}
        </select>
      </Field>
      <Field label={ACK_LABEL[type]} htmlFor="ack-no">
        <input id="ack-no" className="input mono" autoFocus value={number} onChange={(e) => setNumber(e.target.value)} placeholder={type === 'arn' ? 'AA271026001234X' : ''} />
      </Field>
      <Field label="Date filed" htmlFor="ack-date">
        <input id="ack-date" className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className={cx('notice', late ? 'warn' : 'ok')}>
        {late ? `This will be recorded as Filed Late (due ${fmtDate(task.effectiveDue)}).` : `On time — due ${fmtDate(task.effectiveDue)}.`}
      </div>
      {err && <div className="form-error">{err}</div>}
    </Sheet>
  );
}

function ReviewDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const submit = useApp((s) => s.submitForReview);
  const client = clientById(db, task.clientId)!;
  const candidates = db.users.filter(
    (u) =>
      u.id !== me.id &&
      can.review(u) &&
      (u.id === client.partnerId || u.id === client.managerId || db.clientTeam.some((a) => a.clientId === client.id && a.userId === u.id)),
  );
  const [checker, setChecker] = useState(task.checkerId && task.checkerId !== me.id ? task.checkerId : candidates[0]?.id ?? '');
  const [err, setErr] = useState('');
  return (
    <Sheet
      title="Submit for review"
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            onClick={() => {
              const r = submit(task.id, checker);
              if (!r.ok) return setErr(r.error);
              onClose();
            }}
          >
            Submit
          </button>
        </>
      }
    >
      <p className="muted small">You're the maker. A person can never be both maker and checker on the same task.</p>
      <Field label="Checker" htmlFor="checker">
        <select id="checker" className="input" value={checker} onChange={(e) => setChecker(e.target.value)}>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.designation}
            </option>
          ))}
        </select>
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Sheet>
  );
}

function NoteDialog({ title, label, confirm, required, onClose, onSubmit }: { title: string; label: string; confirm: string; required: boolean; onClose: () => void; onSubmit: (n: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Sheet
      title={title}
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            disabled={required && !note.trim()}
            onClick={() => {
              onSubmit(note.trim());
              onClose();
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      <Field label={label} htmlFor="note">
        <textarea id="note" className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}

const CHECK_OPTS: { value: ChecklistStatus; label: string }[] = [
  { value: 'not_requested', label: '—' },
  { value: 'requested', label: 'Requested' },
  { value: 'received', label: 'Received' },
  { value: 'not_applicable', label: 'N/A' },
];

function Checklist({ task }: { task: Task }) {
  const setStatus = useApp((s) => s.setChecklistStatus);
  const add = useApp((s) => s.addChecklistItem);
  const remove = useApp((s) => s.removeChecklistItem);
  const resume = useApp((s) => s.resumeFromPending);
  const [name, setName] = useState('');
  const received = task.checklist.filter((c) => c.status === 'received').length;
  const relevant = task.checklist.filter((c) => c.status !== 'not_applicable').length;
  const allIn = task.status === 'pending_from_client' && relevant > 0 && task.checklist.every((c) => c.status === 'received' || c.status === 'not_applicable' || c.status === 'not_requested') && task.checklist.some((c) => c.status === 'received');
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 14px 0' }}>
        <h2>Document checklist</h2>
        <span className="small muted num">
          {received}/{relevant} received
        </span>
      </div>
      <div className="list">
        {task.checklist.map((c) => (
          <div key={c.id} className="checklist-item">
            <div className="grow" style={{ minWidth: 160 }}>
              <div>{c.name}</div>
              <div className="xs muted">
                {c.dateRequested ? `Requested ${fmtShort(c.dateRequested)}` : 'Not requested yet'}
                {c.dateReceived ? ` · Received ${fmtShort(c.dateReceived)}` : ''}
              </div>
            </div>
            <Seg value={c.status} onChange={(v) => setStatus(task.id, c.id, v)} options={CHECK_OPTS} />
            <button className="icon-btn" onClick={() => remove(task.id, c.id)} aria-label={`Remove ${c.name}`}>
              <Icon.close />
            </button>
          </div>
        ))}
        <form
          className="checklist-item"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add(task.id, name.trim());
            setName('');
          }}
        >
          <input id="new-check" className="input grow" placeholder="Add a document (e.g. Form 26AS)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" type="submit">Add</button>
        </form>
      </div>
      {allIn && (
        <div className="notice ok row between" style={{ margin: 14 }}>
          <span>Everything requested has come in.</span>
          <button className="btn sm" onClick={() => resume(task.id)}>Resume work</button>
        </div>
      )}
    </div>
  );
}

function FollowUps({ task }: { task: Task }) {
  const db = useApp((s) => s.db);
  const addFollowUp = useApp((s) => s.addFollowUp);
  const [channel, setChannel] = useState<FollowUp['channel']>('call');
  const [notes, setNotes] = useState('');
  const [at, setAt] = useState(today());
  return (
    <div className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Reminder log</h2>
        <span className="small muted">{task.followUps.length} follow-up{task.followUps.length === 1 ? '' : 's'}</span>
      </div>
      {task.followUps.length > 0 && (
        <div className="timeline">
          {[...task.followUps].sort((a, b) => b.at.localeCompare(a.at)).map((f) => (
            <div key={f.id} className="t-item">
              <span className="t-dot" />
              <div>
                <div>
                  <span className="pill plain" style={{ marginRight: 6 }}>{f.channel === 'whatsapp' ? 'WhatsApp' : f.channel[0].toUpperCase() + f.channel.slice(1)}</span>
                  {f.notes}
                </div>
                <div className="xs faint">
                  {fmtDate(f.at)} · {userById(db, f.by)?.name}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!notes.trim()) return;
          addFollowUp(task.id, { channel, notes: notes.trim(), at });
          setNotes('');
        }}
      >
        <div className="row-wrap">
          <Seg value={channel} onChange={setChannel} options={[{ value: 'call', label: 'Call' }, { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'other', label: 'Other' }]} />
          <input id="fu-date" className="input" type="date" value={at} max={today()} onChange={(e) => setAt(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
        <div className="row">
          <input id="fu-notes" className="input grow" placeholder="What was said or sent" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="btn" type="submit" disabled={!notes.trim()}>Log</button>
        </div>
      </form>
    </div>
  );
}
