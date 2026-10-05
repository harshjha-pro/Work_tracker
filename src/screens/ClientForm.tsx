import { useMemo, useState } from 'react';
import { useApp, useMe, type ClientInput } from '../store';
import type { ComplianceProfile, Constitution, GstFrequency, TeamAssignment } from '../lib/types';
import { can } from '../lib/access';
import { derivedFlags, planClientSync } from '../lib/compliance';
import { CONSTITUTION_LABEL, GST_FREQ_LABEL } from '../lib/master';
import { emptyProfile } from '../lib/seed';
import { fmtDate } from '../lib/dates';
import { cx, GSTIN_RE, PAN_RE, TAN_RE, groupBy } from '../lib/util';
import { Empty, Field, PageHead, Seg } from '../components/ui';

type BoolFlag = Exclude<keyof ComplianceProfile, 'gstFrequency'>;
const FLAGS: { key: BoolFlag; label: string; hint: string; needsGst?: boolean }[] = [
  { key: 'gstAnnualReturn', label: 'GSTR-9 annual return', hint: 'Due 31 Dec after FY end', needsGst: true },
  { key: 'gst9c', label: 'GSTR-9C reconciliation', hint: 'Turnover above the 9C threshold', needsGst: true },
  { key: 'tds', label: 'TDS / TCS', hint: 'Monthly payment + quarterly returns' },
  { key: 'advanceTax', label: 'Advance tax', hint: '15 Jun / Sep / Dec / Mar instalments' },
  { key: 'taxAudit', label: 'Tax audit (44AB)', hint: 'Tax audit report; ITR moves to 31 Oct' },
  { key: 'statutoryAudit', label: 'Statutory audit', hint: 'Audit report; ITR moves to 31 Oct' },
  { key: 'transferPricing', label: 'Transfer pricing', hint: 'Recorded on the profile (no recurring task in V1 master)' },
  { key: 'pf', label: 'PF', hint: '15th of following month' },
  { key: 'esi', label: 'ESI', hint: '15th of following month' },
];

