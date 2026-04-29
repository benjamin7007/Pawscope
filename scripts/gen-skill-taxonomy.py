import json, sys
d = json.load(open(sys.argv[1]))

cats = d['categories']
# Drop empty buckets entirely
non_empty = {c['id'] for c in cats if d['stats']['by_category'].get(c['id'], 0) > 0}

# Re-route any skill whose category is empty to "tools"
mapping = {}
for s in d['skills']:
    cid = s['category'] if s['category'] in non_empty else 'tools'
    mapping[s['name']] = {
        'category': cid,
        'popularity': s['popularity'],
        'summary': s['summary_zh'],
        'reason': s.get('popularity_reason', ''),
        'language_tag': s.get('language_tag'),
    }

cats = [c for c in cats if c['id'] in non_empty]

print('// AUTO-GENERATED from skills-taxonomy.json — do not edit by hand.')
print('// Regenerate with: python3 scripts/gen-skill-taxonomy.py')
print('export type SkillCategoryId =')
for i, c in enumerate(cats):
    sep = '|' if i else ''
    print(f"  {sep} '{c['id']}'")
print(';')
print()
print('export interface SkillCategoryDef {')
print('  id: SkillCategoryId;')
print('  labelZh: string;')
print('  labelEn: string;')
print('  description: string;')
print('  iconHint: string;')
print('}')
print()
print('export const SKILL_CATEGORIES: SkillCategoryDef[] = [')
for c in cats:
    print(f"  {{ id: '{c['id']}', labelZh: {json.dumps(c['label_zh'], ensure_ascii=False)}, labelEn: {json.dumps(c['label_en'])}, description: {json.dumps(c['description'], ensure_ascii=False)}, iconHint: '{c['icon_hint']}' }},")
print('];')
print()
print('export const CATEGORY_ORDER: string[] = SKILL_CATEGORIES.map(c => c.id);')
print()
print('export interface SkillTaxonomyEntry {')
print('  category: SkillCategoryId;')
print('  popularity: number;')
print('  summary: string;')
print('  reason: string;')
print('  languageTag: string | null;')
print('}')
print()
print('export const SKILL_TAXONOMY: Record<string, SkillTaxonomyEntry> = {')
for name in sorted(mapping):
    e = mapping[name]
    lang = json.dumps(e['language_tag'])
    print(f"  {json.dumps(name)}: {{ category: '{e['category']}', popularity: {e['popularity']}, summary: {json.dumps(e['summary'], ensure_ascii=False)}, reason: {json.dumps(e['reason'], ensure_ascii=False)}, languageTag: {lang} }},")
print('};')
print()
print('export function categorize(name: string): SkillCategoryId {')
print("  return SKILL_TAXONOMY[name]?.category ?? 'tools';")
print('}')
print()
print('export function popularityFor(name: string): number {')
print('  return SKILL_TAXONOMY[name]?.popularity ?? 1;')
print('}')
print()
print('export function summaryFor(name: string): string | null {')
print('  return SKILL_TAXONOMY[name]?.summary ?? null;')
print('}')
print()
print('export function languageTagFor(name: string): string | null {')
print('  return SKILL_TAXONOMY[name]?.languageTag ?? null;')
print('}')
print()
print('const CATEGORY_LABEL_INDEX = (() => {')
print('  const m = new Map<string, SkillCategoryDef>();')
print('  for (const c of SKILL_CATEGORIES) m.set(c.id, c);')
print('  return m;')
print('})();')
print()
print("export function categoryLabel(id: string, lang: 'zh' | 'en' = 'zh'): string {")
print('  const def = CATEGORY_LABEL_INDEX.get(id);')
print('  if (!def) return id;')
print("  return lang === 'zh' ? def.labelZh : def.labelEn;")
print('}')
print()
print('export function categoryDef(id: string): SkillCategoryDef | undefined {')
print('  return CATEGORY_LABEL_INDEX.get(id);')
print('}')
