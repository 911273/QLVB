// Đọc .docx trong trình duyệt, GIỮ ảnh (base64) và công thức (OMML -> text),
// rồi gom thành câu hỏi trắc nghiệm. Chạy hoàn toàn phía client.
// Công thức chuyển sang pseudo-LaTeX theo đúng cách phần mềm Midx: sqrt(x),
// (a/b), x^{2}... để đọc được mà không phụ thuộc bộ render toán học.

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Màu đỏ (đánh dấu đáp án đúng trong bản Word xuất từ Midx): FF0000 / EE0000...
function isRedColor(v) {
  if (!v) return false;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(v).trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r >= 150 && g <= 90 && b <= 90;
}
function attrW(el, name) {
  return el.getAttributeNS(W_NS, name) || el.getAttribute('w:' + name) || el.getAttribute(name);
}

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

// Định dạng ảnh trình duyệt hiển thị được (WMF/EMF thì KHÔNG).
const WEB_IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

/* ---------- Ảnh: id nhúng -> {uri, ext} ---------- */
function imgFromDrawing(el, embedMap) {
  const all = el.getElementsByTagName('*');
  for (const b of all) {
    const name = ln(b);
    if (name !== 'blip' && name !== 'imagedata') continue;
    const id = b.getAttributeNS(R_NS, 'embed') || b.getAttributeNS(R_NS, 'id')
      || b.getAttribute('r:embed') || b.getAttribute('r:id');
    if (id && embedMap[id]) return embedMap[id];
  }
  return null;
}

// Có URI hiển thị -> <img>; không thì placeholder gọn.
function imgHtml(im) {
  if (!im) return '';
  if (im.uri) return `<img src="${im.uri}" class="q-img" alt="hình"/>`;
  return `<span class="q-noimg" title="Ảnh ${(im.ext || '').toUpperCase()} không hiển thị được">🔣 [hình/công thức]</span>`;
}

/* ---------- WMF/EMF: trích bitmap DIB nhúng bên trong -> BMP ---------- */
// Nhiều WMF/EMF (từ MathType/Word) thực chất bọc quanh 1 ảnh raster (DIB).
// Ta quét BITMAPINFOHEADER (biSize=40, BI_RGB) rồi bọc thành file BMP hợp lệ.
function wmfExtractBmp(u8) {
  // Bỏ header placeable 22 byte của WMF nếu có.
  const b = (u8[0] === 0xd7 && u8[1] === 0xcd && u8[2] === 0xc6 && u8[3] === 0x9a) ? u8.subarray(22) : u8;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i + 40 <= b.length; i += 2) {
    if (dv.getUint32(i, true) !== 40) continue; // biSize
    const w = dv.getInt32(i + 4, true), h = dv.getInt32(i + 8, true);
    const planes = dv.getUint16(i + 12, true), bpp = dv.getUint16(i + 14, true), comp = dv.getUint32(i + 16, true);
    if (!(w > 0 && Math.abs(h) > 0 && w < 20000 && Math.abs(h) < 20000
      && planes === 1 && [1, 4, 8, 24, 32].includes(bpp) && comp === 0)) continue;
    const rowSize = Math.floor((w * bpp + 31) / 32) * 4;
    const palette = bpp <= 8 ? (1 << bpp) * 4 : 0;
    const imgSize = rowSize * Math.abs(h);
    const dibLen = 40 + palette + imgSize;
    if (i + dibLen > b.length) continue;
    const dib = b.subarray(i, i + dibLen);
    const offBits = 14 + 40 + palette;
    const out = new Uint8Array(14 + dib.length);
    const hv = new DataView(out.buffer);
    out[0] = 0x42; out[1] = 0x4d; // "BM"
    hv.setUint32(2, offBits + imgSize, true);
    hv.setUint32(10, offBits, true);
    out.set(dib, 14);
    return out;
  }
  return null;
}

// BMP (Uint8Array) -> PNG data URI qua canvas, thu nhỏ để nhẹ (tối đa 520px).
function bmpToPngDataUri(bmpBytes) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bmpBytes], { type: 'image/bmp' }));
    const img = new Image();
    img.onload = () => {
      const MAX = 520;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight || 1));
      const cw = Math.max(1, Math.round(img.naturalWidth * scale));
      const ch = Math.max(1, Math.round(img.naturalHeight * scale));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      try { resolve(cv.toDataURL('image/png')); } catch { resolve(''); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}

