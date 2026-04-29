import { useEffect, useState } from 'react';

export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'agent-lens.lang';
const DEFAULT_LANG: Lang =
  typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';

const dict: Record<string, { en: string; zh: string }> = {
  // Nav
  'nav.overview': { en: '◇ Overview', zh: '◇ 总览' },
  'nav.session': { en: '⌖ Session', zh: '⌖ 会话' },

  // Header / kicker
  'overview.kicker': { en: 'Overview', zh: '总览' },
  'overview.title': { en: 'All sessions', zh: '所有会话' },
  'overview.aggregating': { en: 'Aggregating across all sessions…', zh: '正在聚合所有会话…' },

  // Hero stats
  'stat.sessions': { en: 'Sessions', zh: '会话数' },
  'stat.active': { en: 'Active', zh: '活跃' },
  'stat.turns': { en: 'Turns', zh: '回合' },
  'stat.tool_calls': { en: 'Tool calls', zh: '工具调用' },
  'stat.subagents': { en: 'Subagents', zh: '子代理' },
  'stat.user_msgs': { en: 'User msgs', zh: '用户消息' },
  'stat.assistant_msgs': { en: 'Assistant msgs', zh: '助手消息' },

  // Section titles
  'sec.live_ticker': { en: 'LIVE', zh: '实时' },
  'sec.top_realms': { en: '君主谱 · Top realms', zh: '君主谱 · 项目排行' },
  'sec.top_tools': { en: 'Top tools', zh: '工具排行' },
  'sec.top_skills': { en: 'Top skills', zh: '技能排行' },
  'sec.top_subagents': { en: 'Top subagents', zh: '子代理排行' },
  'sec.top_repos': { en: 'Top repos', zh: '仓库排行' },
  'sec.agents': { en: 'Agents', zh: 'Agent 分布' },
  'sec.skills_invoked': { en: 'Skills invoked', zh: '已调用技能' },
  'sec.tools_used': { en: 'Tools used', zh: '已用工具' },
  'sec.prompts': { en: 'Prompts', zh: '用户提示' },
  'sec.heatmap': { en: 'Activity heatmap (14 days · weekday × hour)', zh: '活跃热力图（14 天 · 星期 × 小时）' },
  'sec.activity14': { en: '14-day activity (turns)', zh: '14 天活跃（回合）' },
  'sec.sessions_in_realm': { en: 'Sessions in this realm', zh: '该项目的会话' },

  // Heatmap
  'heat.local_time': { en: 'your local time', zh: '本地时间' },
  'heat.less': { en: 'less', zh: '少' },
  'heat.more': { en: 'more', zh: '多' },
  'heat.peak': { en: 'peak', zh: '峰值' },
  'heat.no_activity': { en: 'No activity in last 14 days', zh: '近 14 天无活动' },

  // Realm
  'realm.loading': { en: 'Loading realm…', zh: '加载中…' },
  'realm.back': { en: '← Back to overview', zh: '← 返回总览' },
  'realm.this7d': { en: 'this 7d', zh: '近 7 天' },
  'realm.prev7d': { en: 'prev 7d', zh: '前 7 天' },

  // SessionList
  'list.title': { en: 'Sessions', zh: '会话列表' },
  'list.realm': { en: 'Realm', zh: '项目' },
  'list.search_ph': { en: 'Search summary, repo, branch…', zh: '搜索摘要、仓库、分支…' },
  'list.all_agents': { en: 'All agents', zh: '全部 Agent' },
  'list.sort_recent': { en: 'Recent', zh: '最近' },
  'list.sort_oldest': { en: 'Oldest', zh: '最早' },
  'list.sort_repo': { en: 'Repo A→Z', zh: '仓库 A→Z' },
  'list.empty': { en: 'No sessions match.', zh: '没有匹配的会话。' },

  // SessionDetail
  'detail.select_left': { en: 'Select a session from the left', zh: '从左侧选择一个会话' },
  'detail.repo': { en: 'Repo', zh: '仓库' },
  'detail.branch': { en: 'Branch', zh: '分支' },
  'detail.model': { en: 'Model', zh: '模型' },
  'detail.last_event': { en: 'Last event', zh: '最近事件' },
  'detail.cwd': { en: 'CWD', zh: '工作目录' },
  'detail.loading': { en: 'Loading detail…', zh: '加载详情…' },
  'detail.no_tools': { en: 'No tool calls recorded.', zh: '尚无工具调用。' },
  'detail.no_skills': { en: 'No skills invoked.', zh: '尚未调用技能。' },
  'detail.subagents': { en: 'Subagents', zh: '子代理' },

  // Empty / misc
  'misc.none': { en: 'None.', zh: '无。' },
  'misc.no_agents': { en: 'No agents.', zh: '无 Agent。' },
  'misc.live': { en: 'live', zh: '在线' },
  'misc.active_count': { en: 'active', zh: '活跃' },
  'misc.no_change': { en: 'no change', zh: '无变化' },
  'misc.dispatches': { en: 'dispatches', zh: '次派发' },
  'misc.dispatch': { en: 'dispatch', zh: '次派发' },

  // Lang
  'lang.toggle': { en: '中文', zh: 'EN' },
  'lang.toggle_title': { en: 'Switch to Chinese', zh: 'Switch to English' },
};

function readLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'en' || v === 'zh' ? v : DEFAULT_LANG;
}

let currentLang: Lang = readLang();
const listeners = new Set<(l: Lang) => void>();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(l: Lang) {
  currentLang = l;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, l);
  }
  listeners.forEach(fn => fn(l));
}

export function t(key: string, lang: Lang = currentLang): string {
  const e = dict[key];
  if (!e) return key;
  return e[lang] ?? e.en;
}

export function useT(): { t: (key: string) => string; lang: Lang; setLang: (l: Lang) => void } {
  const [lang, setL] = useState<Lang>(currentLang);
  useEffect(() => {
    const fn = (l: Lang) => setL(l);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return {
    lang,
    setLang,
    t: (key: string) => t(key, lang),
  };
}
