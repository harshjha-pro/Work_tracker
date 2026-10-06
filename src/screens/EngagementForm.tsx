import { useState } from 'react';
import { useApp, useMe } from '../store';
import type { Engagement, EngagementMember, ServiceLine } from '../lib/types';
import { can, visibleClientIds } from '../lib/access';
import { SERVICE_LINE_LABEL } from '../lib/master';
import { addDays, fyLabel, fyStartYear, today } from '../lib/dates';
import { Empty, Field, PageHead, Seg } from '../components/ui';

const TEMPLATE_FOR: Record<ServiceLine, string> = {
  accounting: 'bookkeeping',
  audit: 'audit',
  direct_tax: 'itr',
  gst: 'gst_return',
  company_law: 'roc',
  advisory: 'other',
};

export function EngagementForm({ id, clientId }: { id?: string; clientId?: string }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const save = useApp((s) => s.saveEngagement);
  const navigate = useApp((s) => s.navigate);
  const notify = useApp((s) => s.notify);
  const existing = id ? db.engagements.find((e) => e.id === id) : undefined;
  const ids = visibleClientIds(db, me);
  const clients = db.clients.filter((c) => ids.has(c.id) && c.status === 'active');
  const first = clients.find((c) => c.id === clientId) ?? clients[0];
  const [f, setF] = useState<Omit<Engagement, 'id' | 'createdAt' | 'createdBy'> & { id?: string }>(() =>
    existing
      ? structuredClone(existing)
      : {
          clientId: first?.id ?? '',
          serviceLine: 'advisory',
          type: 'one_time',
          title: '',
          financialYear: fyLabel(fyStartYear(today())),
          templateCode: 'other',
          status: 'active',
          partnerId: first?.partnerId ?? '',
          managerId: first?.managerId ?? (me.role === 'manager' ? me.id : undefined),
          team: db.clientTeam.filter((a) => a.clientId === first?.id).map((a) => ({ userId: a.userId, role: a.role === 'reviewer' ? 'checker' : 'maker' }) as EngagementMember),
          budgetHours: 10,
          billable: true,
          feeBasis: null,
          startDate: today(),
          endDate: addDays(today(), 30),
        },
  );
  const [err, setErr] = useState('');

  if (!can.manageEngagements(me.role)) {
    return (
      <div>
        <PageHead title="Engagement" back />
        <div className="card"><Empty>Managers, Partners and Admin create engagements.</Empty></div>
      </div>
    );
  }
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const pickClient = (cid: string) => {
    const c = db.clients.find((x) => x.id === cid)!;
    setF((x) => ({
      ...x,
      clientId: cid,
      partnerId: c.partnerId,
      managerId: c.managerId,
      team: db.clientTeam.filter((a) => a.clientId === cid).map((a) => ({ userId: a.userId, role: a.role === 'reviewer' ? 'checker' : 'maker' })),
    }));
  };
  const pool = db.users.filter((u) => u.active && (u.role === 'staff' || u.role === 'article' || u.role === 'manager'));
  const setMember = (userId: string, role: EngagementMember['role'] | null) =>
    setF((x) => ({ ...x, team: role ? [...x.team.filter((m) => m.userId !== userId), { userId, role }] : x.team.filter((m) => m.userId !== userId) }));

  const submit = () => {
    if (!f.clientId) return setErr('Choose a client.');
    if (!f.title.trim()) return setErr('Give the engagement a title, e.g. "Statutory Audit FY 2025-26".');
    if (!f.team.some((m) => m.role === 'maker')) return setErr('Assign at least one team member as maker.');
    if (f.endDate && f.startDate && f.endDate < f.startDate) return setErr('Target date is before the start date.');
    const newId = save({ ...f, title: f.title.trim() });
    notify(existing ? 'Engagement updated' : 'Engagement created');
    navigate({ name: 'engagement', id: newId });
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <PageHead back title={existing ? 'Edit engagement' : 'New engagement'} sub="Team members you add here are added to the client team automatically." />
      <section className="card stack">
        <Field label="Client" htmlFor="e-client">
          <select id="e-client" className="input" value={f.clientId} onChange={(e) => pickClient(e.target.value)} disabled={!!existing}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Title" htmlFor="e-title">
          <input id="e-title" className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Reply to ASMT-10 notice — FY 2024-25" />
        </Field>
        <div className="grid-2">
          <Field label="Service line" htmlFor="e-sl">
            <select id="e-sl" className="input" value={f.serviceLine} onChange={(e) => { const sl = e.target.value as ServiceLine; setF((x) => ({ ...x, serviceLine: sl, templateCode: existing ? x.templateCode : TEMPLATE_FOR[sl] })); }}>
              {(Object.keys(SERVICE_LINE_LABEL) as ServiceLine[]).map((k) => <option key={k} value={k}>{SERVICE_LINE_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Stage template" htmlFor="e-tpl">
            <select id="e-tpl" className="input" value={f.templateCode} onChange={(e) => set('templateCode', e.target.value)}>
              {db.templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="small muted">Stages: {db.templates.find((t) => t.code === f.templateCode)?.stages.join(' → ')}</div>
        <div className="grid-2">
          <Field label="Financial year" htmlFor="e-fy">
            <input id="e-fy" className="input" value={f.financialYear ?? ''} onChange={(e) => set('financialYear', e.target.value)} />
          </Field>
          <Field label={f.type === 'recurring' ? 'Engagement Budget per period (hours)' : 'Engagement Budget (hours)'} hint="A signal, never a cap" htmlFor="e-budget">
            <input id="e-budget" className="input" type="number" min={0} step={0.25} value={f.budgetHours ?? ''} onChange={(e) => set('budgetHours', e.target.value ? Number(e.target.value) : undefined)} />
          </Field>
        </div>
        {f.type === 'one_time' && (
          <div className="grid-2">
            <Field label="Start date" htmlFor="e-start">
              <input id="e-start" className="input" type="date" value={f.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="Target / due date" hint="Shows on the compliance calendar" htmlFor="e-end">
              <input id="e-end" className="input" type="date" value={f.endDate ?? ''} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
          </div>
        )}
        {can.seeBilling(me.role) && (
          <div className="field">
            <span className="label">Billable</span>
            <Seg value={f.billable ? 'y' : 'n'} onChange={(v) => set('billable', v === 'y')} options={[{ value: 'y', label: 'Chargeable' }, { value: 'n', label: 'Non-chargeable' }]} />
            <span className="hint">Set by the Partner. Never shown to Staff or Article Assistants.</span>
          </div>
        )}
        {can.seeBilling(me.role) && (
          <div className="field">
            <span className="label">Fee basis</span>
            <Seg<string>
              value={f.feeBasis?.type ?? 'none'}
              onChange={(v) => set('feeBasis', v === 'none' ? null : { type: v as 'fixed' | 'recurring' | 'time', amount: v === 'time' ? null : f.feeBasis?.amount ?? null, rate: v === 'time' ? f.feeBasis?.rate ?? null : null, retainerPeriod: v === 'recurring' ? f.feeBasis?.retainerPeriod ?? 'monthly' : null })}
              options={[{ value: 'none', label: 'Not set' }, { value: 'fixed', label: 'Fixed' }, { value: 'recurring', label: 'Retainer' }, { value: 'time', label: 'Time-based' }]}
            />
            {f.feeBasis && f.feeBasis.type !== 'time' && (
              <div className="grid-2">
                <Field label={f.feeBasis.type === 'fixed' ? 'Fee (₹, excl. GST)' : 'Retainer per period (₹, excl. GST)'} htmlFor="e-fee">
                  <input id="e-fee" className="input" type="number" min={0} step={100} value={f.feeBasis.amount ?? ''} onChange={(e) => set('feeBasis', { ...f.feeBasis!, amount: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                {f.feeBasis.type === 'recurring' && (
                  <Field label="Period" htmlFor="e-period">
                    <select id="e-period" className="input" value={f.feeBasis.retainerPeriod ?? 'monthly'} onChange={(e) => set('feeBasis', { ...f.feeBasis!, retainerPeriod: e.target.value as 'monthly' | 'quarterly' | 'annual' })}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </Field>
                )}
              </div>
            )}
            {f.feeBasis?.type === 'time' && (
              <Field label="Rate (₹ per hour)" htmlFor="e-rate">
                <input id="e-rate" className="input" type="number" min={0} step={50} value={f.feeBasis.rate ?? ''} onChange={(e) => set('feeBasis', { ...f.feeBasis!, rate: e.target.value ? Number(e.target.value) : null })} />
              </Field>
            )}
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Team</h2>
        <div className="grid-2">
          <Field label="Partner" htmlFor="e-partner">
            <select id="e-partner" className="input" value={f.partnerId} onChange={(e) => set('partnerId', e.target.value)}>
              {db.users.filter((u) => u.role === 'partner').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Manager" htmlFor="e-manager">
            <select id="e-manager" className="input" value={f.managerId ?? ''} onChange={(e) => set('managerId', e.target.value || undefined)}>
              <option value="">—</option>
              {db.users.filter((u) => u.role === 'manager').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="card flush list">
          {pool.map((u) => {
            const m = f.team.find((x) => x.userId === u.id);
            return (
              <div key={u.id} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 140 }}>
                  <div className="small strong">{u.name}</div>
                  <div className="xs muted">{u.designation}</div>
                </div>
                <Seg<string>
                  value={m ? m.role : 'none'}
                  onChange={(v) => setMember(u.id, v === 'none' ? null : (v as EngagementMember['role']))}
                  options={[{ value: 'none', label: '—' }, { value: 'maker', label: 'Maker' }, ...(u.role !== 'article' ? [{ value: 'checker', label: 'Checker' }] : [])]}
                />
              </div>
            );
          })}
        </div>
        <div className="xs muted">Article Assistants are always makers, never checkers.</div>
      </section>
      {err && <div className="form-error">{err}</div>}
      <button className="btn primary lg" onClick={submit}>{existing ? 'Save engagement' : 'Create engagement'}</button>
    </div>
  );
}
