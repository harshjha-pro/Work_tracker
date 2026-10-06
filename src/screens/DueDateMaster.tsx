import { useMemo, useState } from 'react';
import { useApp, useMe } from '../store';
import type { ApplicabilityRule, ComplianceType, DueRule, FlagKey, ServiceLine } from '../lib/types';
import { can } from '../lib/access';
import { dueForPeriod, ruleText, extensionFor } from '../lib/compliance';
import { FLAG_LABEL, GST_FREQ_LABEL, isOpen, SERVICE_LINE_LABEL } from '../lib/master';
import { fmtDate, fmtDateTime, monthName, today } from '../lib/dates';
import { userById } from '../lib/selectors';
import { cx, uid } from '../lib/util';
import { Empty, Field, Icon, PageHead, Pill, Seg, Sheet } from '../components/ui';

function appliesText(t: ComplianceType) {
  return t.applicability
    .map((r) => {
      if (r.flag === 'gstFrequency') return `GST ${GST_FREQ_LABEL[r.value as keyof typeof GST_FREQ_LABEL]}`;
      return r.value === 'true' ? FLAG_LABEL[r.flag] : `Not ${FLAG_LABEL[r.flag].toLowerCase()}`;
    })
    .join(' + ');
}

export function DueDateMaster() {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const [edit, setEdit] = useState<ComplianceType | null>(null);
  const [extend, setExtend] = useState<ComplianceType | null>(null);
  const [adding, setAdding] = useState(false);

  if (!can.editDueDateMaster(me.role)) {
    return (
      <div>
        <PageHead title="Due-Date Master" />
        <div className="card"><Empty>Partners and Practice Admin maintain the due-date master.</Empty></div>
      </div>
    );
  }

  const openCount = (code: string) => db.tasks.filter((t) => t.complianceTypeCode === code && isOpen(t.status)).length;

  return (
    <div className="stack-lg">
      <PageHead
        title="Due-Date Master"
        sub="Due dates are never hard-coded. Change a rule or publish an extension and every affected open task moves, with the change recorded."
        actions={<button className="btn primary" onClick={() => setAdding(true)}><Icon.plus /> Compliance type</button>}
      />
      <div className="notice warn small">Illustrative defaults from the V1 spec — verify every date against current law before go-live.</div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Compliance</th>
              <th>Frequency</th>
              <th>Default due date</th>
              <th>Applies when</th>
              <th className="n">Open tasks</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {db.complianceTypes.map((t) => (
              <tr key={t.code} style={{ opacity: t.isActive ? 1 : 0.55 }}>
                <td>
                  <div className="strong">{t.name}</div>
                  <div className="xs muted">{SERVICE_LINE_LABEL[t.serviceLine]}{t.isCustom ? ' · custom' : ''}{!t.isActive ? ' · inactive' : ''}</div>
                </td>
                <td className="small">{t.frequency === 'event_based' ? 'Event-linked' : t.frequency[0].toUpperCase() + t.frequency.slice(1)}</td>
                <td className="small">{ruleText(t.rule)}</td>
                <td className="small muted">{appliesText(t)}</td>
                <td className="n mono">{openCount(t.code)}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn sm" onClick={() => setEdit(t)}>Edit</button>
                    <button className="btn sm" onClick={() => setExtend(t)} disabled={!openCount(t.code)}>Extend</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="stack">
        <h2>Published extensions</h2>
        {db.extensions.length ? (
          <div className="card flush list">
            {[...db.extensions].reverse().map((x) => {
              const t = db.complianceTypes.find((c) => c.code === x.complianceTypeCode);
              return (
                <div key={x.id} className="list-item" style={{ cursor: 'default' }}>
                  <div className="grow">
                    <div className="strong">{t?.name} → {fmtDate(x.newDueDate)}</div>
                    <div className="meta">
                      {x.periodKeys.join(', ')} · {x.reference || 'No reference'} · {x.reason}
                    </div>
                    <div className="xs faint">{fmtDateTime(x.publishedAt)} · {userById(db, x.publishedBy)?.name}</div>
                  </div>
                  <Pill tone="info" plain>{x.tasksMoved} moved</Pill>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card muted small">No extensions published yet.</div>
        )}
      </section>

      {edit && <EditRule type={edit} onClose={() => setEdit(null)} />}
      {extend && <ExtendSheet type={extend} onClose={() => setExtend(null)} />}
      {adding && <AddType onClose={() => setAdding(false)} />}
    </div>
  );
}

function RuleEditor({ rule, onChange }: { rule: DueRule; onChange: (r: DueRule) => void }) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthSel = (id: string, value: number, onPick: (m: number) => void) => (
    <select id={id} className="input" value={value} onChange={(e) => onPick(Number(e.target.value))}>
      {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
    </select>
  );
  const daySel = (id: string, value: number, onPick: (d: number) => void) => (
    <input id={id} className="input" type="number" min={1} max={31} value={value} onChange={(e) => onPick(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
  );
  if (rule.kind === 'monthly') {
    return (
      <div className="stack">
        <Field label="Day of the following month" htmlFor="r-day">
          {daySel("r-day", rule.day, (day) => onChange({ ...rule, day }))}
        </Field>
        <label className={cx('check', rule.marchOverride && 'on')}>
          <input type="checkbox" checked={!!rule.marchOverride} onChange={(e) => onChange({ ...rule, marchOverride: e.target.checked ? { month: 4, day: 30 } : undefined })} />
          <span>Different date for March (year end)</span>
        </label>
        {rule.marchOverride && (
          <div className="grid-2">
            <Field label="March period — day" htmlFor="r-mday">{daySel("r-mday", rule.marchOverride.day, (day) => onChange({ ...rule, marchOverride: { ...rule.marchOverride!, day } }))}</Field>
            <Field label="Month" htmlFor="r-mmon">{monthSel("r-mmon", rule.marchOverride.month, (month) => onChange({ ...rule, marchOverride: { ...rule.marchOverride!, month } }))}</Field>
          </div>
        )}
      </div>
    );
  }
  if (rule.kind === 'quarterly') {
    return (
      <div className="stack-sm">
        {rule.dates.map((d, i) => (
          <div key={i} className="row">
            <span className="small strong" style={{ width: 28 }}>Q{i + 1}</span>
            {daySel(`r-q${i}d`, d.day, (day) => onChange({ ...rule, dates: rule.dates.map((x, j) => (j === i ? { ...x, day } : x)) }))}
            {monthSel(`r-q${i}m`, d.month, (month) => onChange({ ...rule, dates: rule.dates.map((x, j) => (j === i ? { ...x, month } : x)) }))}
          </div>
        ))}
        <div className="xs muted">Each date is the first occurrence on or after the start of that FY quarter.</div>
      </div>
    );
  }
  if (rule.kind === 'annual') {
    return (
      <div className="grid-2">
        <Field label="Day" htmlFor="r-aday">{daySel("r-aday", rule.day, (day) => onChange({ ...rule, day }))}</Field>
        <Field label="Month (after FY end)" htmlFor="r-amon">{monthSel("r-amon", rule.month, (month) => onChange({ ...rule, month }))}</Field>
      </div>
    );
  }
  return (
    <Field label="Days after the AGM date" htmlFor="r-off">
      <input id="r-off" className="input" type="number" min={0} max={365} value={rule.offsetDays} onChange={(e) => onChange({ ...rule, offsetDays: Number(e.target.value) || 0 })} />
    </Field>
  );
}

function EditRule({ type, onClose }: { type: ComplianceType; onClose: () => void }) {
  const db = useApp((s) => s.db);
  const update = useApp((s) => s.updateComplianceType);
  const notify = useApp((s) => s.notify);
  const [rule, setRule] = useState<DueRule>(structuredClone(type.rule));
  const [budget, setBudget] = useState(type.defaultBudgetHours);
  const [active, setActive] = useState(type.isActive);
  const affected = useMemo(() => {
    const draft = { ...type, rule };
    let n = 0;
    const clients = new Set<string>();
    for (const t of db.tasks) {
      if (t.complianceTypeCode !== type.code || !isOpen(t.status)) continue;
      if (extensionFor(db, type.code, t.periodKey!)) continue;
      const c = db.clients.find((x) => x.id === t.clientId)!;
      const p = dueForPeriod(draft, c, t.periodKey!);
      if (p && p.due !== t.effectiveDue) {
        n++;
        clients.add(t.clientId);
      }
    }
    return { n, clients: clients.size };
  }, [db, type, rule]);

  return (
    <Sheet
      title={type.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            onClick={() => {
              const r = update(type.code, { rule, defaultBudgetHours: budget, isActive: active });
              notify(`Saved · ${r.moved} open task${r.moved === 1 ? '' : 's'} moved${r.created ? ` · ${r.created} created` : ''}${r.removed ? ` · ${r.removed} removed` : ''}`);
              onClose();
            }}
          >
            Save rule
          </button>
        </>
      }
    >
      <p className="muted small">Currently: {ruleText(type.rule)}. Use an extension instead when an authority extends a single period.</p>
      <RuleEditor rule={rule} onChange={setRule} />
      <Field label="Engagement Budget per period (hours)" htmlFor="r-budget">
        <input id="r-budget" className="input" type="number" min={0} step={0.25} value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} />
      </Field>
      <label className={cx('check', active && 'on')}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Active — generate tasks for clients whose flags match</span>
      </label>
      <div className={cx('notice small', affected.n ? 'warn' : '')}>
        {affected.n ? `${affected.n} open task${affected.n === 1 ? '' : 's'} across ${affected.clients} client${affected.clients === 1 ? '' : 's'} will move to the new date.` : 'No open task changes date with this rule.'}
      </div>
    </Sheet>
  );
}

function ExtendSheet({ type, onClose }: { type: ComplianceType; onClose: () => void }) {
  const db = useApp((s) => s.db);
  const publish = useApp((s) => s.publishExtension);
  const notify = useApp((s) => s.notify);
  const periods = useMemo(() => {
    const map = new Map<string, { key: string; label: string; due: string; open: number; total: number }>();
    for (const t of db.tasks) {
      if (t.complianceTypeCode !== type.code || t.status === 'not_applicable') continue;
      const p = map.get(t.periodKey!) ?? { key: t.periodKey!, label: t.periodLabel, due: t.effectiveDue, open: 0, total: 0 };
      p.total++;
      if (isOpen(t.status)) p.open++;
      map.set(t.periodKey!, p);
    }
    return [...map.values()].filter((p) => p.due >= today() || p.open > 0).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 8);
  }, [db, type.code]);
  const [keys, setKeys] = useState<string[]>(periods.length ? [periods[0].key] : []);
  const [date, setDate] = useState(periods[0]?.due ?? today());
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const sel = periods.filter((p) => keys.includes(p.key));
  const affected = sel.reduce((a, p) => a + p.open, 0);

  return (
    <Sheet
      title={`Extend ${type.shortName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            onClick={() => {
              if (!keys.length) return setErr('Pick at least one period.');
              if (!reason.trim()) return setErr('Add the reason, e.g. “CBIC extension due to portal glitch”.');
              const r = publish({ complianceTypeCode: type.code, periodKeys: keys, newDueDate: date, reference: reference.trim(), reason: reason.trim() });
              notify(`Extension published · ${r.moved} open task${r.moved === 1 ? '' : 's'} moved across ${r.clients} client${r.clients === 1 ? '' : 's'}${r.reclassified ? ` · ${r.reclassified} reclassified` : ''}`);
              onClose();
            }}
          >
            Publish extension
          </button>
        </>
      }
    >
      <p className="muted small">Every open task for the chosen periods moves to the new date across all clients. Filed Late tasks become Filed if they now fall on time. Not Applicable tasks are untouched.</p>
      <div className="field">
        <span className="label">Periods</span>
        <div className="stack-sm">
          {periods.map((p) => (
            <label key={p.key} className={cx('check', keys.includes(p.key) && 'on')}>
              <input type="checkbox" checked={keys.includes(p.key)} onChange={(e) => setKeys((xs) => (e.target.checked ? [...xs, p.key] : xs.filter((x) => x !== p.key)))} />
              <span className="grow">
                <span className="strong">{p.label}</span>
                <span className="xs muted"> · due {fmtDate(p.due)} · {p.open} open of {p.total}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <Field label="New due date" htmlFor="x-date">
        <input id="x-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Notification / circular reference" hint="e.g. CBIC Notification No. 12/2026-CT" htmlFor="x-ref">
        <input id="x-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <Field label="Reason" htmlFor="x-reason">
        <input id="x-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="notice small">{affected} open task{affected === 1 ? '' : 's'} will move to {fmtDate(date)}.</div>
      {err && <div className="form-error">{err}</div>}
    </Sheet>
  );
}

const FLAG_CHOICES: { label: string; rule: ApplicabilityRule }[] = [
  { label: 'GST monthly filers', rule: { flag: 'gstFrequency', value: 'monthly' } },
  { label: 'GST QRMP filers', rule: { flag: 'gstFrequency', value: 'qrmp' } },
  { label: 'GST composition', rule: { flag: 'gstFrequency', value: 'composition' } },
  { label: 'Any GST registration', rule: { flag: 'gstRegistered', value: 'true' } },
  ...(['tds', 'advanceTax', 'taxAudit', 'statutoryAudit', 'transferPricing', 'pf', 'esi', 'isCompany', 'isLLP'] as FlagKey[]).map((f) => ({ label: FLAG_LABEL[f], rule: { flag: f, value: 'true' } })),
];

function AddType({ onClose }: { onClose: () => void }) {
  const db = useApp((s) => s.db);
  const add = useApp((s) => s.addComplianceType);
  const notify = useApp((s) => s.notify);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [serviceLine, setServiceLine] = useState<ServiceLine>('direct_tax');
  const [templateCode, setTemplateCode] = useState('other');
  const [kind, setKind] = useState<DueRule['kind']>('monthly');
  const [rule, setRule] = useState<DueRule>({ kind: 'monthly', day: 10 });
  const [flagIdx, setFlagIdx] = useState(4);
  const [budget, setBudget] = useState(2);
  const [err, setErr] = useState('');
  const changeKind = (k: DueRule['kind']) => {
    setKind(k);
    setRule(
      k === 'monthly' ? { kind: 'monthly', day: 10 }
      : k === 'quarterly' ? { kind: 'quarterly', dates: [{ month: 7, day: 15 }, { month: 10, day: 15 }, { month: 1, day: 15 }, { month: 4, day: 15 }] }
      : k === 'annual' ? { kind: 'annual', month: 9, day: 30 }
      : { kind: 'event', event: 'agm', offsetDays: 30 },
    );
  };
  return (
    <Sheet
      title="Add compliance type"
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button
            className="btn primary grow"
            onClick={() => {
              if (!name.trim()) return setErr('Name the compliance, e.g. “Professional tax (Maharashtra)”.');
              const t: ComplianceType = {
                code: `CUST_${uid().slice(0, 6).toUpperCase()}`,
                name: name.trim(),
                shortName: shortName.trim() || name.trim(),
                serviceLine,
                engagementGroup: shortName.trim() || name.trim(),
                templateCode,
                frequency: kind === 'event' ? 'event_based' : kind,
                rule,
                applicability: [FLAG_CHOICES[flagIdx].rule],
                scope: ['gstFrequency', 'gstRegistered'].includes(FLAG_CHOICES[flagIdx].rule.flag) ? 'gstin' : 'client',
                illustrative: true,
                verifiedBy: null,
                verifiedAt: null,
                defaultBudgetHours: budget,
                isActive: true,
                isCustom: true,
              };
              const r = add(t);
              notify(`${t.name} added · ${r.created} task${r.created === 1 ? '' : 's'} generated`);
              onClose();
            }}
          >
            Add
          </button>
        </>
      }
    >
      <p className="muted small">State-level, sector-specific or client-specific compliances — no code changes needed.</p>
      <div className="grid-2">
        <Field label="Name" htmlFor="n-name"><input id="n-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Short name" htmlFor="n-short"><input id="n-short" className="input" value={shortName} onChange={(e) => setShortName(e.target.value)} /></Field>
      </div>
      <div className="grid-2">
        <Field label="Service line" htmlFor="n-sl">
          <select id="n-sl" className="input" value={serviceLine} onChange={(e) => setServiceLine(e.target.value as ServiceLine)}>
            {(Object.keys(SERVICE_LINE_LABEL) as ServiceLine[]).map((k) => <option key={k} value={k}>{SERVICE_LINE_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Stage template" htmlFor="n-tpl">
          <select id="n-tpl" className="input" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}>
            {db.templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Applies to clients with" htmlFor="n-flag">
        <select id="n-flag" className="input" value={flagIdx} onChange={(e) => setFlagIdx(Number(e.target.value))}>
          {FLAG_CHOICES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
        </select>
      </Field>
      <div className="field">
        <span className="label">Frequency</span>
        <Seg<DueRule['kind']> block value={kind} onChange={changeKind} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'annual', label: 'Annual' }, { value: 'event', label: 'AGM-linked' }]} />
      </div>
      <RuleEditor rule={rule} onChange={setRule} />
      <Field label="Engagement Budget per period (hours)" htmlFor="n-budget">
        <input id="n-budget" className="input" type="number" min={0} step={0.25} value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Sheet>
  );
}