/* ---------- 1 paragraph -> {html, text, emphasized} ---------- */
function parseParagraph(pEl, embedMap) {
  let html = '', text = '', emphChars = 0, totalChars = 0, marked = false;

  function walk(node) {
    for (const child of node.children) {
      const name = ln(child);
      if (name === 'r') {
        const rPr = directChild(child, 'rPr');
        const strong = !!(rPr && (directChild(rPr, 'b') || directChild(rPr, 'u')));
        let redRun = false, hlRun = false;
        if (rPr) {
          const colEl = directChild(rPr, 'color');
          if (colEl && isRedColor(attrW(colEl, 'val'))) redRun = true;
          const hlEl = directChild(rPr, 'highlight');
          const hv = hlEl && attrW(hlEl, 'val');
          if (hv && hv !== 'none') hlRun = true;
        }
        let runText = '';
        for (const rc of child.children) {
          const rn = ln(rc);
          if (rn === 't') {
            const tx = rc.textContent || '';
            runText += tx;
            text += tx; totalChars += tx.length;
            html += strong ? `<strong>${esc(tx)}</strong>` : esc(tx);
            if (strong) emphChars += tx.length;
          } else if (rn === 'drawing' || rn === 'pict' || rn === 'object') {
            const im = imgFromDrawing(rc, embedMap);
            if (im) { html += imgHtml(im); text += ' [hình] '; }
          } else if (rn === 'br') { html += '<br/>'; text += ' '; }
          else if (rn === 'tab') { html += ' '; text += ' '; }
        }
        // Chỉ tính "đánh dấu" khi run tô đỏ/highlight CÓ nội dung chữ
        // (bỏ qua khoảng trắng bị bôi đỏ vô tình -> tránh nhận nhầm 2 đáp án).
        if ((redRun || hlRun) && /\S/.test(runText)) marked = true;
      } else if (name === 'oMath' || name === 'oMathPara') {
        const f = ommlToText(child).trim();
        if (f) { html += `<span class="q-math">${esc(f)}</span>`; text += ` ${f} `; totalChars += f.length; }
      } else if (name === 'drawing' || name === 'pict') {
        const im = imgFromDrawing(child, embedMap);
        if (im) { html += imgHtml(im); text += ' [hình] '; }
      } else {
        walk(child); // hyperlink, smartTag, ...
      }
    }
  }
  walk(pEl);

  const emphasized = totalChars > 0 && emphChars >= Math.max(3, totalChars * 0.5);
  return { html: html.trim(), text: text.replace(/\s+/g, ' ').trim(), emphasized, marked };
}

/* ---------- Bỏ nhãn "A."/"(A)"/"[<$>]" ở đầu html (nhãn chữ là TÙY CHỌN) ---------- */
const LABEL_RE = /^\s*(\[\s*<?\s*\$\s*>?\s*\]\s*)?[-•●▪]?\s*(?:(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s*)?/;
function stripLabelHtml(html) {
  const d = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
  const root = d.body.firstChild;
  // Tìm text node đầu tiên theo thứ tự, xóa phần nhãn.
  const walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) first.nodeValue = first.nodeValue.replace(LABEL_RE, '');
  return root.innerHTML.trim();
}

const HEADER_RE = /^\s*Câu\s*\d+\s*[:.\-]?\s*(?:\[[^\]]*\]\s*)?[:.\-]?\s*(.*)$/i;
const OPT_RE = /^\s*(\[\s*<?\s*\$\s*>?\s*\]\s*)?(\*?)\s*[-•●▪]?\s*(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s*(.+)$/;
// Marker đáp án kiểu Midx: "[<$>]" / "[$]" ở đầu dòng, KHÔNG cần nhãn chữ.
const MIDX_OPT = /^\s*\[\s*<?\s*\$\s*>?\s*\]\s*(.+)$/;
// Dòng chương/section: "[(<...>)] Chương ..." -> bỏ qua.
const CHAPTER_RE = /^\s*\[\s*\(/;

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
      const extn = (path.split('.').pop() || 'png').toLowerCase();
      let uri = '';
      if (WEB_IMG.has(extn)) {
        const b64 = await mf.async('base64');
        const mime = extn === 'jpg' ? 'image/jpeg' : `image/${extn}`;
        uri = `data:${mime};base64,${b64}`;
      } else if (extn === 'wmf' || extn === 'emf' || extn === 'wmz' || extn === 'emz') {
        // WMF/EMF: trích bitmap nhúng -> PNG (browser hiển thị được). Tự động.
        try {
          const u8 = await mf.async('uint8array');
          const bmp = wmfExtractBmp(u8);
          if (bmp) uri = await bmpToPngDataUri(bmp);
        } catch { /* không trích được -> placeholder */ }
      }
      embedMap[id] = { uri, ext: extn };
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
      // Thứ tự ưu tiên nhận diện đáp án đúng:
      //  1) Tô màu đỏ / highlight (bản Midx) — đúng 1 đáp án.
      //  2) Marker tường minh ([<$>]/*) chỉ trên MỘT SỐ đáp án (không phải tất cả).
      //  3) In đậm đúng 1 đáp án.
      const markedCount = opts.filter((o) => o.marked).length;
      const explicitCount = opts.filter((o) => o.explicit).length;
      const emphCount = opts.filter((o) => o.emph).length;
      let source = null;
      if (markedCount === 1) source = 'marked';
      else if (explicitCount >= 1 && explicitCount < opts.length) source = 'explicit';
      else if (emphCount === 1) source = 'emph';

      if (source) {
        const finalOpts = opts.map((o) => ({
          text: o.text.trim(),
          html: stripLabelHtml(o.html),
          correct: source === 'marked' ? o.marked : source === 'explicit' ? o.explicit : o.emph,
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
    if (CHAPTER_RE.test(p.text)) continue; // bỏ dòng chương "[(<...>)]"

    const midx = p.text.match(MIDX_OPT);
    const h = p.text.match(HEADER_RE);
    if (h && !midx && !OPT_RE.test(p.text)) {
      flush();
      cur = { stem: h[1] || '', stemHtml: stripHeaderHtml(p.html), options: [] };
      continue;
    }
    const m = p.text.match(OPT_RE);
    if (cur && (midx || m)) {
      // midx: marker "[<$>]" không nhãn chữ -> mọi đáp án đều có marker nên KHÔNG
      // dùng làm dấu đúng; đáp án đúng lấy từ p.marked (màu đỏ).
      cur.options.push({
        text: midx ? midx[1] : m[5],
        html: p.html,
        explicit: midx ? false : !!(m[1] || m[2]),
        emph: p.emphasized,
        marked: p.marked,
      });
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
  if (first) first.nodeValue = first.nodeValue.replace(/^\s*Câu\s*\d+\s*[:.\-]?\s*(?:\[[^\]]*\]\s*)?[:.\-]?\s*/i, '');
  return root.innerHTML.trim();
}
