import { useT } from '../i18n';

interface Crumb {
  label: string;
  onClick?: () => void;
}

interface Props {
  crumbs: Crumb[];
  canBack: boolean;
  onBack: () => void;
}

export function Breadcrumbs({ crumbs, canBack, onBack }: Props) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2 px-4 h-8 border-b border-slate-800/60 bg-slate-950/40 text-[11px] text-slate-400 flex-shrink-0">
      <button
        onClick={onBack}
        disabled={!canBack}
        title={canBack ? t('crumbs.back') : t('crumbs.no_back')}
        className={`px-1.5 py-0.5 rounded transition-colors ${
          canBack
            ? 'text-slate-300 hover:text-slate-100 hover:bg-slate-800'
            : 'text-slate-700 cursor-not-allowed'
        }`}
      >
        ← {t('crumbs.back')}
      </button>
      <span className="text-slate-700">|</span>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-2 min-w-0">
            {i > 0 && <span className="text-slate-700">›</span>}
            {c.onClick && !isLast ? (
              <button
                onClick={c.onClick}
                className="hover:text-slate-200 truncate"
              >
                {c.label}
              </button>
            ) : (
              <span className={`truncate ${isLast ? 'text-slate-200 font-medium' : ''}`}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
