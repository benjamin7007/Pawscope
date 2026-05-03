import { useEffect, useMemo, useState } from 'react';
import { fetchCopilotConfig, fetchAllAgentsConfig, fetchSkills, type CopilotConfig, type AgentConfigInfo, type SkillEntry } from '../api';
import { useT } from '../i18n';
import { renderMarkdown } from '../markdown';

const AGENT_COLORS: Record<string, string> = {
  copilot: '#34d399',
  claude: '#a78bfa',
  codex: '#f59e0b',
  opencode: '#22d3ee',
  gemini: '#60a5fa',
  aider: '#fb7185',
};

const AGENT_ICONS: Record<string, string> = {
  copilot: '✦',
  claude: '◈',
  codex: '⬡',
  opencode: '⊙',
  gemini: '◆',
  aider: '▣',
};

const AGENT_LABELS: Record<string, string> = {
  copilot: 'Copilot',
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini',
  aider: 'Aider',
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface ConfigPanelProps {
  onOpenSkills?: () => void;
  sessions?: any[];
  tokensMap?: Record<string, { in: number; out: number }>;
}

export function ConfigPanel({ onOpenSkills, sessions = [], tokensMap = {} }: ConfigPanelProps) {
  const { t } = useT();
  const [agentsConfig, setAgentsConfig] = useState<AgentConfigInfo[] | null>(null);
  const [copilotConfig, setCopilotConfig] = useState<CopilotConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedInstructions, setExpandedInstructions] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skills, setSkills] = useState<SkillEntry[] | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);

  useEffect(() => {
    fetchAllAgentsConfig()
      .then(r => setAgentsConfig(r.agents))
      .catch(e => setErr(e.message));
    fetchCopilotConfig()
      .then(setCopilotConfig)
      .catch(() => {}); // Non-critical, copilot detail is supplementary
  }, []);

  // Compute per-agent stats from sessions + tokensMap
  const agentStats = useMemo(() => {
    const stats: Record<string, { sessions: number; tokens: number }> = {};
    for (const s of sessions) {
      const agent = (s.agent ?? '').toLowerCase();
      if (!agent) continue;
      if (!stats[agent]) stats[agent] = { sessions: 0, tokens: 0 };
      stats[agent].sessions += 1;
      const tk = tokensMap[s.id];
      if (tk) stats[agent].tokens += (tk.in ?? 0) + (tk.out ?? 0);
    }
    return stats;
  }, [sessions, tokensMap]);

  if (err) {
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <p className="text-red-400 text-sm">Failed to load config: {err}</p>
      </div>
    );
  }

  if (!agentsConfig) {
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-72 bg-slate-800 rounded" />
          <div className="h-32 bg-slate-800/50 rounded" />
          <div className="h-32 bg-slate-800/50 rounded" />
          <div className="h-32 bg-slate-800/50 rounded" />
        </div>
      </div>
    );
  }

  const filteredCopilotAgents = (copilotConfig?.agents ?? []).filter(
    a =>
      !agentSearch ||
      a.name.toLowerCase().includes(agentSearch.toLowerCase()) ||
      a.description.toLowerCase().includes(agentSearch.toLowerCase()),
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="px-8 pt-8 pb-4">
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">
          {t('config.title')}
        </h1>
      </header>

      {/* Agent cards grid */}
      <section className="mx-8 mb-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {agentsConfig.map(ac => {
          const color = AGENT_COLORS[ac.agent] ?? '#64748b';
          const icon = AGENT_ICONS[ac.agent] ?? '●';
          const label = AGENT_LABELS[ac.agent] ?? ac.agent;
          const stats = agentStats[ac.agent];
          const hasInstructions = !!ac.instructions;
          const isInstructionsOpen = expandedInstructions === ac.agent;
          const settingsEntries = Object.entries(ac.settings ?? {});

          return (
            <div
              key={ac.agent}
              className="rounded-lg border bg-slate-900/40 p-4 flex flex-col gap-3 transition-colors"
              style={{ borderColor: ac.installed ? `${color}55` : '#334155' }}
            >
              {/* Header: icon + name + status badge */}
              <div className="flex items-center gap-2.5">
                <span className="text-lg" style={{ color }}>{icon}</span>
                <span className="text-sm font-semibold text-slate-100">{label}</span>
                <span
                  className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: ac.installed ? `${color}22` : '#1e293b',
                    color: ac.installed ? color : '#64748b',
                    border: `1px solid ${ac.installed ? `${color}55` : '#334155'}`,
                  }}
                >
                  {ac.installed ? `✅ ${t('config.installed')}` : `❌ ${t('config.not_found')}`}
                </span>
              </div>

              {/* Data path */}
              {ac.data_path && (
                <p className="text-[10px] text-slate-600 font-mono truncate" title={ac.data_path}>
                  {ac.data_path}
                </p>
              )}

              {/* Key settings */}
              {ac.installed && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {ac.model && (
                    <div>
                      <span className="text-slate-500">{t('config.model')}</span>
                      <p className="text-slate-200 font-mono text-[11px] mt-0.5">{ac.model}</p>
                    </div>
                  )}
                  {settingsEntries.map(([key, val]) => (
                    <div key={key}>
                      <span className="text-slate-500 capitalize">
                        {key === 'effortLevel' ? t('config.effort')
                          : key === 'plugins' || key === 'enabledPlugins' ? t('config.plugins')
                          : key === 'providers' ? t('config.providers')
                          : key}
                      </span>
                      <p className="text-slate-300 font-mono text-[11px] mt-0.5 truncate">
                        {Array.isArray(val) ? val.join(', ') : String(val)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Stats row */}
              {stats && (
                <div className="flex items-center gap-4 text-[11px] pt-1 border-t border-slate-800">
                  <span className="text-slate-400">
                    <span className="text-slate-500">{t('config.sessions')}:</span>{' '}
                    <span className="text-slate-200 font-mono">{stats.sessions}</span>
                  </span>
                  {stats.tokens > 0 && (
                    <span className="text-slate-400">
                      <span className="text-slate-500">{t('config.tokens')}:</span>{' '}
                      <span className="text-slate-200 font-mono">{formatTokens(stats.tokens)}</span>
                    </span>
                  )}
                </div>
              )}

              {/* Instructions toggle */}
              {hasInstructions && (
                <div>
                  <button
                    type="button"
                    onClick={() => setExpandedInstructions(isInstructionsOpen ? null : ac.agent)}
                    className="text-[11px] hover:underline"
                    style={{ color }}
                  >
                    {isInstructionsOpen ? t('config.hide_instructions') : t('config.show_instructions')} {isInstructionsOpen ? '▼' : '▶'}
                  </button>
                  {isInstructionsOpen && ac.instructions && (
                    <div
                      className="mt-2 prose prose-invert prose-sm max-w-none text-slate-300 max-h-[300px] overflow-y-auto rounded bg-slate-800/50 p-3 text-xs"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(ac.instructions) }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Copilot-specific: Skills detail */}
      {copilotConfig && (
        <section className="mx-8 mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">{t('config.settings_title')}</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <span className="text-slate-500">{t('config.skills_count')}</span>
              <p className="mt-0.5 relative">
                <button
                  type="button"
                  onClick={() => {
                    if (!skillsOpen && !skills) {
                      setSkillsLoading(true);
                      fetchSkills()
                        .then(r => setSkills(r.skills))
                        .catch(() => setSkills([]))
                        .finally(() => setSkillsLoading(false));
                    }
                    setSkillsOpen(!skillsOpen);
                  }}
                  className="text-emerald-400 hover:text-emerald-300 text-xs font-mono underline underline-offset-2"
                >
                  {copilotConfig.skills_count} {skillsOpen ? '▼' : '▶'}
                </button>
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Skills detail panel (lazy-loaded on click) */}
      {skillsOpen && (
        <section className="mx-8 mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200">
              {t('config.skills_detail_title')}
            </h2>
            {onOpenSkills && (
              <button
                type="button"
                onClick={onOpenSkills}
                className="text-[10px] text-emerald-400 hover:text-emerald-300 underline"
              >
                {t('config.skills_open_full')}
              </button>
            )}
          </div>
          {skillsLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-6 bg-slate-800/50 rounded w-3/4" />
              ))}
            </div>
          ) : skills && skills.length > 0 ? (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {skills.map(s => (
                <div
                  key={s.name}
                  className="flex items-start gap-3 px-3 py-2 rounded bg-slate-800/40"
                >
                  <span className="text-violet-400 text-[10px] mt-1 flex-shrink-0">◆</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-200">{s.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-500">
                        {s.source}
                      </span>
                      {s.invocations > 0 && (
                        <span className="text-[10px] text-amber-400/70">×{s.invocations}</span>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed line-clamp-2">
                        {s.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">{t('config.no_skills')}</p>
          )}
        </section>
      )}

      {/* Copilot agents section */}
      {copilotConfig && copilotConfig.agents.length > 0 && (
        <section className="mx-8 mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200">
              {t('config.copilot_agents_title')}
              <span className="ml-2 text-xs text-slate-500 font-normal">{copilotConfig.agents.length}</span>
            </h2>
            {copilotConfig.agents.length > 5 && (
              <input
                type="text"
                value={agentSearch}
                onChange={e => setAgentSearch(e.target.value)}
                placeholder={t('config.agents_search')}
                className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 placeholder-slate-600 w-44 focus:outline-none focus:border-emerald-500"
              />
            )}
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {filteredCopilotAgents.map(a => {
              const isExpanded = expandedAgent === a.name;
              const hasMore = a.full_description !== a.description;
              return (
                <button
                  type="button"
                  key={a.name}
                  onClick={() => setExpandedAgent(isExpanded ? null : a.name)}
                  className={`w-full text-left flex items-start gap-3 px-3 py-2 rounded transition-colors ${
                    isExpanded ? 'bg-slate-800/70 ring-1 ring-emerald-500/30' : 'bg-slate-800/40 hover:bg-slate-800/70'
                  }`}
                >
                  <span className={`text-[10px] mt-1 flex-shrink-0 transition-transform ${isExpanded ? 'text-emerald-300' : 'text-emerald-400'}`}>
                    {hasMore ? (isExpanded ? '▼' : '▶') : '●'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-200">{a.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-500">
                        {a.source}
                      </span>
                    </div>
                    {isExpanded ? (
                      <p className="text-[11px] text-slate-300 mt-1 leading-relaxed whitespace-pre-line">
                        {a.full_description}
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed line-clamp-2">
                        {a.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
            {agentSearch && filteredCopilotAgents.length === 0 && (
              <p className="text-slate-500 text-xs text-center py-4">{t('config.agents_no_match')}</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
