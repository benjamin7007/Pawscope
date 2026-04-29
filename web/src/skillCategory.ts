// AUTO-GENERATED from skills-taxonomy.json — do not edit by hand.
// Regenerate with: python3 scripts/gen-skill-taxonomy.py
export type SkillCategoryId =
   'writing'
  | 'design'
  | 'video'
  | 'development'
  | 'devops'
  | 'research'
  | 'platforms'
  | 'business'
  | 'ai-methodology'
  | 'tools'
  | 'marketing'
;

export interface SkillCategoryDef {
  id: SkillCategoryId;
  labelZh: string;
  labelEn: string;
  description: string;
  iconHint: string;
}

export const SKILL_CATEGORIES: SkillCategoryDef[] = [
  { id: 'writing', labelZh: "写作阅读", labelEn: "Writing & Reading", description: "内容创作、文章写作、格式排版、翻译和阅读工具。", iconHint: 'BookOpen' },
  { id: 'design', labelZh: "画图设计", labelEn: "Design & Visuals", description: "设计工具、图表、图形、插图和视觉内容创建。", iconHint: 'PaintBrush' },
  { id: 'video', labelZh: "视频制作", labelEn: "Video & Media", description: "视频编辑、录制、转录和多媒体生产工具。", iconHint: 'Film' },
  { id: 'development', labelZh: "软件开发", labelEn: "Software Development", description: "代码模式、测试、安全、架构和语言特定工具。", iconHint: 'Code' },
  { id: 'devops', labelZh: "运行运维", labelEn: "Operations & DevOps", description: "部署、CI/CD、监控、基础设施和自动化工具。", iconHint: 'Cpu' },
  { id: 'research', labelZh: "搜索研究", labelEn: "Search & Research", description: "数据分析、网络研究、数据抓取和情报收集工具。", iconHint: 'Search' },
  { id: 'platforms', labelZh: "平台工具", labelEn: "Platform Integration", description: "Lark、GitHub、Jira等工作平台集成。", iconHint: 'Plug' },
  { id: 'business', labelZh: "业务合规", labelEn: "Business & Compliance", description: "CRM、计费、合规、监管和业务运营工具。", iconHint: 'Briefcase' },
  { id: 'ai-methodology', labelZh: "AI助手方法论", labelEn: "AI & Agent Methodology", description: "Agent模式、自主循环、团队协调和AI工作流。", iconHint: 'Brain' },
  { id: 'tools', labelZh: "工具集成", labelEn: "Tools & Utilities", description: "通用工具、CLI工具和杂项集成。", iconHint: 'Wrench' },
  { id: 'marketing', labelZh: "市场营销", labelEn: "Marketing & SEO", description: "营销自动化、SEO和推广内容工具。", iconHint: 'Megaphone' },
];

export const CATEGORY_ORDER: string[] = SKILL_CATEGORIES.map(c => c.id);

export interface SkillTaxonomyEntry {
  category: SkillCategoryId;
  popularity: number;
  summary: string;
  reason: string;
  languageTag: string | null;
}

