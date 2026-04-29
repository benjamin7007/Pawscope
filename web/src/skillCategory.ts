// Best-effort categorization of skill names. Prefix-based matching with a
// keyword fallback for skills that don't follow a tool-specific prefix.

type Rule = { match: (name: string) => boolean; cat: string };

const RULES: Rule[] = [
  // Tool-specific prefixes (most specific first)
  { match: n => n.startsWith('lark-'), cat: 'Lark/Feishu' },
  { match: n => n.startsWith('baoyu-'), cat: 'Content (Baoyu)' },
  { match: n => n.startsWith('gsd-'), cat: 'GSD Workflow' },
  { match: n => n.startsWith('hookify') || n === 'hookify-rules', cat: 'Hookify' },
  { match: n => n.startsWith('instinct-'), cat: 'Instinct' },
  { match: n => n.startsWith('ralphinho-'), cat: 'Ralphinho' },
  { match: n => n.startsWith('devfleet'), cat: 'DevFleet' },
  { match: n => n.startsWith('gan-'), cat: 'GAN Harness' },
  { match: n => n.startsWith('superpowers:'), cat: 'Superpowers' },
  { match: n => n.startsWith('claw') || n === 'nanoclaw-repl', cat: 'Claw' },
  { match: n => n.startsWith('hv-') || n.startsWith('huashu-'), cat: 'Misc Tools' },

  // Languages
  { match: n => n.startsWith('kotlin-'), cat: 'Kotlin' },
  { match: n => n.startsWith('java-'), cat: 'Java/JVM' },
  { match: n => n.startsWith('springboot-'), cat: 'Java/JVM' },
  { match: n => n.startsWith('python-'), cat: 'Python' },
  { match: n => n.startsWith('django-'), cat: 'Python' },
  { match: n => n.startsWith('go-') || n.startsWith('golang-'), cat: 'Go' },
  { match: n => n.startsWith('rust-'), cat: 'Rust' },
  { match: n => n.startsWith('cpp-'), cat: 'C++' },
  { match: n => n.startsWith('csharp-') || n.startsWith('dotnet-'), cat: 'C#/.NET' },
  { match: n => n.startsWith('swift-') || n.startsWith('swiftui-'), cat: 'Swift' },
  { match: n => n.startsWith('dart-') || n.startsWith('flutter-') || n.includes('compose-multiplatform'), cat: 'Dart/Flutter' },
  { match: n => n.startsWith('typescript-') || n.startsWith('nextjs-') || n.startsWith('react-') || n.startsWith('nodejs-') || n.startsWith('nestjs-'), cat: 'TS/Node/Web' },
  { match: n => n.startsWith('laravel-'), cat: 'PHP/Laravel' },
  { match: n => n.startsWith('perl-'), cat: 'Perl' },

  // Cross-cutting domains
  { match: n => n.startsWith('security-') || n === 'hipaa-compliance' || n.includes('security'), cat: 'Security' },
  { match: n => n.includes('test') || n === 'tdd-workflow' || n === 'verification-loop' || n.includes('verify') || n === 'e2e-testing', cat: 'Testing' },
  { match: n => n.includes('review') || n.includes('audit'), cat: 'Code Review' },
  { match: n => n.startsWith('database') || n.startsWith('postgres') || n.startsWith('clickhouse') || n.startsWith('jpa') || n.startsWith('django-') === false && n.includes('migration'), cat: 'Database' },
  { match: n => n.startsWith('docker') || n.startsWith('deployment') || n.includes('agent-harness') || n.includes('devfleet'), cat: 'DevOps' },

  // AI/Agent
  { match: n =>
      n.includes('agent') || n.includes('llm') || n.includes('prompt') || n === 'eval-harness' ||
      n === 'iterative-retrieval' || n === 'continuous-learning' || n === 'continuous-learning-v2' ||
      n === 'continuous-agent-loop' || n === 'autonomous-loops' || n === 'cost-aware-llm-pipeline' ||
      n.startsWith('ai-') || n === 'mcp-server-patterns' || n === 'claude-api',
    cat: 'AI/Agent' },

  // Workflow / planning / debugging
  { match: n =>
      n === 'brainstorming' || n === 'executing-plans' || n === 'writing-plans' ||
      n === 'subagent-driven-development' || n === 'using-git-worktrees' ||
      n === 'finishing-a-development-branch' || n === 'requesting-code-review' ||
      n === 'receiving-code-review' || n === 'verification-before-completion' ||
      n === 'writing-skills' || n === 'using-superpowers' ||
      n === 'systematic-debugging' || n === 'dispatching-parallel-agents' ||
      n === 'plan' || n === 'checkpoint' || n.startsWith('prp-'),
    cat: 'Workflow' },

  // Operations / domain ops
  { match: n => n.endsWith('-ops') || n.includes('-billing') || n.includes('finance-') || n.includes('procurement') || n.includes('logistics'), cat: 'Domain Ops' },
];

export function categorize(name: string): string {
  for (const r of RULES) {
    if (r.match(name)) return r.cat;
  }
  return 'Other';
}

// Visual order for category dropdowns / grouped lists.
export const CATEGORY_ORDER: string[] = [
  'GSD Workflow',
  'Workflow',
  'Code Review',
  'Testing',
  'Security',
  'AI/Agent',
  'Lark/Feishu',
  'Content (Baoyu)',
  'Superpowers',
  'Hookify',
  'Instinct',
  'Ralphinho',
  'DevFleet',
  'GAN Harness',
  'Claw',
  'Kotlin',
  'Java/JVM',
  'Python',
  'Go',
  'Rust',
  'C++',
  'C#/.NET',
  'Swift',
  'Dart/Flutter',
  'TS/Node/Web',
  'PHP/Laravel',
  'Perl',
  'Database',
  'DevOps',
  'Domain Ops',
  'Misc Tools',
  'Other',
];