export function ClientForm({ id }: { id?: string }) {
  const me = useMe()!;
  const db = useApp((s) => s.db);
  const saveClient = useApp((s) => s.saveClient);
  const navigate = useApp((s) => s.navigate);
  const notify = useApp((s) => s.notify);
  const existing = id ? db.clients.find((c) => c.id === id) : undefined;

  const [f, setF] = useState<ClientInput>(() =>
    existing
      ? { ...structuredClone(existing), team: db.clientTeam.filter((a) => a.clientId === existing.id) }
      : {
          name: '',
          group: '',
          constitution: 'private_company',
          status: 'active',
          gstins: [],
          fyEnd: '31 Mar',
          booksBy: 'firm',
          partnerId: db.users.find((u) => u.role === 'partner')!.id,
          managerId: db.users.find((u) => u.role === 'manager')?.id,
          profile: emptyProfile(),
          team: [],
        },
  );
  const [gstText, setGstText] = useState((existing?.gstins ?? []).join(', '));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof ClientInput>(k: K, v: ClientInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const setFlag = <K extends keyof ComplianceProfile>(k: K, v: ComplianceProfile[K]) => setF((x) => ({ ...x, profile: { ...x.profile, [k]: v } }));
  const derived = derivedFlags(f);
  const isCompany = derived.isCompany === 'true';
  const isLLP = derived.isLLP === 'true';
  const gstOn = f.profile.gstFrequency !== 'not_applicable';

  const plan = useMemo(() => planClientSync(db, { id: existing?.id ?? '__new__', constitution: f.constitution, profile: f.profile, status: f.status, agmDate: f.agmDate }), [db, existing?.id, f.constitution, f.profile, f.status, f.agmDate]);
  const createdByType = groupBy(plan.create, (p) => p.type.code);

  if (!can.editClientMaster(me.role)) {
    return (
      <div>
        <PageHead title="Client" back />
        <div className="card"><Empty>Only Practice Admin and Partners maintain the client master.</Empty></div>
      </div>
    );
  }


  const staffPool = db.users.filter((u) => u.role === 'staff' || u.role === 'article' || u.role === 'manager');
  const toggleMember = (userId: string, role: TeamAssignment['role'] | null) =>
    setF((x) => ({ ...x, team: role ? [...x.team.filter((a) => a.userId !== userId), { clientId: x.id ?? '', userId, role }] : x.team.filter((a) => a.userId !== userId) }));

  const submit = () => {
    const e: Record<string, string> = {};
    const gstins = gstText.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (!f.name.trim()) e.name = 'Client name is required.';
    if (f.pan && !PAN_RE.test(f.pan)) e.pan = 'PAN should look like AAAAA9999A.';
    if (f.tan && !TAN_RE.test(f.tan)) e.tan = 'TAN should look like AAAA99999A.';
    const badGst = gstins.find((g) => !GSTIN_RE.test(g));
    if (badGst) e.gstins = `${badGst} is not a valid 15-character GSTIN.`;
    if (gstOn && !gstins.length) e.gstins = 'Add the GSTIN for a GST-registered client.';
    if (isCompany && !f.cin) e.cin = 'Add the CIN for a company.';
    if (!f.partnerId) e.partnerId = 'Assign a Partner.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const r = saveClient({ ...f, name: f.name.trim(), gstins, pan: f.pan?.toUpperCase() || undefined, tan: f.tan?.toUpperCase() || undefined });
    const parts = [r.created && `${r.created} compliance task${r.created === 1 ? '' : 's'} created`, (r.removed + r.markedNA) && `${r.removed + r.markedNA} removed`, r.moved && `${r.moved} moved`].filter(Boolean);
    notify(`Client saved${parts.length ? ` · ${parts.join(' · ')}` : ''}`);
    navigate({ name: 'client', id: r.clientId, tab: 'compliance' });
  };

  return (
    <div className="stack-lg">
      <PageHead back title={existing ? `Edit ${existing.code}` : 'New client'} sub={existing ? existing.name : 'Client code is assigned when you save'} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack-lg">
          <section className="card stack">
            <h2>Client</h2>
            <Field label="Client name" error={errors.name} htmlFor="c-name">
              <input id="c-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sahyadri Auto Components Pvt Ltd" />
            </Field>
            <Field label="Group (related entities)" hint="Family or promoter group, optional" htmlFor="c-group">
              <input id="c-group" className="input" value={f.group ?? ''} onChange={(e) => set('group', e.target.value)} />
            </Field>
            <div className="grid-2">
              <Field label="Constitution" htmlFor="c-const">
                <select id="c-const" className="input" value={f.constitution} onChange={(e) => set('constitution', e.target.value as Constitution)}>
                  {(Object.keys(CONSTITUTION_LABEL) as Constitution[]).map((k) => (
                    <option key={k} value={k}>{CONSTITUTION_LABEL[k]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status" htmlFor="c-status">
                <select id="c-status" className="input" value={f.status} onChange={(e) => set('status', e.target.value as ClientInput['status'])}>
                  <option value="active">Active</option>
                  <option value="dormant">Dormant</option>
                  <option value="discontinued">Discontinued</option>
                </select>
              </Field>
            </div>
            <div className="grid-2">
              <Field label="Financial year ends" hint="Indian FY (April–March)">
                <input className="input" value="31 March" disabled />
              </Field>
              <div className="field">
                <span className="label">Books maintained by</span>
                <Seg block value={f.booksBy} onChange={(v) => set('booksBy', v)} options={[{ value: 'firm', label: 'Firm' }, { value: 'client', label: 'Client' }]} />
              </div>
            </div>
            {isCompany && (
              <Field label="AGM date (last held / scheduled)" hint="AOC-4 and MGT-7 due dates are calculated from this" htmlFor="c-agm">
                <input id="c-agm" className="input" type="date" value={f.agmDate ?? ''} onChange={(e) => set('agmDate', e.target.value || undefined)} />
              </Field>
            )}
          </section>

          <section className="card stack">
            <h2>Identifiers</h2>
            <div className="grid-2">
              <Field label="PAN" error={errors.pan} htmlFor="c-pan">
                <input id="c-pan" className="input mono" maxLength={10} value={f.pan ?? ''} onChange={(e) => set('pan', e.target.value.toUpperCase())} />
              </Field>
              <Field label="TAN" error={errors.tan} htmlFor="c-tan">
                <input id="c-tan" className="input mono" maxLength={10} value={f.tan ?? ''} onChange={(e) => set('tan', e.target.value.toUpperCase())} />
              </Field>
            </div>
            <Field label="GSTIN(s)" hint="One per state; separate with commas" error={errors.gstins} htmlFor="c-gst">
              <input id="c-gst" className="input mono" value={gstText} onChange={(e) => setGstText(e.target.value.toUpperCase())} />
            </Field>
            <div className="grid-2">
              <Field label={isLLP ? 'LLPIN' : 'CIN'} error={errors.cin} htmlFor="c-cin">
                <input id="c-cin" className="input mono" value={f.cin ?? ''} onChange={(e) => set('cin', e.target.value.toUpperCase())} disabled={!isCompany && !isLLP} placeholder={!isCompany && !isLLP ? 'Not applicable' : ''} />
              </Field>
              <Field label="Udyam number" htmlFor="c-udyam">
                <input id="c-udyam" className="input mono" value={f.udyam ?? ''} onChange={(e) => set('udyam', e.target.value.toUpperCase())} />
              </Field>
            </div>
          </section>

          <section className="card stack">
            <h2>Applicability flags</h2>
            <p className="muted small">These drive the compliance calendar. Changes apply from today forward.</p>
            <div className="field">
              <span className="label">GST</span>
              <Seg
                block
                value={f.profile.gstFrequency}
                onChange={(v) => setFlag('gstFrequency', v as GstFrequency)}
                options={(['not_applicable', 'monthly', 'qrmp', 'composition'] as GstFrequency[]).map((k) => ({ value: k, label: GST_FREQ_LABEL[k].replace(' (quarterly)', '') }))}
              />
            </div>
            <div className="stack-sm">
              {FLAGS.filter((x) => !x.needsGst || gstOn).map((x) => (
                <label key={x.key} className={cx('check', f.profile[x.key] && 'on')}>
                  <input type="checkbox" checked={f.profile[x.key]} onChange={(e) => setFlag(x.key, e.target.checked)} />
                  <span className="stack-sm" style={{ gap: 0 }}>
                    <span className="strong">{x.label}</span>
                    <span className="xs muted">{x.hint}</span>
                  </span>
                </label>
              ))}
              <div className={cx('check', (isCompany || isLLP) && 'on')} style={{ cursor: 'default' }}>
                <input type="checkbox" checked={isCompany || isLLP} disabled readOnly />
                <span className="stack-sm" style={{ gap: 0 }}>
                  <span className="strong">{isLLP ? 'LLP — ROC filings' : 'Company — ROC filings'}</span>
                  <span className="xs muted">
                    {isCompany ? 'AOC-4, MGT-7, DPT-3 and DIR-3 KYC — set by constitution' : isLLP ? 'Form 11 and Form 8 — set by constitution' : 'Applies automatically when the constitution is a company or LLP'}
                  </span>
                </span>
              </div>
            </div>
          </section>

          <section className="card stack">
            <h2>Team</h2>
            <div className="grid-2">
              <Field label="Partner" error={errors.partnerId} htmlFor="c-partner">
                <select id="c-partner" className="input" value={f.partnerId} onChange={(e) => set('partnerId', e.target.value)}>
                  {db.users.filter((u) => u.role === 'partner').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Manager" htmlFor="c-manager">
                <select id="c-manager" className="input" value={f.managerId ?? ''} onChange={(e) => set('managerId', e.target.value || undefined)}>
                  <option value="">—</option>
                  {db.users.filter((u) => u.role === 'manager').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="field">
              <span className="label">Client team</span>
              <span className="hint">Staff and Article Assistants only see clients they're on.</span>
              <div className="card flush list">
                {staffPool.filter((u) => u.id !== f.managerId).map((u) => {
                  const a = f.team.find((x) => x.userId === u.id);
                  return (
                    <div key={u.id} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                      <div className="grow" style={{ minWidth: 140 }}>
                        <div className="small strong">{u.name}</div>
                        <div className="xs muted">{u.designation}</div>
                      </div>
                      <Seg<string>
                        value={a ? a.role : 'none'}
                        onChange={(v) => toggleMember(u.id, v === 'none' ? null : (v as TeamAssignment['role']))}
                        options={[{ value: 'none', label: 'Not on team' }, { value: 'staff', label: 'Team' }, ...(u.role !== 'article' ? [{ value: 'reviewer', label: 'Reviewer' }] : [])]}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="card stack">
            <h2>Primary contact</h2>
            <Field label="Name" htmlFor="c-cname">
              <input id="c-cname" className="input" value={f.contactName ?? ''} onChange={(e) => set('contactName', e.target.value)} />
            </Field>
            <div className="grid-2">
              <Field label="Phone" htmlFor="c-phone">
                <input id="c-phone" className="input" value={f.contactPhone ?? ''} onChange={(e) => set('contactPhone', e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="c-email">
                <input id="c-email" className="input" type="email" value={f.contactEmail ?? ''} onChange={(e) => set('contactEmail', e.target.value)} />
              </Field>
            </div>
          </section>
        </div>

        <aside className="stack" style={{ position: 'sticky', top: 80 }}>
          <section className="card stack">
            <div>
              <div className="eyebrow">Compliance calendar preview</div>
              <h2 style={{ marginTop: 4 }}>
                {plan.create.length ? `${plan.create.length} task${plan.create.length === 1 ? '' : 's'} will be created` : 'No new tasks'}
              </h2>
              <p className="muted small">From today through the next 120 days, based on the flags and the Due-Date Master.</p>
            </div>
            {Object.entries(createdByType).map(([code, items]) => (
              <div key={code} className="row between small">
                <span className="grow ellipsis">{items[0].type.name}</span>
                <span className="muted nowrap">
                  {items.length} · next {fmtDate(items[0].period.due)}
                </span>
              </div>
            ))}
            {(plan.remove.length > 0 || plan.markNA.length > 0) && (
              <div className="notice warn small">
                {plan.remove.length + plan.markNA.length} open task{plan.remove.length + plan.markNA.length === 1 ? '' : 's'} no longer apply and will be{' '}
                {plan.markNA.length ? `removed (${plan.markNA.length} with work already logged are kept as Not Applicable)` : 'removed'}.
              </div>
            )}
            {f.status !== 'active' && <div className="notice small">Dormant and discontinued clients get no new compliance tasks.</div>}
          </section>
          <button className="btn primary lg block" onClick={submit}>
            {existing ? 'Save client' : 'Create client'}
          </button>
          {Object.keys(errors).length > 0 && <div className="form-error">Fix the highlighted fields to save.</div>}
        </aside>
      </div>
    </div>
  );
}
