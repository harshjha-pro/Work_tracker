import { useEffect, useState, type ReactNode } from 'react';
import { useApp, useMe, type Route } from './store';
import { can } from './lib/access';
import { ROLE_LABEL } from './lib/master';
import { cx } from './lib/util';
import { Avatar, Icon, Toast } from './components/ui';
import { UserSwitcher } from './components/UserSwitcher';
import { EntrySheet } from './screens/EntrySheet';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { Work } from './screens/Work';
import { Tasks } from './screens/Tasks';
import { TaskDetail } from './screens/TaskDetail';
import { CalendarScreen } from './screens/Calendar';
import { Clients } from './screens/Clients';
import { ClientDetail } from './screens/ClientDetail';
import { ClientForm } from './screens/ClientForm';
import { Engagements } from './screens/Engagements';
import { EngagementDetail } from './screens/EngagementDetail';
import { EngagementForm } from './screens/EngagementForm';
import { DueDateMaster } from './screens/DueDateMaster';
import { TeamWeek } from './screens/TeamWeek';
import { Settings } from './screens/Settings';
import { Templates } from './screens/Templates';
import { AuditTrail } from './screens/AuditTrail';
import { More } from './screens/More';

interface NavItem {
  route: Route['name'];
  label: string;
  icon: () => ReactNode;
}

export function navFor(role: Parameters<typeof can.viewTeam>[0]) {
  const main: NavItem[] = [
    { route: 'home', label: 'Home', icon: Icon.home },
    { route: 'work', label: 'Work', icon: Icon.work },
    { route: 'tasks', label: 'My Tasks', icon: Icon.tasks },
    { route: 'calendar', label: 'Calendar', icon: Icon.calendar },
  ];
  const practice: NavItem[] = [];
  if (can.viewTeam(role)) practice.push({ route: 'team', label: 'This Week', icon: Icon.team });
  practice.push({ route: 'clients', label: role === 'admin' ? 'Client Master' : role === 'staff' || role === 'article' ? 'My Clients' : 'Clients', icon: Icon.clients });
  practice.push({ route: 'engagements', label: 'Engagements', icon: Icon.engagements });
  const admin: NavItem[] = [];
  if (can.editDueDateMaster(role)) admin.push({ route: 'master', label: 'Due-Date Master', icon: Icon.master });
  if (can.editTemplates(role)) admin.push({ route: 'templates', label: 'Stage Templates', icon: Icon.templates });
  if (can.setLockTime(role)) admin.push({ route: 'settings', label: 'Weekly Lock', icon: Icon.settings });
  if (can.viewAudit(role)) admin.push({ route: 'audit', label: 'Audit Trail', icon: Icon.audit });
  return { main, practice, admin };
}

const TITLES: Partial<Record<Route['name'], string>> = {
  home: 'Home', work: 'Work', tasks: 'My Tasks', task: 'Task', calendar: 'Calendar', clients: 'Clients', client: 'Client',
  'client-edit': 'Client', engagements: 'Engagements', engagement: 'Engagement', 'engagement-edit': 'Engagement',
  master: 'Due-Date Master', team: 'This Week', settings: 'Weekly Lock', templates: 'Stage Templates', audit: 'Audit Trail', more: 'More',
};

function activeTab(name: Route['name']): Route['name'] {
  if (name === 'task') return 'tasks';
  if (name === 'client' || name === 'client-edit') return 'clients';
  if (name === 'engagement' || name === 'engagement-edit') return 'engagements';
  return name;
}

export default function App() {
  const init = useApp((s) => s.init);
  const bootApp = useApp((s) => s.boot);
  const hydrated = useApp((s) => s.hydrated);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    bootApp()
      .then(() => init())
      .catch((e: unknown) => setBootError(e instanceof Error ? e.message : String(e)));
  }, [bootApp, init]);

  if (!hydrated) return <Booting error={bootError} />;
  return <Shell />;
}

function Booting({ error }: { error: string | null }) {
  return (
    <div className="login">
      <div className="login-inner">
        <div className="brand">
          <span className="brand-mark">QX</span>
          <span>QEPEX India · Work Tracker</span>
        </div>
        {error ? <div className="form-error">The local database could not be opened: {error}</div> : <p className="muted">Opening your data…</p>}
      </div>
    </div>
  );
}

function Shell() {
  const me = useMe();
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const sheet = useApp((s) => s.sheet);
  const openSheet = useApp((s) => s.openSheet);
  const [switcher, setSwitcher] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (!me) return (<><Login /><Toast /></>);

  const nav = navFor(me.role);
  const tab = activeTab(route.name);
  const mobileTabs = nav.main.concat([{ route: 'more', label: 'More', icon: Icon.more }]);
  const inMore = !nav.main.some((n) => n.route === tab);

  const railButton = (n: NavItem) => (
    <button key={n.route} className={cx(tab === n.route && 'active')} onClick={() => navigate({ name: n.route } as Route)}>
      <n.icon />
      {n.label}
    </button>
  );

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <div className="brand">
          <span className="brand-mark">QX</span>
          <span>Work Tracker</span>
        </div>
        {nav.main.map(railButton)}
        <div className="group-label eyebrow">Practice</div>
        {nav.practice.map(railButton)}
        {nav.admin.length > 0 && <div className="group-label eyebrow">Firm settings</div>}
        {nav.admin.map(railButton)}
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">QX</span>
          </div>
          <div className="title grow ellipsis">{TITLES[route.name]}</div>
          <button className="btn primary sm" onClick={() => openSheet({})} aria-label="Add work">
            <Icon.plus /> <span>Add Work</span>
          </button>
          <button className="user-chip" onClick={() => setSwitcher(true)} title="Switch user (testing)">
            <Avatar user={me} size="sm" />
            <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
              <span className="small strong ellipsis">{me.name.replace(/^CA /, '').split(' ')[0]}</span>
              <span className="role-tag ellipsis">{ROLE_LABEL[me.role]}</span>
            </span>
          </button>
        </header>
        <main className="content">
          <Screen route={route} />
        </main>
      </div>
      <nav className="tabbar" aria-label="Tabs">
        {mobileTabs.map((n) => (
          <button key={n.route} className={cx((tab === n.route || (n.route === 'more' && inMore)) && 'active')} onClick={() => navigate({ name: n.route } as Route)}>
            <n.icon />
            {n.label === 'My Tasks' ? 'Tasks' : n.label}
          </button>
        ))}
      </nav>
      {sheet && <EntrySheet key={JSON.stringify(sheet)} />}
      {switcher && <UserSwitcher onClose={() => setSwitcher(false)} />}
      <Toast />
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home': return <Home />;
    case 'work': return <Work date={route.date} view={route.view} />;
    case 'tasks': return <Tasks initialFilter={route.filter} />;
    case 'task': return <TaskDetail id={route.id} />;
    case 'calendar': return <CalendarScreen />;
    case 'clients': return <Clients />;
    case 'client': return <ClientDetail id={route.id} tab={route.tab} />;
    case 'client-edit': return <ClientForm id={route.id} />;
    case 'engagements': return <Engagements />;
    case 'engagement': return <EngagementDetail id={route.id} />;
    case 'engagement-edit': return <EngagementForm id={route.id} clientId={route.clientId} />;
    case 'master': return <DueDateMaster />;
    case 'team': return <TeamWeek />;
    case 'settings': return <Settings />;
    case 'templates': return <Templates />;
    case 'audit': return <AuditTrail />;
    case 'more': return <More />;
  }
}
