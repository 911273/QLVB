// Đọc .docx trong trình duyệt, GIỮ ảnh (base64) và công thức (OMML -> text),
// rồi gom thành câu hỏi trắc nghiệm. Chạy hoàn toàn phía client.
// Công thức chuyển sang pseudo-LaTeX theo đúng cách phần mềm Midx: sqrt(x),
// (a/b), x^{2}... để đọc được mà không phụ thuộc bộ render toán học.

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function ln(el) { return el.localName || el.nodeName.split(':').pop(); }
function directChild(node, name) { return [...node.children].find((c) => ln(c) === name); }

/* ---------- OMML (công thức) -> text ---------- */
function convChildren(node) { let o = ''; for (const c of node.children) o += ommlToText(c); return o; }
function childConv(node, name) { const el = directChild(node, name); return el ? convChildren(el) : ''; }
function ommlToText(node) {
  const t = ln(node);
  if (t === 't') return node.textContent || '';
  if (t === 'f') return `(${childConv(node, 'num')}/${childConv(node, 'den')})`;
  if (t === 'rad') { const deg = childConv(node, 'deg'); const e = childConv(node, 'e'); return deg.trim() ? `root(${deg},${e})` : `sqrt(${e})`; }
  if (t === 'sSup') return `${childConv(node, 'e')}^{${childConv(node, 'sup')}}`;
  if (t === 'sSub') return `${childConv(node, 'e')}_{${childConv(node, 'sub')}}`;
  if (t === 'sSubSup') return `${childConv(node, 'e')}_{${childConv(node, 'sub')}}^{${childConv(node, 'sup')}}`;
  if (t === 'd') return `(${convChildren(node)})`; // delimiter
  if (t === 'nary') return `${convChildren(directChild(node, 'e') || node)}`;
  return convChildren(node);
}

/* ---------- Ảnh: id nhúng -> data URI ---------- */
function imgFromDrawing(el, embedMap) {
  const all = el.getElementsByTagName('*');
  for (const b of all) {
    const name = ln(b);
    if (name !== 'blip' && name !== 'imagedata') continue;
    const id = b.getAttributeNS(R_NS, 'embed') || b.getAttributeNS(R_NS, 'id')
      || b.getAttribute('r:embed') || b.getAttribute('r:id');
    if (id && embedMap[id]) return embedMap[id];
  }
  return '';
}

/* ---------- 1 paragraph -> {html, text, emphasized} ---------- */
function parseParagraph(pEl, embedMap) {
  let html = '', text = '', emphChars = 0, totalChars = 0;

  function walk(node) {
    for (const child of node.children) {
      const name = ln(child);
      if (name === 'r') {
        const rPr = directChild(child, 'rPr');
        const strong = !!(rPr && (directChild(rPr, 'b') || directChild(rPr, 'u')));
        for (const rc of child.children) {
          const rn = ln(rc);
          if (rn === 't') {
            const tx = rc.textContent || '';
            text += tx; totalChars += tx.length;
            html += strong ? `<strong>${esc(tx)}</strong>` : esc(tx);
            if (strong) emphChars += tx.length;
          } else if (rn === 'drawing' || rn === 'pict' || rn === 'object') {
            const uri = imgFromDrawing(rc, embedMap);
            if (uri) { html += `<img src="${uri}" class="q-img" alt="hình"/>`; text += ' [hình] '; }
          } else if (rn === 'br') { html += '<br/>'; text += ' '; }
          else if (rn === 'tab') { html += ' '; text += ' '; }
        }
      } else if (name === 'oMath' || name === 'oMathPara') {
        const f = ommlToText(child).trim();
        if (f) { html += `<span class="q-math">${esc(f)}</span>`; text += ` ${f} `; totalChars += f.length; }
      } else if (name === 'drawing' || name === 'pict') {
        const uri = imgFromDrawing(child, embedMap);
        if (uri) { html += `<img src="${uri}" class="q-img" alt="hình"/>`; text += ' [hình] '; }
      } else {
        walk(child); // hyperlink, smartTag, ...
      }
    }
  }
  walk(pEl);

  const emphasized = totalChars > 0 && emphChars >= Math.max(3, totalChars * 0.5);
  return { html: html.trim(), text: text.replace(/\s+/g, ' ').trim(), emphasized };
}

/* ---------- Bỏ nhãn "A."/"(A)"/"[<$>]" ở đầu html ---------- */
const LABEL_RE = /^\s*(\[\s*<?\s*\$\s*>?\s*\]\s*)?[-•●▪]?\s*(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s*/;
function stripLabelHtml(html) {
  const d = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
  const root = d.body.firstChild;
  // Tìm text node đầu tiên theo thứ tự, xóa phần nhãn.
  const walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) first.nodeValue = first.nodeValue.replace(LABEL_RE, '');
  return root.innerHTML.trim();
}

