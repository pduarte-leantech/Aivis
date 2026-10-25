'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Code2,
  FileCheck2,
  FileSearch,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type { ClinicalCase, Membership } from '@/lib/types';
import { getDemoCases } from '@/lib/demo';
import { Brand, Empty, Modal, Status, date } from './clinical-ui';
import NewCase from './new-case';
import Login from './login';
import Review from './review';
import Team from './team';
import Integrations from './integrations';
import Audit from './audit';
type Tab = 'overview' | 'cases' | 'reports' | 'team' | 'api' | 'audit' | 'settings';
const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'cases', label: 'Casos clínicos', icon: FileSearch },
  { id: 'reports', label: 'Relatórios', icon: FileText },
  { id: 'team', label: 'Equipe médica', icon: Users },
  { id: 'api', label: 'API e integrações', icon: Code2 },
  { id: 'audit', label: 'Auditoria', icon: ShieldCheck },
  { id: 'settings', label: 'Configurações', icon: Settings2 },
];
const fmt = (n: number) => n.toLocaleString('pt-BR');
export default function Platform({ configured }: { configured: boolean }) {
  const [demo, setDemo] = useState(!configured),
    [tab, setTab] = useState<Tab>('overview'),
    [cases, setCases] = useState<ClinicalCase[]>(!configured ? getDemoCases() : []),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [period, setPeriod] = useState('6'),
    [showNew, setShowNew] = useState(false),
    [showLogin, setShowLogin] = useState(false),
    [selected, setSelected] = useState<ClinicalCase | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(configured),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [menu, setMenu] = useState(false),
    [memberships, setMemberships] = useState<Membership[]>([]),
    [tenantId, setTenantId] = useState(''),
    [loggedIn, setLoggedIn] = useState(false),
    [showHelp, setShowHelp] = useState(false),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [stats, setStats] = useState<{
      totals: { cases: number; exams: number; analyzed: number; review: number; approved: number };
      months: { month: string; exams: number; cases: number }[];
    } | null>(null);
  const loadSequence = useRef(0);
  const membership = memberships.find((m) => m.tenant_id === tenantId),
    isAdmin = demo || membership?.role === 'admin',
    canReview =
      demo ||
      !!(membership && membership.role !== 'viewer' && membership.professional_registration);
  const notify = useCallback((message: string) => {
    setToast(message);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const api = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const res = await fetch(`/api/v1/${path}`, {
        ...options,
        headers: {
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
          ...options.headers,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível concluir.');
      return data;
    },
    [tenantId],
  );
  const load = useCallback(async () => {
    if (demo) return;
    const sequence = ++loadSequence.current;
    try {
      const me = await api('me');
      if (sequence !== loadSequence.current) return;
      setMemberships(me.memberships || []);
      setTenantId(me.tenant_id);
      setLoggedIn(true);
      const [list, metrics] = await Promise.all([api(`cases?offset=${offset}`), api('stats')]);
      if (sequence !== loadSequence.current) return;
      setCases(list.cases);
      setTotal(list.total);
      setStats(metrics);
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [api, demo, offset]);
  // Network responses update state asynchronously; the effect starts the external synchronization.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- awaited network synchronization
    void load();
  }, [load]);
  const changeCase = (c: ClinicalCase) => {
    setCases((prev) => [c, ...prev.filter((x) => x.id !== c.id)]);
    setSelected(c);
  };
  const allStats = cases;
  const totalExams = demo
    ? cases.reduce((n, c) => n + (c.exams?.length || 0), 0)
    : stats?.totals.exams || 0;
  const metrics =
    !demo && stats
      ? stats.totals
      : {
          analyzed: allStats.filter((c) => !!c.model).length,
          review: allStats.filter((c) => c.status === 'review').length,
          approved: allStats.filter((c) => c.status === 'approved').length,
        };
  const filtered = cases.filter(
    (c) =>
      (filter === 'all' || c.status === filter) &&
      (tab !== 'reports' || c.status === 'approved') &&
      `${c.patient_name} ${c.patient_code}`
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR')),
  );
  const chart = useMemo(
    () =>
      Array.from({ length: Number(period) }, (_, i) => {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - (Number(period) - 1 - i));
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthCases = allStats.filter((c) => c.created_at.startsWith(ym));
        return {
          label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
          full: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
          cases: monthCases.length,
          exams: demo
            ? monthCases.filter((c) => c.model).reduce((n, c) => n + (c.exams?.length || 0), 0)
            : stats?.months.find((m) => m.month === ym)?.exams || 0,
        };
      }),
    [period, allStats, demo, stats],
  );
  const maxChart = Math.max(4, ...chart.map((m) => m.exams));
  function navigate(t: Tab) {
    setTab(t);
    setSelected(null);
    setFilter('all');
    setSearch('');
    setMenu(false);
  }
  async function logout() {
    const r = await fetch('/api/auth', { method: 'DELETE' });
    if (r.ok) {
      loadSequence.current++;
      setLoggedIn(false);
      setCases([]);
      setStats(null);
      setMemberships([]);
      setError('Sessão encerrada. Entre para continuar.');
    } else notify('Não foi possível encerrar a sessão.');
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Ir para o conteúdo
      </a>
      {menu && (
        <button
          className="sidebar-overlay"
          aria-label="Fechar menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <Brand />
        <div className="workspace">
          <span className="workspace-icon">
            <FlaskConical size={19} />
          </span>
          <div>
            <strong>
              {demo ? 'Clínica demonstração' : membership?.tenants?.name || 'Sua organização'}
            </strong>
            <small>{demo ? 'Ambiente de demonstração' : 'Workspace clínico'}</small>
          </div>
          <ChevronDown size={15} />
          {memberships.length > 1 && (
            <select
              aria-label="Selecionar organização"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setCases([]);
                setStats(null);
                setSelected(null);
                setLoading(true);
                setOffset(0);
              }}
            >
              {memberships.map((m) => (
                <option key={m.tenant_id} value={m.tenant_id}>
                  {m.tenants.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="nav-caption">PLATAFORMA</span>
        <nav aria-label="Navegação principal">
          {tabs.slice(0, 5).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              className={`nav-item ${tab === id ? 'active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === 'cases' && metrics.review > 0 && (
                <span className="nav-count">{metrics.review}</span>
              )}
            </button>
          ))}
        </nav>
        <span className="nav-caption management">GESTÃO</span>
        <nav aria-label="Gestão">
          {tabs.slice(5).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              className={`nav-item ${tab === id ? 'active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={20} />
            <strong>O médico tem a última palavra.</strong>
            <p>IA como apoio. Revisão humana em cada decisão.</p>
            <button onClick={() => setShowHelp(true)}>
              Conheça o fluxo <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="nav-item" onClick={() => setShowHelp(true)}>
            <CircleHelp size={18} />
            Ajuda e documentação <ArrowUpRight size={14} />
          </button>
          <div className="user-profile">
            <span className="avatar">
              {demo
                ? 'MD'
                : (membership?.display_name || 'AC')
                    .split(' ')
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')}
            </span>
            <div>
              <strong>
                {demo ? 'Médico demonstrativo' : membership?.display_name || 'Acesso à plataforma'}
              </strong>
              <small>
                {demo
                  ? 'Perfil de demonstração'
                  : membership?.professional_registration ||
                    membership?.role ||
                    'Autenticação necessária'}
              </small>
            </div>
            <button
              className="icon-btn"
              onClick={() => {
                if (loggedIn) void logout();
                else setShowLogin(true);
              }}
              aria-label={loggedIn ? 'Sair' : 'Entrar'}
            >
              {loggedIn ? <LogOut size={17} /> : <MoreHorizontal size={19} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-btn"
              aria-label="Abrir menu"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{tabs.find((t) => t.id === tab)?.label}</strong>
          </div>
          <div className="top-actions">
            <span className="secure-indicator">
              <i />
              {demo ? 'Dados fictícios' : loggedIn ? 'Sessão autenticada' : 'Acesso restrito'}
            </span>
            <button
              className="icon-btn"
              aria-label="Ver pendências de revisão"
              onClick={() => {
                navigate('cases');
                setFilter('review');
                notify(`${metrics.review} relatório(s) aguardando revisão médica.`);
              }}
            >
              <Bell size={19} />
              {metrics.review > 0 && <b className="notification-dot" />}
            </button>
            <span className="top-separator" />
            <button
              className="top-avatar"
              aria-label="Abrir configurações"
              onClick={() => navigate('settings')}
            >
              {demo ? 'MD' : membership?.display_name?.slice(0, 2).toUpperCase() || 'AC'}
            </button>
          </div>
        </header>
        <main id="main">
          {demo && (
            <div className="demo-banner">
              <span>
                <span className="demo-label">DEMONSTRAÇÃO</span>Explore a plataforma com dados
                fictícios. Nenhuma análise clínica é realizada.
              </span>
              <button onClick={() => setShowLogin(true)}>
                Conectar ambiente <ArrowRight size={14} />
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button onClick={() => (loggedIn ? void load() : setShowLogin(true))}>
                {loggedIn ? 'Tentar novamente' : 'Entrar'}
              </button>
              <button className="icon-btn" aria-label="Dispensar erro" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {selected ? (
            <Review
              key={`${selected.id}-${selected.revision}`}
              c={selected}
              demo={demo}
              canReview={canReview}
              api={api}
              onChange={changeCase}
              onBack={() => setSelected(null)}
              notify={notify}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {tab === 'overview'
                      ? 'SEU WORKSPACE CLÍNICO'
                      : 'AIVIS / ' + tabs.find((t) => t.id === tab)?.label.toUpperCase()}
                  </div>
                  <h1>
                    {tab === 'overview' ? 'Visão geral' : tabs.find((t) => t.id === tab)?.label}
                  </h1>
                  <p>
                    {tab === 'overview'
                      ? 'Uma visão clara da sua operação. Mais tempo para cuidar.'
                      : tab === 'cases'
                        ? 'Do exame à decisão, com todo o contexto em um só lugar.'
                        : tab === 'reports'
                          ? 'Documentos revisados, aprovados e disponíveis para download.'
                          : tab === 'team'
                            ? 'As pessoas por trás de cada decisão clínica.'
                            : tab === 'api'
                              ? 'Conecte o seu fluxo de trabalho à inteligência da Aivis.'
                              : tab === 'audit'
                                ? 'Rastreabilidade de acessos, análises e decisões.'
                                : 'Seu ambiente, acesso e preferências de operação.'}
                  </p>
                </div>
                {['overview', 'cases', 'reports'].includes(tab) && (
                  <button
                    className="button primary"
                    onClick={() => setShowNew(true)}
                    disabled={!demo && !loggedIn}
                  >
                    <Plus size={18} />
                    Novo caso
                  </button>
                )}
              </div>
              {loading && (
                <div className="loading">
                  <Loader2 className="spin" size={20} />
                  Carregando seu workspace…
                </div>
              )}
              {tab === 'overview' && (
                <>
                  <section className="hero-card">
                    <div>
                      <div className="hero-kicker">
                        <span />
                        INTELIGÊNCIA CLÍNICA, COM RESPONSABILIDADE
                      </div>
                      <h2>
                        Clareza para cada
                        <br />
                        decisão clínica.
                      </h2>
                      <p>
                        Exames, contexto e inteligência artificial.
                        <br />A decisão continua sendo sua.
                      </p>
                      <button onClick={() => setShowNew(true)} disabled={!demo && !loggedIn}>
                        Iniciar um novo caso <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="hero-art" aria-hidden="true">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="orbit orbit-three" />
                      <div className="art-document">
                        <div className="art-doc-head">
                          <Activity size={23} />
                          <span>AIVIS / CLINICAL INSIGHT</span>
                          <span className="art-check">
                            <Check size={12} />
                          </span>
                        </div>
                        <div className="art-lines">
                          <i />
                          <i />
                          <i />
                        </div>
                        <svg viewBox="0 0 260 70">
                          <path
                            d="M0 40H45L53 30L64 50L77 10L88 62L100 36H124L135 28L147 43L157 35H260"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        </svg>
                        <div className="art-divider" />
                        <div className="art-row">
                          <i />
                          <span />
                          <b />
                        </div>
                        <div className="art-row">
                          <i />
                          <span />
                          <b />
                        </div>
                      </div>
                      <span className="art-floating">
                        <ShieldCheck size={17} />
                        Revisão médica
                      </span>
                      <span className="art-cross">+</span>
                    </div>
                  </section>
                  <section className="metrics" aria-label="Indicadores gerais">
                    {[
                      {
                        label: 'Exames recebidos',
                        value: totalExams,
                        icon: FlaskConical,
                        detail: 'Arquivos no workspace',
                        className: 'blue',
                      },
                      {
                        label: 'Casos analisados',
                        value: metrics.analyzed,
                        icon: Sparkles,
                        detail: demo ? 'Exemplos de análise' : 'Com análise de IA concluída',
                        className: 'green',
                      },
                      {
                        label: 'Aguardando revisão',
                        value: metrics.review,
                        icon: Clock3,
                        detail: 'Precisam da sua atenção',
                        className: 'amber',
                      },
                      {
                        label: 'Relatórios aprovados',
                        value: metrics.approved,
                        icon: FileCheck2,
                        detail: 'Revisados pelo médico',
                        className: 'purple',
                      },
                    ].map((m) => (
                      <article className="metric" key={m.label}>
                        <div className="metric-top">
                          <span>{m.label}</span>
                          <span className={`metric-icon ${m.className}`}>
                            <m.icon size={18} />
                          </span>
                        </div>
                        <strong>{fmt(m.value)}</strong>
                        <small>{m.detail}</small>
                      </article>
                    ))}
                  </section>
                  <div className="analytics-row">
                    <section className="panel chart-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Exames analisados</h2>
                          <p>Distribuição mensal de exames em casos analisados</p>
                        </div>
                        <select
                          className="select"
                          aria-label="Período do gráfico"
                          value={period}
                          onChange={(e) => setPeriod(e.target.value)}
                        >
                          <option value="6">Últimos 6 meses</option>
                          <option value="12">Últimos 12 meses</option>
                        </select>
                      </div>
                      <div className="chart-legend">
                        <i />
                        Exames analisados{' '}
                        <span>{demo ? 'Dados demonstrativos' : 'Por mês de análise'}</span>
                      </div>
                      <div
                        className="bar-chart"
                        role="img"
                        aria-label={chart.map((m) => `${m.full}: ${m.exams} exames`).join('; ')}
                      >
                        <div className="chart-y">
                          {[1, 0.75, 0.5, 0.25, 0].map((r, i) => (
                            <span key={i}>{Math.round(maxChart * r)}</span>
                          ))}
                        </div>
                        <div className="chart-plot">
                          <div className="grid-lines">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <i key={n} />
                            ))}
                          </div>
                          <div className="bars">
                            {chart.map((m, i) => (
                              <div className="bar-column" key={m.full}>
                                <div
                                  className={`bar ${i === chart.length - 1 ? 'current' : ''}`}
                                  style={{
                                    height: `${(m.exams / maxChart) * 100}%`,
                                    minHeight: m.exams ? 4 : 0,
                                  }}
                                  title={`${m.full}: ${m.exams} exames`}
                                >
                                  <span>{m.exams}</span>
                                </div>
                                <small>{m.label}</small>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="chart-footer">
                        <span>
                          <BarChart3 size={14} />
                          {chart.reduce((s, m) => s + m.exams, 0)} exames no período
                        </span>
                        <button onClick={() => navigate('cases')}>
                          Ver casos <ArrowRight size={14} />
                        </button>
                      </div>
                    </section>
                    <section className="panel review-summary">
                      <div className="panel-heading">
                        <div>
                          <h2>Seu fluxo de trabalho</h2>
                          <p>Supervisão em todas as etapas</p>
                        </div>
                        <ClipboardCheck size={19} />
                      </div>
                      <div className="workflow-step">
                        <span className="step-number">01</span>
                        <div>
                          <strong>Receber e contextualizar</strong>
                          <p>Exames e anamnese organizados</p>
                        </div>
                        <Check size={15} />
                      </div>
                      <div className="workflow-step">
                        <span className="step-number">02</span>
                        <div>
                          <strong>Analisar com inteligência</strong>
                          <p>Hipóteses e evidências para revisão</p>
                        </div>
                        <Check size={15} />
                      </div>
                      <div className="workflow-step">
                        <span className="step-number active">03</span>
                        <div>
                          <strong>Revisar e decidir</strong>
                          <p>{metrics.review} relatório(s) aguardando revisão</p>
                        </div>
                      </div>
                      <button
                        className="review-callout"
                        onClick={() => {
                          navigate('cases');
                          setFilter('review');
                        }}
                      >
                        <span>
                          <Clock3 size={16} />
                          Ir para a fila de revisão
                        </span>
                        <ArrowRight size={16} />
                      </button>
                      <div className="human-note">
                        <LockKeyhole size={14} />
                        Aprovação exclusiva do médico.
                      </div>
                    </section>
                  </div>
                </>
              )}
              {['overview', 'cases', 'reports'].includes(tab) && (
                <section className="panel cases-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {tab === 'overview'
                          ? 'Atividade recente'
                          : tab === 'reports'
                            ? 'Documentos aprovados'
                            : 'Todos os casos'}
                      </h2>
                      <p>
                        {tab === 'overview'
                          ? 'Acompanhe os últimos casos do seu workspace'
                          : 'Pesquise pelo paciente ou identificador do caso'}
                      </p>
                    </div>
                    {tab === 'overview' && (
                      <button className="text-button" onClick={() => navigate('cases')}>
                        Ver todos os casos <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                  <div className="table-toolbar">
                    <div className="filter-tabs" role="group" aria-label="Filtrar casos">
                      {[
                        { id: 'all', label: 'Todos' },
                        ...(tab !== 'reports'
                          ? [
                              { id: 'review', label: 'Em revisão' },
                              { id: 'approved', label: 'Aprovados' },
                              { id: 'pending', label: 'Aguardando' },
                            ]
                          : []),
                      ].map((f) => (
                        <button
                          key={f.id}
                          className={filter === f.id ? 'selected' : ''}
                          onClick={() => setFilter(f.id)}
                        >
                          {f.label}
                          {f.id === 'review' && <span>{metrics.review}</span>}
                        </button>
                      ))}
                    </div>
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="Buscar paciente ou caso"
                        placeholder="Buscar paciente ou caso…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>PACIENTE / CASO</th>
                          <th>EXAMES</th>
                          <th>STATUS</th>
                          <th>RECEBIDO EM</th>
                          <th aria-label="Abrir caso" />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0, tab === 'overview' ? 5 : 50).map((c, i) => (
                          <tr key={c.id}>
                            <td>
                              <button className="patient-cell" onClick={() => setSelected(c)}>
                                <span className={`patient-avatar tone-${i % 4}`}>
                                  {c.patient_name
                                    .split(' ')
                                    .slice(0, 2)
                                    .map((w) => w[0])
                                    .join('')}
                                </span>
                                <span>
                                  <strong>{c.patient_name}</strong>
                                  <small>{c.patient_code}</small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <span className="exam-count">
                                <FileText size={15} />
                                {c.exams?.length || 0} exame{c.exams?.length === 1 ? '' : 's'}
                              </span>
                            </td>
                            <td>
                              <Status status={c.status} />
                            </td>
                            <td className="date-cell">{date(c.created_at)}</td>
                            <td>
                              <button
                                className="icon-btn"
                                aria-label={`Abrir caso ${c.patient_code}`}
                                onClick={() => setSelected(c)}
                              >
                                <ArrowUpRight size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filtered.length === 0 && (
                    <Empty
                      title={search ? 'Nenhum caso encontrado' : 'Nenhum caso nesta lista'}
                      description={
                        search
                          ? 'Tente outro nome ou identificador.'
                          : 'Crie um caso para começar ou altere o filtro.'
                      }
                    />
                  )}
                  <div className="table-footer">
                    <span>
                      {demo ? 'Dados de demonstração' : `${total} caso(s) no workspace`}
                      {search && ` · ${filtered.length} resultado(s)`}
                    </span>
                    {tab === 'overview' ? (
                      <span>
                        Revisão humana em cada relatório <ShieldCheck size={13} />
                      </span>
                    ) : (
                      <div className="pagination">
                        <button
                          aria-label="Página anterior"
                          disabled={demo || offset === 0}
                          onClick={() => setOffset(Math.max(0, offset - 50))}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span>{Math.floor(offset / 50) + 1}</span>
                        <button
                          aria-label="Próxima página"
                          disabled={demo || offset + 50 >= total}
                          onClick={() => setOffset(offset + 50)}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
              {tab === 'team' && <Team demo={demo} api={api} isAdmin={isAdmin} notify={notify} />}
              {tab === 'api' && (
                <Integrations demo={demo} api={api} isAdmin={isAdmin} notify={notify} />
              )}
              {tab === 'audit' && <Audit demo={demo} api={api} isAdmin={isAdmin} />}
              {tab === 'settings' && (
                <section className="settings-grid">
                  <div className="panel settings-card">
                    <ShieldCheck size={25} />
                    <h2>Ambiente e privacidade</h2>
                    <dl>
                      <div>
                        <dt>Organização</dt>
                        <dd>
                          {demo ? 'Demonstração' : membership?.tenants?.name || 'Não conectado'}
                        </dd>
                      </div>
                      <div>
                        <dt>Modo</dt>
                        <dd>
                          {demo ? 'Dados fictícios, em memória' : 'Produção · requer configuração'}
                        </dd>
                      </div>
                      <div>
                        <dt>Administrador inicial</dt>
                        <dd>pedronovikovborges@gmail.com</dd>
                      </div>
                      <div>
                        <dt>Região planejada</dt>
                        <dd>São Paulo · sa-east-1</dd>
                      </div>
                    </dl>
                    <p className="muted">
                      A região real deve ser confirmada na criação do projeto Supabase. O envio à
                      xAI depende de configuração e autorização para processamento.
                    </p>
                  </div>
                  <div className="panel settings-card">
                    <Code2 size={25} />
                    <h2>Conexões do projeto</h2>
                    <div className="connection-row">
                      <strong>Supabase</strong>
                      <span className={`status ${configured ? 'approved' : 'pending'}`}>
                        <i />
                        {configured ? 'Variáveis presentes' : 'Configuração pendente'}
                      </span>
                    </div>
                    <div className="connection-row">
                      <strong>Grok / xAI</strong>
                      <span className="muted">Verificação no servidor ao analisar</span>
                    </div>
                    <div className="connection-row">
                      <strong>Vercel</strong>
                      <span className="muted">Deploy pela conta do proprietário</span>
                    </div>
                    <button className="button secondary" onClick={() => setShowHelp(true)}>
                      <BookOpen size={16} />
                      Guia de configuração
                    </button>
                  </div>
                  <div className="panel settings-card full">
                    <h2>Controles de segurança</h2>
                    <div className="security-grid">
                      {[
                        'Arquivos privados e autorização por cliente',
                        'Aprovação com registro profissional',
                        'PDF final imutável e verificado por hash',
                        'Chaves de API com escopo e expiração',
                        'Auditoria de acessos e revisões',
                        'Proteção de origem e limite de requisições',
                      ].map((t) => (
                        <span key={t}>
                          <Check size={16} />
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="muted">
                      Estes controles não substituem validação clínica, avaliação regulatória,
                      política de retenção ou revisão independente de segurança.
                    </p>
                  </div>
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>Aivis · Inteligência para o cuidado.</span>
            <span>
              <ShieldCheck size={13} />
              Apoio clínico com supervisão médica
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={19} />
          {toast}
          <button className="icon-btn" aria-label="Fechar aviso" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {showNew && (
        <NewCase
          demo={demo}
          api={api}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setShowNew(false)}
          onCreated={(c) => {
            setShowNew(false);
            changeCase(c);
            notify(
              demo
                ? 'Caso fictício criado para explorar o fluxo.'
                : 'Caso criado. Adicione os exames para analisar.',
            );
            if (!demo) void load();
          }}
        />
      )}
      {showLogin && (
        <Login
          configured={configured}
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            setShowLogin(false);
            setDemo(false);
            setOffset(0);
            void load();
          }}
          onDemo={() => {
            setDemo(true);
            setCases(getDemoCases());
            setShowLogin(false);
            setError('');
          }}
        />
      )}
      {showHelp && (
        <Modal title="Da informação à decisão clínica" onClose={() => setShowHelp(false)}>
          <div className="modal-body help-content">
            <p>
              1. Crie um caso com identificador do paciente e anamnese. Adicione PDF com texto,
              JPEG, PNG ou WebP (até 4 MB por arquivo, 8 arquivos e 20 MB por caso).
            </p>
            <p>
              2. Solicite a análise pelo Grok. O resultado é um rascunho: hipóteses, achados,
              limitações e considerações. Em PDFs, apenas o texto é extraído; envie as imagens
              separadamente.
            </p>
            <p>
              3. Revise o conteúdo, edite os campos e confira o PDF. Aprovação e recusa exigem
              sessão médica com registro profissional.
            </p>
            <p>
              4. O PDF aprovado fica armazenado, com hash de integridade, disponível para download
              na plataforma e na API. Envio por e-mail não está habilitado.
            </p>
            <div className="inline-notice">
              <LockKeyhole size={19} />
              <span>
                Para o ambiente real, siga o README e os guias em <code>docs/</code> no GitHub.
                Configure Supabase, xAI e Vercel; realize a revisão de privacidade antes de usar
                dados de pacientes.
              </span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
