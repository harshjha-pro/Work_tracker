import { useMemo, useState } from 'react';
import { useApp, useMe, type ClientInput } from '../store';
import type { ComplianceProfile, Constitution, Director, GstFrequency, GstRegistration, TeamAssignment } from '../lib/types';
import { can } from '../lib/access';
import { derivedFlags, planClientSync } from '../lib/compliance';
import { CONSTITUTION_LABEL, GST_FREQ_LABEL } from '../lib/master';
import { emptyProfile } from '../lib/seed';
import { fmtDate, nowIso, today } from '../lib/dates';
import { GST_STATES } from '../lib/migrations/migrate_v4_to_v5.js';
import { cx, GSTIN_RE, PAN_RE, TAN_RE, groupBy, uid } from '../lib/util';
import { Empty, Field, PageHead, Seg } from '../components/ui';

type BoolFlag = keyof ComplianceProfile;
const FLAGS: { key: BoolFlag; label: string; hint: string; underTds?: boolean }[] = [
  { key: 'tds', label: 'TDS', hint: 'Monthly TDS payment (7th; March: 30 April)' },
  { key: 'tdsSalary', label: 'Salary — Form 24Q', hint: 'Quarterly: 31 Jul, 31 Oct, 31 Jan, 31 May', underTds: true },
  { key: 'tdsNonSalary', label: 'Non-salary — Form 26Q', hint: 'Quarterly: 31 Jul, 31 Oct, 31 Jan, 31 May', underTds: true },
  { key: 'tdsNonResident', label: 'Non-resident payments — Form 27Q', hint: 'Quarterly: 31 Jul, 31 Oct, 31 Jan, 31 May', underTds: true },
  { key: 'tcs', label: 'TCS — Form 27EQ', hint: 'Quarterly: 15 Jul, 15 Oct, 15 Jan, 15 May' },
  { key: 'advanceTax', label: 'Advance tax', hint: '15 Jun / Sep / Dec / Mar instalments' },
  { key: 'taxAudit', label: 'Tax audit (44AB)', hint: 'Tax audit report; ITR moves to 31 Oct' },
  { key: 'statutoryAudit', label: 'Statutory audit', hint: 'Audit report; ITR moves to 31 Oct' },
  { key: 'transferPricing', label: 'Transfer pricing', hint: 'Form 3CEB (31 Oct); ITR for audit cases moves to 30 Nov' },
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
          directors: [],
          complianceStartDates: {},
          statusEffectiveFrom: null,
          auditorAppointmentDate: null,
          fyEnd: '31 Mar',
          booksBy: 'firm',
          partnerId: db.users.find((u) => u.role === 'partner')!.id,
          managerId: db.users.find((u) => u.role === 'manager')?.id,
          profile: emptyProfile(),
          team: [],
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof ClientInput>(k: K, v: ClientInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const setFlag = <K extends keyof ComplianceProfile>(k: K, v: ComplianceProfile[K]) => setF((x) => ({ ...x, profile: { ...x.profile, [k]: v } }));
  const derived = derivedFlags(f);
  const isCompany = derived.isCompany === 'true';
  const isLLP = derived.isLLP === 'true';

  const plan = useMemo(
    () => planClientSync(db, { ...f, id: existing?.id ?? '__new__', complianceStartDates: existing?.complianceStartDates ?? {} }),
    [db, existing, f],
  );
  const createdByType = groupBy(plan.create, (p) => p.type.code);

  if (!can.editClientMaster(me.role)) {
    return (
      <div>
        <PageHead title="Client" back />
        <div className="card"><Empty>Only Practice Admin and Partners maintain the client master.</Empty></div>
      </div>
    );
  }


  const staffPool = db.users.filter((u) => u.active && (u.role === 'staff' || u.role === 'article' || u.role === 'manager'));
  const toggleMember = (userId: string, role: TeamAssignment['role'] | null) =>
    setF((x) => ({ ...x, team: role ? [...x.team.filter((a) => a.userId !== userId), { clientId: x.id ?? '', userId, role }] : x.team.filter((a) => a.userId !== userId) }));

  // A19 — GST registrations
  const setGst = (gid: string, patch: Partial<GstRegistration>) =>
    setF((x) => ({
      ...x,
      gstins: x.gstins.map((g) => {
        if (g.id !== gid) return g;
        const next = { ...g, ...patch };
        if (patch.gstin) {
          next.stateCode = patch.gstin.slice(0, 2);
          next.state = (GST_STATES as Record<string, string>)[next.stateCode] ?? 'Unknown';
        }
        if (patch.frequency && patch.frequency !== g.frequency) {
          const was = existing?.gstins.find((o) => o.id === gid);
          next.effectiveFrom = today();
          next.frequencyHistory = [...(was?.frequencyHistory ?? []), { frequency: patch.frequency, effectiveFrom: today(), changedBy: me.id, changedAt: nowIso() }];
        }
        return next;
      }),
    }));
  const addGst = () =>
    setF((x) => ({
      ...x,
      gstins: [
        ...x.gstins,
        { id: uid(), gstin: '', stateCode: '', state: '', frequency: 'monthly', effectiveFrom: today(), frequencyHistory: [{ frequency: 'monthly', effectiveFrom: today(), changedBy: me.id, changedAt: nowIso() }], gstAnnualReturn: false, gst9c: false, iffOpted: false, status: 'active', cancelledOn: null },
      ],
    }));
  // A20 — directors
  const setDir = (did: string, patch: Partial<Director>) => setF((x) => ({ ...x, directors: x.directors.map((d) => (d.id === did ? { ...d, ...patch } : d)) }));
  const addDir = () =>
    setF((x) => ({ ...x, directors: [...x.directors, { id: uid(), name: '', din: '', designation: isLLP ? 'designated_partner' : 'director', dscId: null, appointedOn: null, ceasedOn: null, active: true }] }));

  const submit = () => {
    const e: Record<string, string> = {};
    const gstins = f.gstins.map((g) => ({ ...g, gstin: g.gstin.trim().toUpperCase() })).filter((g) => g.gstin);
    if (!f.name.trim()) e.name = 'Client name is required.';
    if (f.pan && !PAN_RE.test(f.pan)) e.pan = 'PAN should look like AAAAA9999A.';
    if (f.tan && !TAN_RE.test(f.tan)) e.tan = 'TAN should look like AAAA99999A.';
    const badGst = gstins.find((g) => !GSTIN_RE.test(g.gstin));
    if (badGst) e.gstins = `${badGst.gstin} is not a valid 15-character GSTIN.`;
    if (new Set(gstins.map((g) => g.gstin)).size !== gstins.length) e.gstins = 'The same GSTIN is listed twice.';
    const directors = f.directors.filter((d) => d.name.trim() || d.din.trim());
    const badDin = directors.find((d) => !/^\d{8}$/.test(d.din));
    if (badDin) e.directors = `DIN for ${badDin.name || 'a director'} must be 8 digits.`;
    if (isCompany && !f.cin) e.cin = 'Add the CIN for a company.';
    if (!f.partnerId) e.partnerId = 'Assign a Partner.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const r = saveClient({ ...f, name: f.name.trim(), gstins, directors, pan: f.pan?.toUpperCase() || undefined, tan: f.tan?.toUpperCase() || undefined });
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
              <div className="grid-2">
                <Field label="AGM date (last held / scheduled)" hint="AOC-4 and MGT-7 are calculated from this" htmlFor="c-agm">
                  <input id="c-agm" className="input" type="date" value={f.agmDate ?? ''} onChange={(e) => set('agmDate', e.target.value || undefined)} />
                </Field>
                <Field label="Auditor appointment date" hint="ADT-1 due 15 days after; defaults to the AGM" htmlFor="c-adt">
                  <input id="c-adt" className="input" type="date" value={f.auditorAppointmentDate ?? ''} onChange={(e) => set('auditorAppointmentDate', e.target.value || null)} />
                </Field>
              </div>
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
            <div className="section-head">
              <h2>GST registrations</h2>
              <button className="btn sm" onClick={addGst}>Add GSTIN</button>
            </div>
            <p className="muted small">Each GSTIN files on its own frequency; GST tasks are generated per registration.</p>
            {f.gstins.length === 0 && <div className="muted small">Not registered under GST.</div>}
            {f.gstins.map((g, i) => (
              <div key={g.id} className="card stack-sm" style={{ background: 'var(--surface-2)', opacity: g.status === 'cancelled' ? 0.6 : 1 }}>
                <div className="grid-2">
                  <Field label={`GSTIN ${i + 1}${g.state ? ` · ${g.state}` : ''}`} htmlFor={`gst-${g.id}`}>
                    <input id={`gst-${g.id}`} className="input mono" maxLength={15} value={g.gstin} onChange={(e) => setGst(g.id, { gstin: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="Filing frequency" hint={g.effectiveFrom ? `Since ${fmtDate(g.effectiveFrom)}` : undefined} htmlFor={`gstf-${g.id}`}>
                    <select id={`gstf-${g.id}`} className="input" value={g.frequency} onChange={(e) => setGst(g.id, { frequency: e.target.value as GstFrequency })}>
                      {(['monthly', 'qrmp', 'composition', 'not_set'] as GstFrequency[]).map((k) => <option key={k} value={k}>{GST_FREQ_LABEL[k]}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="row-wrap">
                  {g.frequency !== 'composition' && (
                    <label className="row small"><input type="checkbox" checked={g.gstAnnualReturn} onChange={(e) => setGst(g.id, { gstAnnualReturn: e.target.checked })} /> GSTR-9</label>
                  )}
                  {g.frequency !== 'composition' && (
                    <label className="row small"><input type="checkbox" checked={g.gst9c} onChange={(e) => setGst(g.id, { gst9c: e.target.checked })} /> GSTR-9C</label>
                  )}
                  {g.frequency === 'qrmp' && (
                    <label className="row small"><input type="checkbox" checked={g.iffOpted} onChange={(e) => setGst(g.id, { iffOpted: e.target.checked })} /> IFF opted</label>
                  )}
                  <label className="row small">
                    <input type="checkbox" checked={g.status === 'cancelled'} onChange={(e) => setGst(g.id, { status: e.target.checked ? 'cancelled' : 'active', cancelledOn: e.target.checked ? today() : null })} /> Cancelled
                  </label>
                  {!existing?.gstins.some((o) => o.id === g.id) && (
                    <button className="btn ghost sm" onClick={() => setF((x) => ({ ...x, gstins: x.gstins.filter((y) => y.id !== g.id) }))}>Remove</button>
                  )}
                </div>
              </div>
            ))}
            {errors.gstins && <span className="err small">{errors.gstins}</span>}
          </section>

          {(isCompany || isLLP) && (
            <section className="card stack">
              <div className="section-head">
                <h2>{isLLP ? 'Designated partners' : 'Directors'}</h2>
                <button className="btn sm" onClick={addDir}>Add</button>
              </div>
              <p className="muted small">DIR-3 KYC is generated for each active director with a DIN.</p>
              {f.directors.map((d) => (
                <div key={d.id} className="row-wrap" style={{ alignItems: 'flex-end', opacity: d.active ? 1 : 0.6 }}>
                  <Field label="Name" htmlFor={`dn-${d.id}`}>
                    <input id={`dn-${d.id}`} className="input" value={d.name} onChange={(e) => setDir(d.id, { name: e.target.value })} />
                  </Field>
                  <Field label="DIN" htmlFor={`dd-${d.id}`}>
                    <input id={`dd-${d.id}`} className="input mono" maxLength={8} style={{ width: 120 }} value={d.din} onChange={(e) => setDir(d.id, { din: e.target.value.replace(/\D/g, '') })} />
                  </Field>
                  <label className="row small" style={{ paddingBottom: 10 }}>
                    <input type="checkbox" checked={d.active} onChange={(e) => setDir(d.id, { active: e.target.checked, ceasedOn: e.target.checked ? null : today() })} /> Active
                  </label>
                </div>
              ))}
              {errors.directors && <span className="err small">{errors.directors}</span>}
            </section>
          )}

          <section className="card stack">
            <h2>Applicability flags</h2>
            <p className="muted small">These drive the compliance calendar. Changes apply from today forward.</p>
            <div className="stack-sm">
              {FLAGS.filter((x) => !x.underTds || f.profile.tds).map((x) => (
                <label key={x.key} className={cx('check', f.profile[x.key] && 'on')} style={x.underTds ? { marginLeft: 24 } : undefined}>
                  <input
                    type="checkbox"
                    checked={f.profile[x.key] || (x.key === 'statutoryAudit' && isCompany)}
                    disabled={x.key === 'statutoryAudit' && isCompany}
                    onChange={(e) => setFlag(x.key, e.target.checked)}
                  />
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
                    {isCompany ? 'AOC-4, MGT-7, ADT-1, DPT-3 and DIR-3 KYC (per director) — set by constitution; statutory audit is mandatory' : isLLP ? 'Form 11 and Form 8 — set by constitution' : 'Applies automatically when the constitution is a company or LLP'}
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
