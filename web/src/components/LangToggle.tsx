import { useT } from '../i18n';

export function LangToggle() {
  const { t, lang, setLang } = useT();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
      title={t('lang.toggle_title')}
      className="px-2 py-1 rounded border border-slate-700 text-[11px] font-medium text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 transition-colors tabular-nums"
    >
      {t('lang.toggle')}
    </button>
  );
}