const HEADER_RE = /^\s*Câu\s*\d+\s*[:.\-]?\s*(?:\[\s*<[^>]*>\s*\])?\s*(.*)$/i;
const OPT_RE = /^\s*(\[\s*<?\s*\$\s*>?\s*\]\s*)?(\*?)\s*[-•●▪]?\s*(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s*(.+)$/;

/**
 * Đọc file .docx -> danh sách câu hỏi (giữ ảnh & công thức trong html).
 * @param {ArrayBuffer} arrayBuffer nội dung file .docx.
 * @returns {Promise<{questions:Array, errors:string[]}>}
 */
export async function parseDocxToQuestions(arrayBuffer) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('File .docx không hợp lệ (thiếu document.xml).');

  // Map quan hệ ảnh: rId -> data URI.
  const embedMap = {};
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    const rd = new DOMParser().parseFromString(relsXml, 'application/xml');
    for (const rel of rd.getElementsByTagName('Relationship')) {
      const id = rel.getAttribute('Id');
      let target = rel.getAttribute('Target') || '';
      if (!id || !/image/i.test(rel.getAttribute('Type') || '') && !/media/i.test(target)) continue;
      const path = target.startsWith('/') ? target.slice(1) : 'word/' + target.replace(/^\.\//, '');
      const mf = zip.file(path);
      if (!mf) continue;
      const b64 = await mf.async('base64');
      const extn = (path.split('.').pop() || 'png').toLowerCase();
      const mime = extn === 'jpg' ? 'image/jpeg' : extn === 'emf' ? 'image/x-emf' : `image/${extn}`;
      embedMap[id] = `data:${mime};base64,${b64}`;
    }
  }

  const xml = await docFile.async('string');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = [];
  for (const p of dom.getElementsByTagName('*')) {
    if (ln(p) === 'p') paras.push(parseParagraph(p, embedMap));
  }

  return groupQuestions(paras);
}

/** Gom đoạn văn thành câu hỏi (giữ html cho stem/đáp án). */
function groupQuestions(paras) {
  const questions = [];
  const errors = [];
  let cur = null;
  let seq = 0;

  const flush = () => {
    if (!cur) return;
    const opts = cur.options;
    if (opts.length >= 2) {
      const hasExplicit = opts.some((o) => o.explicit);
      const emphCount = opts.filter((o) => o.emph).length;
      const useEmph = !hasExplicit && emphCount === 1;
      if (hasExplicit || useEmph) {
        const finalOpts = opts.map((o) => ({
          text: o.text.trim(),
          html: stripLabelHtml(o.html),
          correct: hasExplicit ? o.explicit : o.emph,
        }));
        questions.push({
          id: 'qd' + Date.now() + '_' + (seq++),
          stem: cur.stem.trim(), stemHtml: cur.stemHtml.trim(),
          options: finalOpts, diff: '', chapter: '',
        });
      } else {
        errors.push(`"${cur.stem.slice(0, 28)}…": chưa xác định được đáp án đúng.`);
      }
    } else if (cur.stem) {
      errors.push(`"${cur.stem.slice(0, 28)}…": thiếu đáp án.`);
    }
    cur = null;
  };

  for (const p of paras) {
    if (!p.text && !p.html) continue;
    const h = p.text.match(HEADER_RE);
    if (h && !OPT_RE.test(p.text)) {
      flush();
      // stemHtml: bỏ tiền tố "Câu n" khỏi html.
      const stemHtml = stripHeaderHtml(p.html);
      cur = { stem: h[1] || '', stemHtml, options: [] };
      continue;
    }
    const m = p.text.match(OPT_RE);
    if (m && cur) {
      cur.options.push({ text: m[5], html: p.html, explicit: !!(m[1] || m[2]), emph: p.emphasized });
    } else if (cur) {
      if (cur.options.length) {
        const last = cur.options[cur.options.length - 1];
        last.text += ' ' + p.text; last.html += ' ' + p.html;
      } else {
        cur.stem += (cur.stem ? ' ' : '') + p.text;
        cur.stemHtml += (cur.stemHtml ? ' ' : '') + p.html;
      }
    }
  }
  flush();
  return { questions, errors };
}

function stripHeaderHtml(html) {
  const d = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
  const root = d.body.firstChild;
  const walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) first.nodeValue = first.nodeValue.replace(/^\s*Câu\s*\d+\s*[:.\-]?\s*(?:\[\s*<[^>]*>\s*\])?\s*/i, '');
  return root.innerHTML.trim();
}
