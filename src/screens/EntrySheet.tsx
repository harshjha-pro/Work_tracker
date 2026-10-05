import { useMemo, useState } from 'react';
import { useApp, useMe, type EntryInput } from '../store';
import type { AckType, InternalCategory, Task, WorkLocation } from '../lib/types';
import { ACK_LABEL, DESCRIPTION_CHIPS, INTERNAL_LABEL, isFiled, isOpen, LOCATION_LABEL } from '../lib/master';
import { addDays, fmtDate, fmtDateTime, fmtDay, fmtShort, today, weekday, relDue } from '../lib/dates';
import { isLocked, lockAt, loggableClientIds } from '../lib/access';
import { clientById, entriesOn, hoursOf, recentPairs, taskBudget, taskById, templateByCode } from '../lib/selectors';
import { cx } from '../lib/util';
import { Confirm, Field, Icon, Seg, Sheet, StatusPill, fmtH } from '../components/ui';

type DateMode = 'today' | 'yesterday' | 'select' | 'multiple';

function prevWorkingDay(d: string) {
  let x = addDays(d, -1);
  if (weekday(x) === 0) x = addDays(x, -1);
  return x;
}

export function EntrySheet() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const sheet = useApp((s) => s.sheet)!;
  const close = useApp((s) => s.closeSheet);
  const saveEntry = useApp((s) => s.saveEntry);
  const deleteEntry = useApp((s) => s.deleteEntry);
  const notify = useApp((s) => s.notify);
  const navigate = useApp((s) => s.navigate);

  const editing = sheet.entryId ? db.entries.find((e) => e.id === sheet.entryId) : undefined;
  const seed = editing ?? sheet.prefill ?? {};
  const t = today();
  const yesterday = prevWorkingDay(t);
  const initialDate = editing?.date ?? sheet.date ?? t;

  const [mode, setMode] = useState<DateMode>(initialDate === t ? 'today' : initialDate === yesterday ? 'yesterday' : 'select');
  const [date, setDate] = useState(initialDate);
  const [multi, setMulti] = useState<string[]>([initialDate]);
  const [kind, setKind] = useState<'client' | 'internal'>(seed.internalCategory && !seed.clientId ? 'internal' : 'client');
  const [clientId, setClientId] = useState<string | undefined>(seed.clientId ?? sheet.clientId ?? taskById(db, sheet.taskId)?.clientId);
  const [taskId, setTaskId] = useState<string | undefined>(seed.taskId ?? sheet.taskId);
  const [category, setCategory] = useState<InternalCategory>(seed.internalCategory ?? 'internal_meeting');
  const initialTask = taskById(db, seed.taskId ?? sheet.taskId);
  const [stage, setStage] = useState<string | undefined>(seed.stage ?? (initialTask ? templateByCode(db, initialTask.templateCode)?.stages[initialTask.stageIndex] : undefined));
  const initHours = seed.hours ?? 1;
  const [hrs, setHrs] = useState(Math.floor(initHours));
  const [mins, setMins] = useState(Math.round((initHours - Math.floor(initHours)) * 60));
  const [description, setDescription] = useState(seed.description ?? '');
  const [outcome, setOutcome] = useState(seed.outcome ?? '');
  const [showOutcome, setShowOutcome] = useState(!!seed.outcome);
  const [location, setLocation] = useState<WorkLocation>(seed.location ?? me.defaultLocation);
  const [siteClient, setSiteClient] = useState<string | undefined>(seed.clientSiteClientId);
  const [ackNumber, setAckNumber] = useState('');
  const [query, setQuery] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dates = mode === 'today' ? [t] : mode === 'yesterday' ? [yesterday] : mode === 'select' ? [date] : multi;
  const locked = editing ? isLocked(db, editing.userId, editing.date) : false;
  const readOnly = !!editing && (editing.userId !== me.id || locked);

  const allowed = loggableClientIds(db, me);
  const clients = db.clients.filter((c) => allowed.has(c.id) && c.status !== 'discontinued');
  const q = query.trim().toLowerCase();
  const filtered = q ? clients.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) : clients;
  const recents = recentPairs(db, me.id).filter((r) => allowed.has(r.clientId));

  const client = clientById(db, clientId);
  const task = taskById(db, taskId);
  const template = task ? templateByCode(db, task.templateCode) : undefined;
  const stageIdx = template && stage ? template.stages.indexOf(stage) : -1;
  const isFilingStage = !!task && !!template && template.filingStageIndex !== null && stageIdx >= template.filingStageIndex && isOpen(task.status);

  const tasksForClient = useMemo(() => {
    if (!clientId) return [];
    return db.tasks
      .filter((x) => x.clientId === clientId)
      .filter((x) => {
        if (x.id === taskId) return true;
        if (isOpen(x.status)) return true;
        if (!showClosed) return false;
        return isFiled(x.status);
      })
      .sort((a, b) => Number(!isOpen(a.status)) - Number(!isOpen(b.status)) || a.effectiveDue.localeCompare(b.effectiveDue))
      .slice(0, showClosed ? 40 : 25);
  }, [db.tasks, clientId, taskId, showClosed]);

  const hours = Math.min(12, hrs + mins / 60);
  const budget = task ? taskBudget(db, task) : null;
  const usedWithoutThis = budget ? budget.used - (editing && editing.taskId === taskId ? editing.hours : 0) : 0;
  const afterSave = usedWithoutThis + hours * (mode === 'multiple' ? multi.length : 1);
  const exceeded = budget?.budget ? afterSave - budget.budget : 0;

  const dayTotal = hoursOf(entriesOn(db, me.id, dates[0] ?? t).filter((e) => e.id !== editing?.id));
  const lockedDate = dates.find((d) => isLocked(db, me.id, d));

  const pickTask = (x: Task) => {
    setTaskId(x.id);
    const tpl = templateByCode(db, x.templateCode)!;
    setStage(tpl.stages[x.stageIndex]);
    setAckNumber('');
  };

  const submit = (another: boolean) => {
    setError(null);
    const input: EntryInput = {
      dates,
      hours,
      location,
      clientSiteClientId: location === 'client_site' ? siteClient ?? clientId : undefined,
      description,
      outcome: showOutcome ? outcome : undefined,
    };
    if (kind === 'client') {
      Object.assign(input, { clientId, taskId, engagementId: task?.engagementId, stage });
      if (isFilingStage && ackNumber.trim()) input.ack = { type: (template!.ackType ?? 'other') as AckType, number: ackNumber };
    } else {
      input.internalCategory = category;
    }
    const r = saveEntry(input, editing?.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    notify(r.message ?? 'Saved');
    if (another) {
      useApp.getState().openSheet({ date: dates[0] });
    } else close();
  };

  const title = editing ? (readOnly ? 'Work entry' : 'Edit work') : 'Add work';

  return (
    <Sheet
      title={title}
      onClose={close}
      footer={
        readOnly ? (
          <button className="btn block" onClick={close}>
            Close
          </button>
        ) : (
          <div className="stack-sm grow">
            <div className="row between small">
              <span className="muted">{mode === 'multiple' && multi.length > 1 ? `${multi.length} days` : fmtDay(dates[0] ?? t)}</span>
              <span className="num">
                Day total with this entry: <strong>{fmtH(dayTotal + hours)}</strong>
              </span>
            </div>
            <div className="row">
              {editing ? (
                <button className="btn danger" onClick={() => setConfirmDelete(true)} aria-label="Delete entry">
                  <Icon.trash />
                </button>
              ) : (
                <button className="btn" onClick={() => submit(true)}>
                  Save &amp; add another
                </button>
              )}
              <button className="btn primary grow" onClick={() => submit(false)}>
                {editing ? 'Save changes' : 'Save'}
              </button>
            </div>
          </div>
        )
      }
    >
      {readOnly && (
        <div className="notice warn lock-banner">
          <Icon.lock />
          {editing!.userId !== me.id
            ? 'You can view this entry but only its owner can change it.'
            : `This week locked on ${fmtDateTime(lockAt(db, me.id, editing!.date).toISOString())}. Ask a Partner to extend the lock if it needs a correction.`}
        </div>
      )}

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack-lg">
        {/* Date */}
        <div className="field">
          <span className="label">Date</span>
          <Seg<DateMode>
            block
            value={mode}
            onChange={(m) => {
              setMode(m);
              if (m === 'multiple') setMulti([t]);
            }}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: weekday(t) === 1 ? 'Saturday' : 'Yesterday' },
              { value: 'select', label: 'Select' },
              ...(editing ? [] : [{ value: 'multiple' as DateMode, label: 'Multiple' }]),
            ]}
          />
          {mode === 'select' && <input id="entry-date" className="input" type="date" value={date} max={t} onChange={(e) => setDate(e.target.value)} />}
          {mode === 'multiple' && (
            <div className="chips">
              {Array.from({ length: 12 }, (_, i) => addDays(t, -i))
                .filter((d) => weekday(d) !== 0)
                .reverse()
                .map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={cx('chip', multi.includes(d) && 'on')}
                    disabled={isLocked(db, me.id, d)}
                    onClick={() => setMulti((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort()))}
                  >
                    {fmtDay(d)}
                  </button>
                ))}
            </div>
          )}
          {lockedDate && !readOnly && (
            <span className="err">The week of {fmtShort(lockedDate)} is locked. A Partner can extend the lock.</span>
          )}
        </div>

        <Seg<'client' | 'internal'>
          block
          value={kind}
          onChange={setKind}
          options={[
            { value: 'client', label: 'Client work' },
            { value: 'internal', label: 'Internal / non-client' },
          ]}
        />

        {kind === 'internal' ? (
          <div className="field">
            <span className="label">Category</span>
            <div className="chips">
              {(Object.keys(INTERNAL_LABEL) as InternalCategory[]).map((c) => (
                <button key={c} type="button" className={cx('chip', category === c && 'on')} onClick={() => setCategory(c)}>
                  {INTERNAL_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Client */}
            {!client ? (
              <div className="field">
                <span className="label">Client</span>
                {recents.length > 0 && (
                  <div className="stack-sm">
                    <span className="xs faint">Recently used</span>
                    <div className="chips">
                      {recents.map((r) => {
                        const c = clientById(db, r.clientId)!;
                        const rt = taskById(db, r.taskId);
                        return (
                          <button
                            key={`${r.clientId}|${r.taskId}`}
                            type="button"
                            className="chip"
                            onClick={() => {
                              setClientId(c.id);
                              if (rt) pickTask(rt);
                            }}
                          >
                            <span className="mono">{c.code}</span> → {rt ? rt.title.split(' · ')[0] + (rt.kind === 'compliance' ? ` ${rt.periodLabel.split(' (')[0]}` : '') : 'Engagement'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {clients.length === 0 ? (
                  <div className="notice">No clients assigned to you yet — log internal work for now.</div>
                ) : (
                  <>
                    <input id="client-search" className="input" placeholder="Search by name or client code" value={query} onChange={(e) => setQuery(e.target.value)} />
                    <div className="card flush list" style={{ maxHeight: 260, overflowY: 'auto' }}>
                      {filtered.map((c) => (
                        <button key={c.id} type="button" className="list-item" onClick={() => { setClientId(c.id); setTaskId(undefined); setStage(undefined); }}>
                          <span className="mono small faint">{c.code}</span>
                          <span className="grow ellipsis">{c.name}</span>
                        </button>
                      ))}
                      {!filtered.length && <div className="list-item muted small">No assigned client matches “{query}”.</div>}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="field">
                <span className="label">Client</span>
                <div className="row between card" style={{ padding: '10px 12px' }}>
                  <div className="grow">
                    <span className="mono small faint">{client.code}</span> <span className="strong">{client.name}</span>
                  </div>
                  <button type="button" className="btn ghost sm" onClick={() => { setClientId(undefined); setTaskId(undefined); setStage(undefined); }}>
                    Change
                  </button>
                </div>
              </div>
            )}

            {/* Engagement / task */}
            {client && (
              <div className="field">
                <span className="label">Engagement / compliance task</span>
                <div className="card flush list" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {tasksForClient.map((x) => (
                    <button key={x.id} type="button" className={cx('list-item')} style={x.id === taskId ? { background: 'var(--accent-soft)' } : undefined} onClick={() => pickTask(x)}>
                      <div className="grow">
                        <div className={cx('ellipsis', x.id === taskId && 'strong')}>{x.title}</div>
                        <div className="meta">{isOpen(x.status) ? relDue(x.effectiveDue) : `Filed ${fmtShort(x.ack?.date ?? x.effectiveDue)}`}</div>
                      </div>
                      <StatusPill task={x} />
                    </button>
                  ))}
                  {!tasksForClient.length && <div className="list-item muted small">No open tasks for this client.</div>}
                </div>
                <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowClosed((v) => !v)}>
                  {showClosed ? 'Hide filed tasks' : 'Show filed tasks (post-filing work)'}
                </button>
              </div>
            )}

            {task && budget?.budget ? (
              <div className="card stack-sm" style={{ padding: '10px 12px' }}>
                <div className="row between small">
                  <span className="muted">Engagement Budget{budget.scope === 'period' ? ' (this period)' : ''}</span>
                  <span className="num strong">{fmtH(budget.budget)}</span>
                </div>
                <div className="row between small">
                  <span className="muted">Hours Logged</span>
                  <span className="num">{fmtH(usedWithoutThis)}</span>
                </div>
                <div className="row between small">
                  <span className="muted">Remaining</span>
                  <span className="num">{fmtH(Math.max(0, budget.budget - usedWithoutThis))}</span>
                </div>
                {exceeded > 0 && (
                  <div className="notice warn small">
                    Budget exceeded by {fmtH(exceeded)} with this entry. You can still save — genuine work and client delays happen.
                  </div>
                )}
              </div>
            ) : null}

            {/* Stage */}
            {template && (
              <div className="field">
                <span className="label">Stage</span>
                <div className="chips">
                  {template.stages.map((s, i) => (
                    <button key={s} type="button" className={cx('chip', stage === s && 'on')} onClick={() => setStage(s)} title={i === task!.stageIndex ? 'Current stage' : undefined}>
                      {s}
                      {i === task!.stageIndex && stage !== s ? ' •' : ''}
                    </button>
                  ))}
                </div>
                {isFilingStage && (
                  <div className="card stack-sm" style={{ padding: 12, borderColor: 'color-mix(in srgb, var(--ok) 40%, var(--line))' }}>
                    <Field label={`${ACK_LABEL[template.ackType ?? 'other']} (records the filing)`} hint="The task closes as Filed only once the acknowledgment is recorded. Leave blank if you only prepared it." htmlFor="ack-number">
                      <input id="ack-number" className="input mono" value={ackNumber} onChange={(e) => setAckNumber(e.target.value)} placeholder={template.ackType === 'arn' ? 'AA2710260012345' : ''} />
                    </Field>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Hours */}
        <div className="field">
          <span className="label">Hours</span>
          <div className="row-wrap">
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="btn" onClick={() => setHrs((h) => Math.max(0, h - 1))} aria-label="One hour less">
                −
              </button>
              <span className="mono strong" style={{ minWidth: 44, textAlign: 'center', fontSize: '1.15rem' }}>
                {hrs} h
              </span>
              <button type="button" className="btn" onClick={() => { setHrs((h) => Math.min(12, h + 1)); if (hrs + 1 >= 12) setMins(0); }} aria-label="One hour more">
                +
              </button>
            </div>
            <Seg<string>
              value={String(mins)}
              onChange={(v) => setMins(hrs >= 12 ? 0 : Number(v))}
              options={[0, 15, 30, 45].map((m) => ({ value: String(m), label: `${String(m).padStart(2, '0')} m` }))}
            />
          </div>
          <div className="chips">
            {[0.5, 1, 1.5, 2, 3, 4, 6].map((h) => (
              <button key={h} type="button" className={cx('chip', hours === h && 'on')} onClick={() => { setHrs(Math.floor(h)); setMins((h % 1) * 60); }}>
                {fmtH(h)}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="field">
          <label htmlFor="entry-desc">What did you work on? <span className="faint">(optional)</span></label>
          <div className="chips">
            {(kind === 'client' ? DESCRIPTION_CHIPS : ['Team meeting', 'ICAI class', 'Webinar', 'Reading circulars']).map((c) => (
              <button key={c} type="button" className={cx('chip', description === c && 'on')} onClick={() => setDescription((d) => (d === c ? '' : d && !DESCRIPTION_CHIPS.includes(d) ? `${d}; ${c}` : c))}>
                {c}
              </button>
            ))}
          </div>
          <input id="entry-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} placeholder="Short note" />
        </div>

        {kind === 'client' &&
          (showOutcome ? (
            <Field label="Outcome (optional)" hint='e.g. "42 vouchers verified", "Draft reply prepared"' htmlFor="entry-outcome">
              <input id="entry-outcome" className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={140} />
            </Field>
          ) : (
            <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOutcome(true)}>
              <Icon.plus /> Add outcome
            </button>
          ))}

        {/* Location */}
        <div className="field">
          <span className="label">Location</span>
          {me.locationOverrideAllowed ? (
            <Seg<WorkLocation> block value={location} onChange={setLocation} options={(Object.keys(LOCATION_LABEL) as WorkLocation[]).map((l) => ({ value: l, label: LOCATION_LABEL[l] }))} />
          ) : (
            <div className="muted small">{LOCATION_LABEL[me.defaultLocation]} · your default location is set by the Practice Admin</div>
          )}
          {location === 'client_site' && (
            <select id="site-client" className="input" value={siteClient ?? clientId ?? ''} onChange={(e) => setSiteClient(e.target.value)}>
              <option value="">Which client's premises?</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}
        {task && !readOnly && (
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => { close(); navigate({ name: 'task', id: task.id }); }}>
            Open task — checklist, pending from client, filing
          </button>
        )}
      </fieldset>

      {confirmDelete && (
        <Confirm
          title="Delete this entry?"
          body={`${fmtH(editing!.hours)} on ${fmtDate(editing!.date)} will be removed. This is recorded in the audit trail.`}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            const r = deleteEntry(editing!.id);
            if (r.ok) {
              notify('Entry deleted');
              close();
            } else setError(r.error);
          }}
        />
      )}
    </Sheet>
  );
}
