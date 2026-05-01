import { useEffect, useState } from 'react';
import { fetchCopilotConfig, type CopilotConfig } from '../api';
import { useT } from '../i18n';
import { renderMarkdown } from '../markdown';

export function ConfigPanel({ onOpenSkills }: { onOpenSkills?: () => void }) {
  const { t } = useT();
  const [config, setConfig] = useState<CopilotConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchCopilotConfig()
      .then(setConfig)
      .catch(e => setErr(e.message));
  }, []);

  if (err) {
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <p className="text-red-400 text-sm">Failed to load config: {err}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-72 bg-slate-800 rounded" />
          <div className="h-32 bg-slate-800/50 rounded" />
          <div className="h-64 bg-slate-800/50 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="px-8 pt-8 pb-4">
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">
          {t('config.title')}
        </h1>
      </header>

      {/* Settings card */}
      <section className="mx-8 mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-3">{t('config.settings_title')}</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="text-slate-500">{t('config.model')}</span>
            <p className="text-slate-200 font-mono text-xs mt-0.5">
              {config.model ?? <span className="text-slate-600 italic">—</span>}
            </p>
          </div>
          <div>
            <span className="text-slate-500">{t('config.effort')}</span>
            <p className="text-slate-200 font-mono text-xs mt-0.5">
              {config.effort_level ?? <span className="text-slate-600 italic">—</span>}
            </p>
          </div>
          <div>
            <span className="text-slate-500">{t('config.plugins')}</span>
            {config.plugins.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5">
                {config.plugins.map(p => (
                  <li key={p.name} className="text-xs text-slate-300 font-mono">
                    {p.name}
                    <span className="text-slate-500 ml-1">v{p.version}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-600 italic text-xs mt-0.5">{t('config.no_plugins')}</p>
            )}
          </div>
          <div>
            <span className="text-slate-500">{t('config.skills_count')}</span>
            <p className="mt-0.5">
              {onOpenSkills ? (
                <button
                  type="button"
                  onClick={onOpenSkills}
                  className="text-emerald-400 hover:text-emerald-300 text-xs font-mono underline underline-offset-2"
                >
                  {config.skills_count}
                </button>
              ) : (
                <span className="text-slate-200 font-mono text-xs">{config.skills_count}</span>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Persona / Custom instructions */}
      <section className="mx-8 mb-8 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-3">{t('config.instructions_title')}</h2>
        {config.instructions ? (
          <div
            className="prose prose-invert prose-sm max-w-none text-slate-300"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(config.instructions) }}
          />
        ) : (
          <p className="text-slate-500 text-sm whitespace-pre-line">
            {t('config.no_instructions')}
          </p>
        )}
      </section>
    </div>
  );
}
