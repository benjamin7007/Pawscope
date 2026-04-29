// Tiny dependency-free Markdown renderer for SKILL.md preview.
// Handles: headings, fenced code, inline code, bold/italic, links, lists, hr, blockquote, paragraphs.
// All output is escaped — no raw HTML passthrough.

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(s: string): string {
  // Order matters: code first (so its content isn't further processed).
  const parts: string[] = [];
  let rest = s;
  const codeRe = /`([^`\n]+)`/;
  while (true) {
    const m = rest.match(codeRe);
    if (!m) break;
    const [full, code] = m;
    const idx = m.index ?? 0;
    parts.push(processNonCode(rest.slice(0, idx)));
    parts.push(`<code class="px-1 py-0.5 rounded bg-slate-800 text-amber-200 text-[0.85em]">${esc(code)}</code>`);
    rest = rest.slice(idx + full.length);
  }
  parts.push(processNonCode(rest));
  return parts.join('');
}

function processNonCode(s: string): string {
  let out = esc(s);
  // [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    const safe = /^(https?:|mailto:|#|\/)/i.test(url) ? url : '#';
    return `<a href="${esc(safe)}" target="_blank" rel="noreferrer" class="text-emerald-300 underline decoration-dotted">${esc(text)}</a>`;
  });
  // **bold**
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="text-slate-100">$1</strong>');
  // *italic* / _italic_
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(md: string): string {
  // Strip YAML frontmatter (--- ... ---).
  const lines = md.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
  }
  const out: string[] = [];
  let para: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inCode = false;
  let codeLang = '';
  let codeBuf: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p class="my-2 leading-relaxed text-slate-300">${renderInline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block.
    if (line.startsWith('```')) {
      if (inCode) {
        out.push(
          `<pre class="my-3 p-3 rounded bg-slate-900/80 border border-slate-800 overflow-x-auto text-[12px] text-slate-200"><code data-lang="${esc(codeLang)}">${esc(codeBuf.join('\n'))}</code></pre>`,
        );
        codeBuf = [];
        codeLang = '';
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // Heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = h[1].length;
      const sizes = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm'];
      out.push(
        `<h${level} class="font-semibold text-slate-100 mt-4 mb-2 ${sizes[level - 1]}">${renderInline(h[2])}</h${level}>`,
      );
      continue;
    }

    // Horizontal rule.
    if (/^---+\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr class="my-3 border-slate-800" />');
      continue;
    }

    // Lists.
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const wantType: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType !== wantType) {
        flushList();
        listType = wantType;
        out.push(
          listType === 'ul'
            ? '<ul class="my-2 ml-5 list-disc text-slate-300 space-y-0.5">'
            : '<ol class="my-2 ml-5 list-decimal text-slate-300 space-y-0.5">',
        );
      }
      out.push(`<li>${renderInline((ul ?? ol)![1])}</li>`);
      continue;
    } else if (listType) {
      flushList();
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      flushPara();
      out.push(
        `<blockquote class="my-2 pl-3 border-l-2 border-slate-700 text-slate-400 italic">${renderInline(line.replace(/^>\s?/, ''))}</blockquote>`,
      );
      continue;
    }

    // Blank line — flush paragraph.
    if (line.trim() === '') {
      flushPara();
      continue;
    }

    // Otherwise accumulate paragraph.
    para.push(line);
  }
  flushPara();
  flushList();
  if (inCode) {
    out.push(
      `<pre class="my-3 p-3 rounded bg-slate-900/80 border border-slate-800 overflow-x-auto text-[12px] text-slate-200"><code>${esc(codeBuf.join('\n'))}</code></pre>`,
    );
  }
  return out.join('\n');
}
