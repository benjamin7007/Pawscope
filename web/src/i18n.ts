import { useEffect, useState } from 'react';

export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'pawscope.lang';
const DEFAULT_LANG: Lang =
  typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';

const dict: Record<string, { en: string; zh: string }> = {
  // Nav
  'nav.overview': { en: '◇ Overview', zh: '◇ 总览' },
  'nav.session': { en: '⌖ Session', zh: '⌖ 会话' },
  'nav.skills': { en: '🛠 Skills', zh: '🛠 技能' },
  'nav.prompts': { en: '⌕ Prompts', zh: '⌕ 提示' },
  'nav.config': { en: '⚙ Config', zh: '⚙ 配置' },

  // Breadcrumbs
  'crumbs.back': { en: 'Back', zh: '后退' },
  'crumbs.no_back': { en: 'No history', zh: '无历史' },
  'crumbs.overview': { en: 'Overview', zh: '总览' },
  'crumbs.session': { en: 'Session', zh: '会话' },
  'crumbs.skills': { en: 'Skills', zh: '技能' },
  'crumbs.prompts': { en: 'Prompts', zh: '提示' },
  'crumbs.realm': { en: 'Realm', zh: '领地' },
  'crumbs.compare': { en: 'Compare', zh: '对比' },
  'crumbs.config': { en: 'Config', zh: '配置' },

  // Config page
  'config.title': { en: '⚙ Copilot Configuration', zh: '⚙ Copilot 配置' },
  'config.model': { en: 'Model', zh: '模型' },
  'config.effort': { en: 'Effort Level', zh: '努力等级' },
  'config.plugins': { en: 'Plugins', zh: '插件' },
  'config.skills_count': { en: 'Skills', zh: '技能' },
  'config.instructions_title': { en: '📝 Custom Instructions', zh: '📝 人设配置' },
  'config.no_instructions': { en: 'No copilot-instructions.md found.\nCreate one at ~/.copilot/copilot-instructions.md to configure your agent persona.', zh: '未找到 copilot-instructions.md。\n在 ~/.copilot/copilot-instructions.md 创建此文件以配置你的 agent 人设。' },
  'config.settings_title': { en: 'Settings', zh: '设置' },
  'config.no_plugins': { en: 'No plugins installed', zh: '未安装插件' },

  // Prompts search
  'prompts.title': { en: 'Search prompts', zh: '搜索用户提示' },
  'prompts.placeholder': { en: 'Type to search across all sessions…', zh: '输入关键字,跨所有会话搜索…' },
  'prompts.empty': { en: 'No matches.', zh: '没有匹配结果。' },
  'prompts.loading': { en: 'Searching…', zh: '搜索中…' },
  'prompts.results': { en: 'results', zh: '条结果' },
  'prompts.recent': { en: 'Recent prompts (no filter)', zh: '最近的用户提示(无过滤)' },
  'prompts.filters': { en: 'Filters', zh: '过滤器' },
  'prompts.filter.agent': { en: 'Agent', zh: 'Agent' },
  'prompts.filter.agent.all': { en: 'All', zh: '全部' },
  'prompts.filter.repo': { en: 'Repo contains', zh: '仓库包含' },
  'prompts.filter.range': { en: 'Range', zh: '时间' },
  'prompts.filter.range.all': { en: 'All time', zh: '全部时间' },
  'prompts.filter.range.24h': { en: 'Last 24h', zh: '近 24 小时' },
  'prompts.filter.range.7d': { en: 'Last 7d', zh: '近 7 天' },
  'prompts.filter.range.30d': { en: 'Last 30d', zh: '近 30 天' },
  'prompts.filter.clear': { en: 'Clear', zh: '清除' },
  'prompts.cluster': { en: 'Cluster', zh: '聚类' },
  'prompts.cluster_tip': {
    en: 'Group similar prompts using token overlap (Jaccard ≥ 0.45)',
    zh: '基于词重合度对相似提示进行聚类 (Jaccard ≥ 0.45)',
  },
  'prompts.clusters': { en: 'clusters', zh: '类' },
  'prompts.cluster_show': { en: 'show similar', zh: '展开相似' },
  'prompts.cluster_hide': { en: 'hide similar', zh: '收起' },

  // Tool timeline
  'sec.tool_timeline': { en: 'Tool call timeline', zh: '工具调用时间轴' },
  'timeline.empty': { en: 'No timestamped tool calls captured.', zh: '尚无带时间戳的工具调用。' },
  'livepin.title': { en: 'Live sessions', zh: '活跃会话' },
  'livepin.live': { en: 'live', zh: '活跃' },
  'livepin.expand': { en: 'Expand live sessions', zh: '展开活跃会话' },
  'livepin.collapse': { en: 'Collapse', zh: '收起' },
  'livepin.dismiss': { en: 'Hide this session', zh: '隐藏此会话' },
  'livepin.more': { en: 'more', zh: '更多' },
  'timeline.args': { en: 'Arguments', zh: '参数' },
  'timeline.result': { en: 'Result', zh: '返回' },
  'timeline.success': { en: 'success', zh: '成功' },
  'timeline.failure': { en: 'failure', zh: '失败' },
  'timeline.no_detail': { en: 'No detail captured for this call.', zh: '此次调用未捕获详情。' },

  // Header / kicker
  'overview.kicker': { en: 'Overview', zh: '总览' },
  'overview.title': { en: 'All sessions', zh: '所有会话' },
  'overview.export_day': { en: 'Daily digest', zh: '每日摘要' },
  'overview.export_week': { en: 'Weekly digest', zh: '每周摘要' },
  'overview.export_day_tip': {
    en: 'Download a Markdown digest of activity in the last 24 hours',
    zh: '下载最近 24 小时活动的 Markdown 摘要',
  },
  'overview.export_week_tip': {
    en: 'Download a Markdown digest of activity in the last 7 days',
    zh: '下载最近 7 天活动的 Markdown 摘要',
  },
  'overview.aggregating': { en: 'Aggregating across all sessions…', zh: '正在聚合所有会话…' },

  // Hero stats
  'stat.sessions': { en: 'Sessions', zh: '会话数' },
  'stat.active': { en: 'Active', zh: '活跃' },
  'stat.turns': { en: 'Turns', zh: '回合' },
  'stat.tool_calls': { en: 'Tool calls', zh: '工具调用' },
  'stat.subagents': { en: 'Subagents', zh: '子代理' },
  'stat.user_msgs': { en: 'User msgs', zh: '用户消息' },
  'stat.assistant_msgs': { en: 'Assistant msgs', zh: '助手消息' },
  'stat.tokens_in': { en: 'Tokens in', zh: '输入 tokens' },
  'stat.tokens_out': { en: 'Tokens out', zh: '输出 tokens' },
  'stat.tokens_total': { en: 'Tokens total', zh: 'Token 总计' },

  // Section titles
  'sec.live_ticker': { en: 'LIVE', zh: '实时' },
  'sec.top_realms': { en: '君主谱 · Top realms', zh: '君主谱 · 项目排行' },
  'sec.top_tools': { en: 'Top tools', zh: '工具排行' },
  'sec.top_skills': { en: 'Top skills', zh: '技能排行' },
  'sec.token_usage': { en: 'Token usage', zh: 'Token 用量' },
  'sec.token_trend7': { en: '7-day trend', zh: '7 天趋势' },
  'misc.token_in_arrow': { en: 'in', zh: '输入' },
  'misc.token_out_arrow': { en: 'out', zh: '输出' },
  'sec.top_subagents': { en: 'Top subagents', zh: '子代理排行' },
  'sec.top_repos': { en: 'Top repos', zh: '仓库排行' },
  'sec.agents': { en: 'Agents', zh: 'Agent 分布' },
  'sec.skills_invoked': { en: 'Skills invoked', zh: '已调用技能' },
  'sec.skills_available': { en: 'Available skills', zh: '可调用的技能' },
  'palette.tooltip': { en: 'Search (⌘K)', zh: '搜索 (⌘K)' },
  'sec.tools_used': { en: 'Tools used', zh: '已用工具' },
  'sec.prompts': { en: 'Prompts', zh: '用户提示' },
  'sec.heatmap': { en: 'Activity heatmap (14 days · weekday × hour)', zh: '活跃热力图（14 天 · 星期 × 小时）' },
  'sec.tool_trend': { en: 'Global tool trend (7 days · hourly)', zh: '全局工具趋势（7 天 · 每小时）' },
  'tool_trend.empty': { en: 'No tool calls in the selected window.', zh: '所选时间窗口内没有工具调用。' },
  'tool_trend.range.24h': { en: '24h', zh: '24小时' },
  'tool_trend.range.7d': { en: '7d', zh: '7天' },
  'tool_trend.range.30d': { en: '30d', zh: '30天' },
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
  'list.sort_tokens': { en: 'Tokens ↓', zh: 'Token ↓' },
  'stat.cost_est': { en: 'Est. cost', zh: '估算费用' },
  'stat.cost_unknown': { en: 'unknown model', zh: '未识别模型' },
  'stat.cost_no_model': { en: 'no model recorded', zh: '未记录模型' },
  'sec.cost_summary': { en: 'Estimated cost', zh: '费用估算' },
  'sec.prompt_cloud': { en: 'Prompt word cloud', zh: '口令词云' },
  'sec.prompt_length': { en: 'Prompt length distribution', zh: '口令长度分布' },
  'sec.tech_stack': { en: 'Detected tech stack', zh: '识别的技术栈' },
  'sec.weekly_trend': { en: 'Weekly activity trend', zh: '每周活动走势' },
  'sec.heartbeat': { en: 'Heartbeat heatmap', zh: '活动心跳图' },
  'sec.dangerous': { en: 'Dangerous tool calls', zh: '危险动作监控' },
  'sec.hot_files': { en: 'Hot files', zh: '热点文件' },
  'sec.replay': { en: 'Session replay', zh: '会话回放' },
  'sec.dormant': { en: 'Dormant active sessions', zh: '潜伏会话' },
  'stat.duration': { en: 'Duration', zh: '持续时长' },
  'stat.first_event': { en: 'First event', zh: '首次事件' },
  'stat.prompts_per_hour': { en: 'Prompts/hr', zh: '口令/小时' },
  'stat.turns_per_hour': { en: 'Turns/hr', zh: '回合/小时' },
  'misc.from_first_prompt': { en: 'from first prompt', zh: '自首次口令' },
  'misc.from_session_start': { en: 'from session start', zh: '自会话开始' },
  'misc.terms': { en: 'terms', zh: '词' },
  'misc.prompts': { en: 'prompts', zh: '条' },
  'misc.detected': { en: 'detected', zh: '种' },
  'misc.detected_from_prompts': { en: 'Inferred from your prompts', zh: '基于历史 prompts 推断' },
  'misc.this_week': { en: 'This week', zh: '本周' },
  'misc.last_week': { en: 'Last week', zh: '上周' },
  'misc.this_vs_last': { en: 'this vs last', zh: '本周 vs 上周' },
  'misc.collapse': { en: 'Collapse', zh: '收起' },
  'misc.open_replay': { en: 'Open replay', zh: '打开回放' },
  'misc.fullscreen': { en: 'Fullscreen', zh: '全屏' },
  'misc.export': { en: 'Export', zh: '导出' },
  'misc.peak_at': { en: 'Peak activity at', zh: '高峰时段' },
  'misc.dow_x_hour': { en: 'Day × Hour', zh: '星期 × 小时' },
  'misc.no_dangerous': { en: 'No risky tool calls detected', zh: '未检测到危险调用' },
  'misc.no_hot_files': { en: 'No file references found', zh: '未识别到文件引用' },
  'misc.no_sessions': { en: 'No sessions', zh: '没有会话' },
  'misc.search_for': { en: 'Search for', zh: '搜索' },
  'misc.today_cost': { en: 'Today', zh: '今日' },
  'misc.week_cost': { en: 'Week', zh: '本周' },
  'misc.month_cost': { en: 'Month', zh: '本月' },
  'misc.cost7_trend': { en: '7-day cost', zh: '7 日费用' },
  'misc.export_session_json': { en: 'Export JSON', zh: '导出 JSON' },
  'misc.export_session_md': { en: 'Export Markdown', zh: '导出 Markdown' },
  'misc.export_session': { en: 'Export session', zh: '导出会话' },
  'misc.show_samples': { en: 'Show prompt samples', zh: '查看 prompt 示例' },
  'misc.daily_budget': { en: 'Daily budget', zh: '每日预算' },
  'misc.set_budget': { en: 'Set daily budget', zh: '设置每日预算' },
  'misc.click_to_edit': { en: 'click to edit', zh: '点击编辑' },
  'misc.budget_prompt': { en: 'Daily budget in USD (0 to disable):', zh: '每日预算（美元，0 表示关闭）：' },
  'misc.over_budget_days': { en: '{n} day(s) over budget', zh: '{n} 天超预算' },
  'misc.forecast_label': { en: 'next 7d', zh: '未来 7 天' },
  'misc.forecast_tip': { en: 'Projection from past 7-day average', zh: '基于过去 7 天均值的预测' },
  'sec.insights': { en: 'Insights', zh: '智能洞察' },
  'insights.cost_peak_prefix': { en: 'Your cost peaked on', zh: '本周费用高峰在' },
  'insights.cost_peak_mid': { en: '— that was', zh: '— 是最低日的' },
  'insights.cost_peak_suffix': { en: 'your minimum day', zh: '倍' },
  'insights.budget_prefix': { en: 'Cost ran over budget on', zh: '本周有' },
  'insights.budget_mid': { en: 'day(s) this week. Daily budget:', zh: '天超预算。每日预算：' },
  'insights.hot_file_prefix': { en: 'Your hottest file is', zh: '你最常引用的文件是' },
  'insights.hot_file_mid': { en: '— mentioned across', zh: '— 出现在' },
  'insights.hot_file_sessions': { en: 'sessions', zh: '个会话' },
  'insights.hot_file_mentions': { en: 'mentions', zh: '次提及' },
  'insights.danger_prefix': { en: 'Risky tool', zh: '危险工具' },
  'insights.danger_mid': { en: 'fired', zh: '被调用了' },
  'insights.danger_calls': { en: 'time(s)', zh: '次' },
  'insights.danger_across': { en: 'across', zh: '跨越' },
  'insights.danger_sessions': { en: 'session(s)', zh: '个会话' },
  'insights.peak_prefix': { en: 'Peak coding hour:', zh: '高效时段：' },
  'insights.band_late': { en: 'late night', zh: '深夜' },
  'insights.band_morning': { en: 'morning', zh: '上午' },
  'insights.band_afternoon': { en: 'afternoon', zh: '下午' },
  'insights.band_evening': { en: 'evening', zh: '晚间' },
  'insights.active_prefix': { en: 'You have', zh: '当前有' },
  'insights.active_suffix': { en: 'session(s) live right now', zh: '个会话正在进行' },
  'tip.morning': { en: 'Morning peak', zh: '清晨高峰' },
  'tip.morning_advice': { en: 'Front-load deep-work tasks; defer meetings to afternoon.', zh: '把硬骨头放在上午啃，会议放到下午。' },
  'tip.midday': { en: 'Midday peak', zh: '中午高峰' },
  'tip.midday_advice': { en: 'Pre-lunch sprint window — protect with focus blocks.', zh: '午饭前冲刺窗口，建议屏蔽通知。' },
  'tip.afternoon': { en: 'Afternoon peak', zh: '下午高峰' },
  'tip.afternoon_advice': { en: 'Classic productivity zone — pair coding & big refactors here.', zh: '经典高效区，结对编程和大重构都丢这里。' },
  'tip.evening': { en: 'Evening peak', zh: '傍晚高峰' },
  'tip.evening_advice': { en: 'Watch for fatigue creep; use AI for grunt work after dinner.', zh: '注意疲劳，晚饭后让 AI 干粗活。' },
  'tip.night': { en: 'Night-owl peak', zh: '夜猫子高峰' },
  'tip.night_advice': { en: 'Quiet creative window — but recovery sleep matters more.', zh: '夜深人静创意爆发，但睡眠更重要。' },
  'tip.weekday': { en: 'Weekday', zh: '工作日' },
  'tip.weekend': { en: 'Weekend', zh: '周末' },
  'misc.calls': { en: 'calls', zh: '次调用' },
  'misc.sessions_affected': { en: 'sessions affected', zh: '个会话涉及' },
  'misc.high_risk': { en: 'high risk', zh: '高危' },
  'misc.files': { en: 'files', zh: '个文件' },
  'misc.length_chars': { en: 'length in characters', zh: '字符数' },
  'misc.show': { en: 'show', zh: '展开' },
  'misc.hide': { en: 'hide', zh: '收起' },
  'misc.more': { en: 'more', zh: '个更多' },
  'misc.sessions_priced': { en: 'priced', zh: '已计价' },
  'misc.sessions_unpriced': { en: 'unpriced', zh: '未识别' },
  'misc.sessions_short': { en: 'sessions', zh: '会话' },
  'misc.total_estimated': { en: 'total estimated USD', zh: '估算总额（美元）' },
  'misc.unpriced_note': { en: '{N} session(s) skipped: model not in pricing table.', zh: '有 {N} 个会话因模型未在定价表中而未计入。' },
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
  'misc.events': { en: 'events', zh: '次事件' },
  'misc.now': { en: 'now', zh: '此刻' },
  'misc.turns_suffix': { en: 'turns', zh: '回合' },
  'misc.tools_suffix': { en: 'tools', zh: '工具' },
  'misc.unique': { en: 'unique', zh: '种' },
  'misc.total': { en: 'total', zh: '总计' },
  'misc.inbound': { en: '↑ inbound', zh: '↑ 收到' },
  'misc.outbound': { en: '↓ outbound', zh: '↓ 发出' },
  'misc.cumulative': { en: 'cumulative', zh: '累计' },
  'misc.no_summary': { en: '(no summary)', zh: '(尚无摘要)' },
  'status.active': { en: 'active', zh: '活跃' },
  'status.idle': { en: 'idle', zh: '空闲' },
  'status.archived': { en: 'archived', zh: '已归档' },
  'status.crashed': { en: 'crashed', zh: '异常退出' },
  'status.closed': { en: 'closed', zh: '已结束' },

  // Lang
  'lang.toggle': { en: '中文', zh: 'EN' },
  'lang.toggle_title': { en: 'Switch to Chinese', zh: 'Switch to English' },

  // Conversation flow
  'tab.summary': { en: 'Summary', zh: '概览' },
  'tab.conversation': { en: 'Conversation', zh: '对话流' },
  'flow.empty': { en: 'No conversation events yet.', zh: '暂无对话事件。' },
  'flow.load_error': { en: 'Failed to load conversation', zh: '加载对话失败' },
  'flow.copilot_only': { en: 'Conversation flow is currently Copilot-only.', zh: '对话流目前仅支持 Copilot 会话。' },
  'flow.system_prompt': { en: 'System prompt', zh: '系统提示' },
  'flow.secret_warning': { en: '⚠ may contain secrets', zh: '⚠ 可能含敏感信息' },
  'flow.user_human': { en: '👤 human', zh: '👤 用户' },
  'flow.user_injected': { en: '💉 injected context', zh: '💉 注入上下文' },
  'flow.show_transformed': { en: 'show transformed', zh: '显示拼接后' },
  'flow.show_raw': { en: 'show raw', zh: '显示原始' },
  'flow.raw': { en: 'Raw', zh: '原始' },
  'flow.transformed': { en: 'Transformed (sent to LLM)', zh: '拼接后（发给模型）' },
  'flow.assistant_turn': { en: 'Turn', zh: '回合' },
  'flow.subagent': { en: 'Subagent', zh: '子代理' },
  'flow.compaction': { en: 'Compaction', zh: '上下文压缩' },
  'flow.completed_at': { en: 'Completed at', zh: '完成于' },
  'flow.turns_short': { en: 'turns', zh: '回合' },
  'flow.interactions_short': { en: 'interactions', zh: '次交互' },
  'flow.compactions_short': { en: 'compactions', zh: '次压缩' },
  'flow.live': { en: 'live', zh: '实时' },
  'flow.tokens_total_tip': { en: 'Click for per-model breakdown', zh: '点击查看按模型拆分' },
  'flow.tokens_cache_read': { en: 'cache read', zh: '缓存读' },
  'flow.tokens_cache_write': { en: 'cache write', zh: '缓存写' },
  'flow.tokens_incomplete': { en: 'Some turns use models not in the pricing table', zh: '部分轮次模型不在价格表中' },
  'flow.tokens_incomplete_long': { en: '{n} turn(s) skipped — model not in pricing table', zh: '已跳过 {n} 轮 — 模型不在价格表中' },
  'flow.copy_link': { en: 'copy link to this interaction', zh: '复制此交互链接' },

  // Compare view
  'compare.kicker': { en: 'Compare', zh: '对比' },
  'compare.title': { en: 'Side-by-side session compare', zh: '会话并排对比' },
  'compare.close': { en: 'Close', zh: '关闭' },
  'compare.open_session': { en: 'Open session', zh: '打开会话' },
  'compare.turns': { en: 'Turns', zh: '轮数' },
  'compare.duration': { en: 'Duration', zh: '时长' },
  'compare.user_msgs': { en: 'User msgs', zh: '用户消息' },
  'compare.tool_calls': { en: 'Tool calls', zh: '工具调用' },
  'compare.tokens_in': { en: 'Tokens in', zh: '输入 tokens' },
  'compare.tokens_out': { en: 'Tokens out', zh: '输出 tokens' },
  'compare.cost': { en: 'Cost (est.)', zh: '估算成本' },
  'compare.subagents': { en: 'Sub-agents', zh: '子代理' },
  'compare.top_tools': { en: 'Top tools', zh: '常用工具' },
  'compare.top_skills': { en: 'Top skills', zh: '常用技能' },
  'compare.tool_overlap': { en: 'Tool overlap', zh: '工具重合' },
  'compare.shared': { en: 'Shared', zh: '共有' },
  'compare.only_left': { en: 'Only left', zh: '仅左侧' },
  'compare.only_right': { en: 'Only right', zh: '仅右侧' },
  'compare.prompt_diff': { en: 'Prompt overlap', zh: '提示重合' },
  'compare.shared_prompts': { en: 'Similar prompts', zh: '相似提示' },
  'compare.unique_left': { en: 'Unique to left', zh: '仅在左侧' },
  'compare.unique_right': { en: 'Unique to right', zh: '仅在右侧' },
  'compare.bar_label': { en: 'Compare:', zh: '对比:' },
  'compare.bar_compare': { en: 'Compare →', zh: '对比 →' },
  'compare.bar_clear': { en: 'Clear', zh: '清空' },
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

export function useT(): { t: (key: string) => string; lang: Lang; setLang: (l: Lang) => void; fmt: (n: number) => string; rel: (iso: string) => string } {
  const [lang, setL] = useState<Lang>(currentLang);
  useEffect(() => {
    const fn = (l: Lang) => setL(l);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const nf = new Intl.NumberFormat(locale);
  return {
    lang,
    setLang,
    t: (key: string) => t(key, lang),
    fmt: (n: number) => nf.format(n),
    rel: (iso: string) => formatRelative(iso, lang),
  };
}

function formatRelative(iso: string, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (!d || Number.isNaN(d)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - d) / 1000));
  const en = lang === 'en';
  if (diffSec < 5) return en ? 'just now' : '刚刚';
  if (diffSec < 60) return en ? `${diffSec}s ago` : `${diffSec} 秒前`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return en ? `${m}m ago` : `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return en ? `${h}h ago` : `${h} 小时前`;
  const days = Math.floor(h / 24);
  if (days < 30) return en ? `${days}d ago` : `${days} 天前`;
  return new Date(iso).toLocaleDateString(en ? 'en-US' : 'zh-CN');
}