export const SKILL_TAXONOMY: Record<string, SkillTaxonomyEntry> = {
  "agent-arch-design": { category: 'ai-methodology', popularity: 8, summary: "Agent 系统架构设计与框架选型", reason: "Agent architecture design (LangGraph/MCP/A2A)", languageTag: null },
  "agent-harness-construction": { category: 'design', popularity: 5, summary: "Design...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "agent-introspection-debugging": { category: 'design', popularity: 5, summary: "Structured...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "agent-reach": { category: 'research', popularity: 9, summary: "Give...", reason: "Foundational workflow tool with universal applicability.", languageTag: null },
  "agent-sort": { category: 'ai-methodology', popularity: 5, summary: "Build...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "agentic-engineering": { category: 'ai-methodology', popularity: 5, summary: "Operate...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "ai-daily-comic": { category: 'design', popularity: 6, summary: "AI 日报四格漫画+语音播报自动化", reason: "Daily AI news as 4-panel comic + voiceover", languageTag: null },
  "ai-daily-insight": { category: 'writing', popularity: 7, summary: "AI 每日洞察：架构师视角海报+知识库发布", reason: "Daily AI news architect-perspective insight post", languageTag: null },
  "ai-first-engineering": { category: 'ai-methodology', popularity: 5, summary: "Engineering...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "ai-regression-testing": { category: 'writing', popularity: 5, summary: "Regression...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "algorithmic-art": { category: 'design', popularity: 5, summary: "p5.js 生成艺术与算法绘图", reason: "Generative art via p5.js with seeded randomness", languageTag: null },
  "anbei-wechat": { category: 'writing', popularity: 9, summary: "袁安贝的微信公众号一键发布工作流", reason: "Personal one-click WeChat publishing workflow", languageTag: null },
  "anbei-xiaohongshu": { category: 'writing', popularity: 9, summary: "小红书自动发布工作流（含 Playwright 自动化）", reason: "Personal Xiaohongshu publishing automation", languageTag: null },
  "android-clean-architecture": { category: 'development', popularity: 5, summary: "Clean...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "api-connector-builder": { category: 'development', popularity: 5, summary: "Build...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "api-design": { category: 'design', popularity: 5, summary: "REST...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "arch-analysis": { category: 'ai-methodology', popularity: 7, summary: "分析框架/开源项目架构与设计哲学", reason: "Framework / open-source architecture analysis", languageTag: null },
  "article-writing": { category: 'writing', popularity: 5, summary: "Write...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "automation-audit-ops": { category: 'devops', popularity: 5, summary: "Evidence-first...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "autonomous-loops": { category: 'development', popularity: 5, summary: "\"Patterns...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "backend-patterns": { category: 'design', popularity: 5, summary: "Backend...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "baoyu-article-illustrator": { category: 'writing', popularity: 6, summary: "Analyzes...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-comic": { category: 'writing', popularity: 6, summary: "Knowledge...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-compress-image": { category: 'design', popularity: 6, summary: "Compresses...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "baoyu-cover-image": { category: 'writing', popularity: 6, summary: "Generates...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-danger-gemini-web": { category: 'design', popularity: 3, summary: "Generates...", reason: "Experimental/reverse-engineered; limited reliability.", languageTag: null },
  "baoyu-danger-x-to-markdown": { category: 'writing', popularity: 3, summary: "Converts...", reason: "Experimental/reverse-engineered; limited reliability.", languageTag: null },
  "baoyu-diagram": { category: 'design', popularity: 10, summary: "Create...", reason: "Universal design/content tool with broad applicability.", languageTag: null },
  "baoyu-format-markdown": { category: 'writing', popularity: 6, summary: "Formats...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-image-cards": { category: 'writing', popularity: 6, summary: "Generates...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-imagine": { category: 'design', popularity: 6, summary: "AI...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "baoyu-infographic": { category: 'writing', popularity: 6, summary: "Generate...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-markdown-to-html": { category: 'writing', popularity: 6, summary: "Converts...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-post-to-wechat": { category: 'writing', popularity: 6, summary: "Posts...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-post-to-weibo": { category: 'writing', popularity: 6, summary: "Posts...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-post-to-x": { category: 'writing', popularity: 6, summary: "Posts...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-slide-deck": { category: 'writing', popularity: 6, summary: "Generates...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-translate": { category: 'writing', popularity: 6, summary: "Translates...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-url-to-markdown": { category: 'writing', popularity: 6, summary: "Fetch...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "baoyu-youtube-transcript": { category: 'design', popularity: 6, summary: "Downloads...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "blueprint": { category: 'design', popularity: 5, summary: "Turn...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "brainstorming": { category: 'ai-methodology', popularity: 9, summary: "需求脑暴：在动手前梳理意图、需求与设计", reason: "Structured idea exploration before implementation", languageTag: null },
  "brand-guidelines": { category: 'design', popularity: 6, summary: "应用 Anthropic 官方品牌色与字体", reason: "Apply Anthropic brand colors and typography", languageTag: null },
  "brand-voice": { category: 'writing', popularity: 5, summary: "Build...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "canvas-design": { category: 'design', popularity: 7, summary: "PNG/PDF 海报与艺术品创作", reason: "Beautiful PNG/PDF poster art via design philosophy", languageTag: null },
  "carrier-relationship-management": { category: 'business', popularity: 5, summary: "Codified...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "claude-api": { category: 'design', popularity: 5, summary: "Anthropic...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "claude-devfleet": { category: 'ai-methodology', popularity: 5, summary: "Orchestrate...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "cli-anything": { category: 'tools', popularity: 5, summary: "\"CLI-Anything:...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "clickhouse-io": { category: 'development', popularity: 5, summary: "ClickHouse...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "code-tour": { category: 'development', popularity: 5, summary: "Create...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "coding-standards": { category: 'development', popularity: 5, summary: "Baseline...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "compose-multiplatform-patterns": { category: 'development', popularity: 7, summary: "Compose...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "configure-ecc": { category: 'tools', popularity: 5, summary: "Interactive...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "connections-optimizer": { category: 'research', popularity: 5, summary: "Reorganize...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "content-engine": { category: 'writing', popularity: 5, summary: "Create...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "content-hash-cache-pattern": { category: 'writing', popularity: 5, summary: "Cache...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "continuous-agent-loop": { category: 'ai-methodology', popularity: 5, summary: "Patterns...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "continuous-learning": { category: 'development', popularity: 5, summary: "Automatically...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "continuous-learning-v2": { category: 'devops', popularity: 5, summary: "Instinct-based...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "cost-aware-llm-pipeline": { category: 'devops', popularity: 5, summary: "Cost...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "council": { category: 'devops', popularity: 5, summary: "Convene...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "cpp-coding-standards": { category: 'development', popularity: 5, summary: "C++...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "cpp-testing": { category: 'design', popularity: 5, summary: "Use...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "cross-domain-insight": { category: 'ai-methodology', popularity: 6, summary: "跨领域同构映射与原则提炼", reason: "Cross-domain pattern transfer & insight", languageTag: null },
  "crosspost": { category: 'writing', popularity: 5, summary: "Multi-platform...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "csharp-testing": { category: 'development', popularity: 5, summary: "C#...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "customer-billing-ops": { category: 'design', popularity: 5, summary: "Operate...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "customs-trade-compliance": { category: 'business', popularity: 2, summary: "Codified...", reason: "Very narrow scope; experimental or unclear value.", languageTag: null },
  "dart-flutter-patterns": { category: 'design', popularity: 5, summary: "Production-ready...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "dashboard-builder": { category: 'design', popularity: 5, summary: "Build...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "data-scraper-agent": { category: 'research', popularity: 5, summary: "Build...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "database-migrations": { category: 'devops', popularity: 5, summary: "Database...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "deep-research": { category: 'research', popularity: 8, summary: "Multi-source...", reason: "High-value specialized tool in active use.", languageTag: null },
  "defi-amm-security": { category: 'design', popularity: 2, summary: "Security...", reason: "Very narrow scope; experimental or unclear value.", languageTag: null },
  "deployment-patterns": { category: 'development', popularity: 7, summary: "Deployment...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "dispatching-parallel-agents": { category: 'ai-methodology', popularity: 9, summary: "并行调度子 agent 的实战手册", reason: "Parallel sub-agent orchestration patterns", languageTag: null },
  "django-patterns": { category: 'design', popularity: 5, summary: "Django...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "django-security": { category: 'development', popularity: 7, summary: "Django...", reason: "development best-practice tool; high professional value.", languageTag: null },
  "django-tdd": { category: 'design', popularity: 5, summary: "Django...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "django-verification": { category: 'design', popularity: 5, summary: "\"Verification...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "dmux-workflows": { category: 'development', popularity: 5, summary: "Multi-agent...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "doc-coauthoring": { category: 'writing', popularity: 7, summary: "结构化文档协同写作流程", reason: "Structured workflow for co-authoring docs", languageTag: null },
  "docker-patterns": { category: 'development', popularity: 7, summary: "Docker...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "docx": { category: 'writing', popularity: 8, summary: "Word 文档读写与编辑", reason: "Create / read / edit Word .docx files", languageTag: null },
  "dotnet-patterns": { category: 'development', popularity: 7, summary: "Idiomatic...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "e2e-testing": { category: 'development', popularity: 5, summary: "Playwright...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "ecc-tools-cost-audit": { category: 'business', popularity: 5, summary: "Evidence-first...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "edge-ai-analysis": { category: 'ai-methodology', popularity: 7, summary: "端侧 AI 推理方案与 NPU 选型", reason: "Edge AI inference / NPU / quantization advice", languageTag: null },
  "email-ops": { category: 'devops', popularity: 5, summary: "Evidence-first...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "energy-procurement": { category: 'business', popularity: 5, summary: "Codified...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "enterprise-agent-ops": { category: 'development', popularity: 5, summary: "Operate...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "eval-harness": { category: 'ai-methodology', popularity: 5, summary: "Formal...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "evm-token-decimals": { category: 'design', popularity: 2, summary: "Prevent...", reason: "Very narrow scope; experimental or unclear value.", languageTag: null },
  "exa-search": { category: 'research', popularity: 8, summary: "Neural...", reason: "High-value specialized tool in active use.", languageTag: null },
  "executing-plans": { category: 'development', popularity: 9, summary: "按计划文档执行任务的工程纪律", reason: "Disciplined plan execution with checkpoints", languageTag: null },
  "fal-ai-media": { category: 'design', popularity: 5, summary: "Unified...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "finance-billing-ops": { category: 'devops', popularity: 5, summary: "Evidence-first...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "find-skills": { category: 'ai-methodology', popularity: 10, summary: "Helps...", reason: "Core infrastructure for discovering capabilities; foundational.", languageTag: null },
  "finishing-a-development-branch": { category: 'development', popularity: 8, summary: "收尾开发分支：合并、清理、PR", reason: "Closing out a dev branch cleanly", languageTag: null },
  "fireworks-tech-graph": { category: 'design', popularity: 4, summary: "烟花风格技术图（项目级 skill）", reason: "Fireworks-style technical graphic (project skill)", languageTag: null },
  "foundation-models-on-device": { category: 'development', popularity: 5, summary: "Apple...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "frontend-design": { category: 'design', popularity: 5, summary: "Create...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "frontend-patterns": { category: 'development', popularity: 7, summary: "Frontend...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "frontend-slides": { category: 'design', popularity: 5, summary: "Create...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "github-ops": { category: 'development', popularity: 6, summary: "GitHub...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "golang-patterns": { category: 'development', popularity: 8, summary: "Idiomatic...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "golang-testing": { category: 'design', popularity: 7, summary: "Go...", reason: "design best-practice tool; high professional value.", languageTag: null },
  "google-workspace-ops": { category: 'devops', popularity: 5, summary: "Operate...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "healthcare-phi-compliance": { category: 'design', popularity: 2, summary: "Protected...", reason: "Very narrow scope; experimental or unclear value.", languageTag: null },
  "hipaa-compliance": { category: 'design', popularity: 5, summary: "HIPAA-specific...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "hookify-rules": { category: 'writing', popularity: 5, summary: "This...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "huashu-nuwa": { category: 'design', popularity: 5, summary: "|...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "hv-analysis": { category: 'research', popularity: 5, summary: "|...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "hyperframes": { category: 'design', popularity: 5, summary: "Create...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "hyperframes-cli": { category: 'devops', popularity: 5, summary: "HyperFrames...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "internal-comms": { category: 'writing', popularity: 6, summary: "公司内部沟通文案撰写", reason: "Internal company communication writing helpers", languageTag: null },
  "inventory-demand-planning": { category: 'research', popularity: 5, summary: "Codified...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "investor-materials": { category: 'business', popularity: 5, summary: "Create...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "investor-outreach": { category: 'business', popularity: 5, summary: "Draft...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "iterative-retrieval": { category: 'development', popularity: 5, summary: "Pattern...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "java-coding-standards": { category: 'development', popularity: 6, summary: "\"Java...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "jira-integration": { category: 'development', popularity: 5, summary: "Use...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "jpa-patterns": { category: 'design', popularity: 5, summary: "JPA/Hibernate...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "khazix-writer": { category: 'writing', popularity: 5, summary: "|...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "knowledge-ops": { category: 'devops', popularity: 5, summary: "Knowledge...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "kotlin-coroutines-flows": { category: 'development', popularity: 5, summary: "Kotlin...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "kotlin-exposed-patterns": { category: 'development', popularity: 7, summary: "JetBrains...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "kotlin-ktor-patterns": { category: 'development', popularity: 7, summary: "Ktor...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "kotlin-patterns": { category: 'development', popularity: 7, summary: "Idiomatic...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "kotlin-testing": { category: 'design', popularity: 5, summary: "Kotlin...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "laravel-patterns": { category: 'development', popularity: 7, summary: "Laravel...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "laravel-plugin-discovery": { category: 'design', popularity: 5, summary: "Discover...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "laravel-security": { category: 'development', popularity: 7, summary: "Laravel...", reason: "development best-practice tool; high professional value.", languageTag: null },
  "laravel-tdd": { category: 'design', popularity: 5, summary: "Test-driven...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "laravel-verification": { category: 'design', popularity: 5, summary: "\"Verification...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "lark-approval": { category: 'platforms', popularity: 6, summary: "\"飞书审批 API：审批实例、审批任务管理。\"...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-attendance": { category: 'platforms', popularity: 6, summary: "\"飞书考勤打卡：查询自己的考勤打卡记录\"...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-base": { category: 'platforms', popularity: 6, summary: "\"当需要用...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-calendar": { category: 'platforms', popularity: 6, summary: "\"飞书日历（calendar）：提供日历与日程（会议）的全面...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-contact": { category: 'platforms', popularity: 6, summary: "\"飞书通讯录：查询组织架构、人员信息和搜索员工。获取当前用户...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-doc": { category: 'research', popularity: 10, summary: "\"飞书云文档：创建和编辑飞书文档。从...", reason: "Universal design/content tool with broad applicability.", languageTag: null },
  "lark-drive": { category: 'platforms', popularity: 6, summary: "\"飞书云空间：管理云空间中的文件和文件夹。上传和下载文件、创...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-event": { category: 'platforms', popularity: 6, summary: "\"飞书事件订阅：通过...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-im": { category: 'platforms', popularity: 10, summary: "\"飞书即时通讯：收发消息和管理群聊。发送和回复消息、搜索聊天...", reason: "Foundational workflow tool with universal applicability.", languageTag: null },
  "lark-mail": { category: 'research', popularity: 6, summary: "\"飞书邮箱...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "lark-minutes": { category: 'platforms', popularity: 6, summary: "\"飞书妙记：妙记相关基本功能。1.查询妙记列表（按关键词/所...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-okr": { category: 'platforms', popularity: 6, summary: "\"飞书...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-openapi-explorer": { category: 'development', popularity: 6, summary: "\"飞书/Lark...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "lark-shared": { category: 'platforms', popularity: 6, summary: "\"飞书/Lark...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-sheets": { category: 'research', popularity: 6, summary: "\"飞书电子表格：创建和操作电子表格。创建表格并写入表头和数据...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "lark-skill-maker": { category: 'ai-methodology', popularity: 6, summary: "\"创建...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "lark-slides": { category: 'design', popularity: 6, summary: "\"飞书幻灯片：以...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "lark-task": { category: 'platforms', popularity: 6, summary: "\"飞书任务：管理任务和清单。创建待办任务、查看和更新任务状态...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-vc": { category: 'platforms', popularity: 6, summary: "\"飞书视频会议：查询会议记录、获取会议纪要产物（总结、待办、...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-whiteboard": { category: 'platforms', popularity: 6, summary: "飞书画板：查询和编辑飞书云文档中的画板。支持导出画板为预览图...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-whiteboard-cli": { category: 'platforms', popularity: 6, summary: "当用户要求或使用飞书画板绘制架构图、流程图、思维导图、时序图...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-wiki": { category: 'platforms', popularity: 6, summary: "\"飞书知识库：管理知识空间、空间成员和文档节点。创建和查询知...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-workflow-meeting-summary": { category: 'platforms', popularity: 6, summary: "\"会议纪要整理工作流：汇总指定时间范围内的会议纪要并生成结构...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lark-workflow-standup-report": { category: 'platforms', popularity: 6, summary: "\"日程待办摘要：编排...", reason: "Platform integration with steady adoption.", languageTag: null },
  "lead-intelligence": { category: 'design', popularity: 5, summary: "AI-native...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "liquid-glass-design": { category: 'design', popularity: 5, summary: "iOS...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "llm-trading-agent-security": { category: 'design', popularity: 3, summary: "Security...", reason: "Specialized tool for specific use cases.", languageTag: null },
  "logistics-exception-management": { category: 'business', popularity: 5, summary: "Codified...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "manim-video": { category: 'design', popularity: 5, summary: "Build...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "market-research": { category: 'research', popularity: 5, summary: "Conduct...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "mcp-builder": { category: 'development', popularity: 7, summary: "构建高质量 MCP 服务器", reason: "Build high-quality MCP servers for tool integration", languageTag: null },
  "mcp-server-patterns": { category: 'development', popularity: 7, summary: "Build...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "mempalace": { category: 'design', popularity: 3, summary: "Persistent...", reason: "Specialized tool for specific use cases.", languageTag: null },
  "messages-ops": { category: 'design', popularity: 5, summary: "Evidence-first...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "nanoclaw-repl": { category: 'tools', popularity: 5, summary: "Operate...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "nestjs-patterns": { category: 'development', popularity: 7, summary: "NestJS...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "nodejs-keccak256": { category: 'development', popularity: 5, summary: "Prevent...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "nutrient-document-processing": { category: 'research', popularity: 3, summary: "Process,...", reason: "Specialized tool for specific use cases.", languageTag: null },
  "pdf": { category: 'writing', popularity: 8, summary: "PDF 读取/提取/合并/拆分/旋转", reason: "PDF read/extract/merge/split/rotate operations", languageTag: null },
  "perl-patterns": { category: 'development', popularity: 7, summary: "Modern...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "perl-security": { category: 'design', popularity: 5, summary: "Comprehensive...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "perl-testing": { category: 'design', popularity: 5, summary: "Perl...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "plankton-code-quality": { category: 'writing', popularity: 5, summary: "\"Write-time...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "playwright-cli": { category: 'development', popularity: 5, summary: "Browser...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "postgres-patterns": { category: 'design', popularity: 5, summary: "PostgreSQL...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "pptx": { category: 'design', popularity: 8, summary: "PowerPoint 幻灯片读写与生成", reason: "Create / read / edit PowerPoint .pptx decks", languageTag: null },
  "product-capability": { category: 'research', popularity: 5, summary: "Translate...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "production-scheduling": { category: 'research', popularity: 5, summary: "Codified...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "project-flow-ops": { category: 'devops', popularity: 5, summary: "Operate...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "prompt-optimizer": { category: 'writing', popularity: 5, summary: "Analyze...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "python-patterns": { category: 'development', popularity: 8, summary: "Pythonic...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "python-testing": { category: 'design', popularity: 7, summary: "Python...", reason: "design best-practice tool; high professional value.", languageTag: null },
  "quality-nonconformance": { category: 'business', popularity: 3, summary: "Codified...", reason: "Specialized tool for specific use cases.", languageTag: null },
  "ralphinho-rfc-pipeline": { category: 'development', popularity: 5, summary: "RFC-driven...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "receiving-code-review": { category: 'development', popularity: 7, summary: "处理 code review 反馈的标准流程", reason: "Responding to code review feedback", languageTag: null },
  "regex-vs-llm-structured-text": { category: 'development', popularity: 5, summary: "Decision...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "remotion-video-creation": { category: 'design', popularity: 5, summary: "Best...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "requesting-code-review": { category: 'development', popularity: 7, summary: "提交 code review 前的准备清单", reason: "Preparing changes for code review", languageTag: null },
  "research-ops": { category: 'devops', popularity: 5, summary: "Evidence-first...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "returns-reverse-logistics": { category: 'development', popularity: 5, summary: "Codified...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "rust-patterns": { category: 'development', popularity: 8, summary: "Idiomatic...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "rust-testing": { category: 'design', popularity: 7, summary: "Rust...", reason: "design best-practice tool; high professional value.", languageTag: null },
  "search-first": { category: 'development', popularity: 5, summary: "Research-before-coding...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "security-bounty-hunter": { category: 'development', popularity: 7, summary: "Hunt...", reason: "development best-practice tool; high professional value.", languageTag: null },
  "security-review": { category: 'development', popularity: 7, summary: "Use...", reason: "development best-practice tool; high professional value.", languageTag: null },
  "security-scan": { category: 'development', popularity: 7, summary: "Scan...", reason: "development best-practice tool; high professional value.", languageTag: null },
  "seo": { category: 'marketing', popularity: 5, summary: "Audit,...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "skill-creator": { category: 'ai-methodology', popularity: 9, summary: "创建、编辑、评估 skill 的元工具", reason: "Create / edit / measure performance of skills", languageTag: null },
  "skill-stocktake": { category: 'ai-methodology', popularity: 6, summary: "定期盘点已安装的 skills", reason: "Periodic audit of installed skills", languageTag: null },
  "slack-gif-creator": { category: 'design', popularity: 4, summary: "Slack 优化的动画 GIF 创作", reason: "Slack-optimized animated GIF creation", languageTag: null },
  "social-graph-ranker": { category: 'design', popularity: 5, summary: "Weighted...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "springboot-patterns": { category: 'design', popularity: 5, summary: "Spring...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "springboot-security": { category: 'development', popularity: 7, summary: "Spring...", reason: "development best-practice tool; high professional value.", languageTag: null },
  "springboot-tdd": { category: 'development', popularity: 7, summary: "Test-driven...", reason: "High-value specialized tool in active use.", languageTag: null },
  "springboot-verification": { category: 'design', popularity: 5, summary: "\"Verification...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "strategic-compact": { category: 'business', popularity: 3, summary: "Suggests...", reason: "Specialized tool for specific use cases.", languageTag: null },
  "subagent-driven-development": { category: 'ai-methodology', popularity: 9, summary: "用子 agent 驱动功能开发", reason: "Building features via sub-agent delegation", languageTag: null },
  "svg-infographic": { category: 'design', popularity: 8, summary: "SVG 信息图 → 高分辨率 PNG 输出", reason: "SVG infographic → high-res PNG creation", languageTag: null },
  "swift-actor-persistence": { category: 'design', popularity: 5, summary: "Thread-safe...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "swift-concurrency-6-2": { category: 'development', popularity: 5, summary: "Swift...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "swift-protocol-di-testing": { category: 'development', popularity: 5, summary: "Protocol-based...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "swiftui-patterns": { category: 'development', popularity: 7, summary: "SwiftUI...", reason: "Language-specific patterns; widely useful for developers.", languageTag: null },
  "systematic-debugging": { category: 'development', popularity: 9, summary: "科学方法论式系统化调试", reason: "Scientific-method debugging workflow", languageTag: null },
  "tdd-workflow": { category: 'design', popularity: 5, summary: "Use...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "team-builder": { category: 'ai-methodology', popularity: 5, summary: "Interactive...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "terminal-ops": { category: 'devops', popularity: 5, summary: "Evidence-first...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "test-driven-development": { category: 'development', popularity: 9, summary: "TDD：红绿重构的开发节奏", reason: "Red-green-refactor TDD discipline", languageTag: null },
  "theme-factory": { category: 'design', popularity: 6, summary: "10 套预设主题应用到各类制品", reason: "Apply preset themes to slides/docs/HTML artifacts", languageTag: null },
  "token-budget-advisor": { category: 'tools', popularity: 5, summary: "Offers...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "ui-demo": { category: 'writing', popularity: 5, summary: "Record...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "unified-notifications-ops": { category: 'devops', popularity: 5, summary: "Operate...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "using-git-worktrees": { category: 'development', popularity: 7, summary: "用 git worktree 并行多分支", reason: "Parallel branches via git worktree", languageTag: null },
  "using-superpowers": { category: 'ai-methodology', popularity: 8, summary: "superpowers skill 集合的入门指引", reason: "Meta guide to the superpowers skill set", languageTag: null },
  "verification-before-completion": { category: 'development', popularity: 9, summary: "完成前先验证：避免假完成", reason: "Verify-don’t-claim work is done", languageTag: null },
  "verification-loop": { category: 'development', popularity: 5, summary: "\"A...", reason: "Technical tool with niche but active usage.", languageTag: null },
  "video-creator": { category: 'video', popularity: 7, summary: "主题→图片→视频+旁白自动化创作", reason: "Topic→research→images→video+audio pipeline", languageTag: null },
  "video-editing": { category: 'video', popularity: 6, summary: "AI-assisted...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "videodb": { category: 'design', popularity: 5, summary: "See,...", reason: "Useful visual creation tool; moderate demand.", languageTag: null },
  "visa-doc-translate": { category: 'tools', popularity: 2, summary: "Translate...", reason: "Very narrow scope; experimental or unclear value.", languageTag: null },
  "web-artifacts-builder": { category: 'development', popularity: 7, summary: "多组件 React/Tailwind 制品构建", reason: "Multi-component React/Tailwind/shadcn artifacts", languageTag: null },
  "webapp-testing": { category: 'development', popularity: 7, summary: "Playwright 本地 web 应用测试", reason: "Playwright local web app testing toolkit", languageTag: null },
  "whiteboard-drawing": { category: 'design', popularity: 5, summary: "白板手绘风格作图", reason: "Whiteboard-style drawing skill", languageTag: null },
  "workspace-surface-audit": { category: 'tools', popularity: 5, summary: "Audit...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "writing-plans": { category: 'development', popularity: 9, summary: "如何写出可执行的 plan.md", reason: "How to author actionable plan.md", languageTag: null },
  "writing-skills": { category: 'ai-methodology', popularity: 8, summary: "如何编写新的 skill 文件", reason: "How to author new skills", languageTag: null },
  "x-api": { category: 'writing', popularity: 5, summary: "X/Twitter...", reason: "Specialized tool with moderate applicability.", languageTag: null },
  "xlsx": { category: 'business', popularity: 8, summary: "Excel/CSV 表格读写与编辑", reason: "Read / edit / fix .xlsx / .csv spreadsheet files", languageTag: null },
  "xr-arch-analysis": { category: 'ai-methodology', popularity: 6, summary: "XR/AR/VR 架构分析与空间计算设计", reason: "XR/AR/VR architecture analysis (OpenXR/SLAM)", languageTag: null },
};

export function categorize(name: string): SkillCategoryId {
  return SKILL_TAXONOMY[name]?.category ?? 'tools';
}

export function popularityFor(name: string): number {
  return SKILL_TAXONOMY[name]?.popularity ?? 1;
}

export function summaryFor(name: string): string | null {
  return SKILL_TAXONOMY[name]?.summary ?? null;
}

export function languageTagFor(name: string): string | null {
  return SKILL_TAXONOMY[name]?.languageTag ?? null;
}

const CATEGORY_LABEL_INDEX = (() => {
  const m = new Map<string, SkillCategoryDef>();
  for (const c of SKILL_CATEGORIES) m.set(c.id, c);
  return m;
})();

export function categoryLabel(id: string, lang: 'zh' | 'en' = 'zh'): string {
  const def = CATEGORY_LABEL_INDEX.get(id);
  if (!def) return id;
  return lang === 'zh' ? def.labelZh : def.labelEn;
}

export function categoryDef(id: string): SkillCategoryDef | undefined {
  return CATEGORY_LABEL_INDEX.get(id);
}
