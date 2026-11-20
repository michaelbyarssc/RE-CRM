// The measuring functions of the layout check. Every function in this file
// runs INSIDE the browser page (capture.mjs hands it to page.evaluate), so it
// can only use what the page has: the document, the window, and the helpers
// that HELPERS installs as window.__lt. It cannot use anything from Node or
// from the top of this file.
//
// - HELPERS: small shared helpers (is it drawn, which words are on which line).
// - GENERIC: the checks that run on every view. They count text that is
//   clipped, boxes that scroll sideways, things that spill out of their box,
//   lone last words, field hints that are cut and a button inside a button.
// - T_...: targeted checks, each for one spot on one screen (the leads table,
//   the side menu email, the calendar month, and so on).
//
// All of them only read the page. T_LEADS_PAGING scrolls the list to its end.

// ---------------------------------------------------------------- shared helpers
// Installed once per document as window.__lt (capture.mjs does it before every check).
export const HELPERS = () => {
  if (window.__lt) return;
  const visible = (el) => {
    if (!el || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  const cssPath = (el) => {
    const parts = [];
    let e = el;
    for (let i = 0; e && e.nodeType === 1 && i < 4; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += `#${e.id}`;
      const ds = e.getAttribute("data-slot");
      if (ds) s += `[data-slot=${ds}]`;
      const cls = [...e.classList].filter((c) => !/[:\[\]/]/.test(c)).slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      parts.unshift(s);
      if (e.id) break;
    }
    return parts.join(" > ");
  };
  // Words grouped into rendered lines.
  const lines = (el) => {
    const words = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const re = /\S+/g;
      let m;
      while ((m = re.exec(n.data))) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        const rects = [...r.getClientRects()].filter((q) => q.width > 0);
        if (!rects.length) continue;
        // A word broken over two lines (for example "follow-" / "ups") counts on each line.
        const pieces = [];
        for (const q of rects) {
          const last = pieces[pieces.length - 1];
          if (last && Math.abs(last.top - q.top) < 4) {
            last.right = Math.max(last.right, q.right);
          } else pieces.push({ top: q.top, bottom: q.bottom, left: q.left, right: q.right, h: q.height });
        }
        for (const q of pieces)
          words.push({ w: m[0], mid: (q.top + q.bottom) / 2, h: q.h, right: q.right, left: q.left });
      }
    }
    const out = [];
    for (const wd of words) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.mid - wd.mid) < Math.max(4, wd.h / 2)) last.words.push(wd);
      else out.push({ mid: wd.mid, words: [wd] });
    }
    return out.map((l) => ({
      text: l.words.map((x) => x.w).join(" "),
      count: l.words.length,
      left: Math.min(...l.words.map((x) => x.left)),
      right: Math.max(...l.words.map((x) => x.right)),
    }));
  };
  const textLines = (el) => {
    const ls = lines(el);
    return {
      lines: ls.length,
      lastLineWords: ls.length ? ls[ls.length - 1].count : 0,
      lastLine: ls.length ? ls[ls.length - 1].text : "",
      all: ls.map((l) => l.text),
    };
  };
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    };
  };
  const textRight = (el) => {
    const ls = lines(el);
    return ls.length ? Math.max(...ls.map((l) => l.right)) : null;
  };
  const round = (v) => (v == null ? v : Math.round(v * 10) / 10);
  // Rendered lines counted from every text fragment (catches a word that breaks at a hyphen).
  const fragLines = (el) => {
    const mids = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = tw.nextNode())) {
      if (!t.data.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(t);
      for (const q of r.getClientRects()) if (q.width > 0.5 && q.height > 0) mids.push((q.top + q.bottom) / 2);
    }
    mids.sort((a, b) => a - b);
    let n = 0,
      last = -1e9;
    for (const m of mids) {
      if (m - last > 4) {
        n++;
        last = m;
      }
    }
    return n;
  };
  // Leads list. Code from before pull request 5 (November 2026) has no data-leads-view marks,
  // so both ways of finding the table and the cards are tried: whichever block is drawn is measured.
  const leadsTable = () =>
    [...document.querySelectorAll("[data-leads-view=table] [data-slot=table], main [data-slot=table]")].find(
      (t) => t.getClientRects().length
    ) || null;
  const leadsCards = () =>
    [document.querySelector("[data-leads-view=cards]"), document.querySelector("main div.md\\:hidden.space-y-3")].find(
      (e) => e && e.getClientRects().length && getComputedStyle(e).display !== "none"
    ) || null;
  // The add-tag "+" in a card or in a Tags cell.
  // alone: nothing else (status box, tag) shares its line in the tags area.
  // underLastTag: it sits on a line below the last tag chip.
  const plusInfo = (scope) => {
    // The "+" itself: a dashed-border <button> in old code, a dashed-border <span> inside
    // its trigger button since pull request 6 (no button inside a button).
    const plus = scope.querySelector(".border-dashed");
    if (!plus || !plus.getClientRects().length) return null;
    const tail = plus.closest("[data-slot=lead-tags-tail]");
    const area = (tail ? tail.parentElement : plus.parentElement).closest(".flex-wrap") || scope;
    const p = plus.getBoundingClientRect();
    const mid = (p.top + p.bottom) / 2;
    const others = [...area.querySelectorAll("[data-slot=select-trigger], [data-slot=badge]")]
      .filter((e) => e.getClientRects().length)
      .map((e) => e.getBoundingClientRect());
    // A "+" that is the only thing in the area (a lead with no tags, in the table) is not "alone" by accident.
    const alone = others.length > 0 && !others.some((r) => Math.abs((r.top + r.bottom) / 2 - mid) < 8);
    const chips = [...area.querySelectorAll("[data-slot=badge]")].filter((e) => e.getClientRects().length);
    const last = chips[chips.length - 1]?.getBoundingClientRect();
    const underLastTag = last ? mid > (last.top + last.bottom) / 2 + 8 : false;
    return { alone, underLastTag };
  };
  window.__lt = {
    visible,
    cssPath,
    lines,
    textLines,
    rect,
    textRight,
    round,
    fragLines,
    leadsTable,
    leadsCards,
    plusInfo,
  };
};

export const GENERIC = () => {
  const { visible, cssPath, textLines, round } = window.__lt;
  const out = {
    pageScroll: { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth },
    overflow: [],
    orphans: [],
    placeholders: [],
  };
  out.pageScroll.has = out.pageScroll.scrollWidth > out.pageScroll.innerWidth;
  // A <button> inside a <button> (invalid HTML; React reports it as error 418 after hydration).
  const nested = [...document.querySelectorAll("button button")];
  out.nestedButtons = { all: nested.length, drawn: nested.filter((b) => b.getClientRects().length).length };
  const spillSel = "button, a, [role=combobox], [data-slot]";
  const vw = innerWidth,
    vh = innerHeight;
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("svg") || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
    const sw = el.scrollWidth,
      cw = el.clientWidth;
    if (cw <= 2 || sw <= cw + 1) continue;
    if (el.classList.contains("sr-only") || el.closest(".leaflet-container")) continue;
    const text = (el.innerText || "").trim().replace(/\s+/g, " ");
    if (!text || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const ox = cs.overflowX,
      to = cs.textOverflow;
    let kind;
    if (to === "ellipsis" || ox === "hidden" || ox === "clip") kind = "clipped";
    else if (ox === "auto" || ox === "scroll") kind = "sideways scroll";
    else if (el.matches(spillSel)) kind = "spills out";
    else continue;
    const r = el.getBoundingClientRect();
    const inViewport = r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
    out.overflow.push({
      kind,
      path: cssPath(el),
      text: text.slice(0, 80),
      overflowX: ox,
      textOverflow: to,
      scrollWidth: sw,
      clientWidth: cw,
      inViewport,
    });
  }
  const orphanSel = "h1, h2, h3, p, [data-slot=card-title], [data-slot=card-description]";
  for (const el of document.querySelectorAll(orphanSel)) {
    if (!visible(el)) continue;
    const text = (el.innerText || "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (el.tagName === "P" && text.length >= 120) continue;
    const tl = textLines(el);
    if (tl.lines >= 2 && tl.lastLineWords === 1) {
      const r = el.getBoundingClientRect();
      out.orphans.push({
        path: cssPath(el),
        text: text.slice(0, 80),
        lines: tl.lines,
        lastLine: tl.lastLine,
        inViewport: r.bottom > 0 && r.top < vh,
      });
    }
  }
  const canvas = document.createElement("canvas").getContext("2d");
  for (const el of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    if (!visible(el) || el.value) continue;
    const cs = getComputedStyle(el);
    canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const need = canvas.measureText(el.placeholder).width;
    const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    out.placeholders.push({
      id: el.id || cssPath(el),
      placeholder: el.placeholder,
      need: round(need),
      avail: round(avail),
      clipped: need > avail + 1,
    });
  }
  return out;
};

// ---------------------------------------------------------------- targeted checks
export const T_LEADS_TABLE = () => {
  const { round } = window.__lt;
  const table = window.__lt.leadsTable();
  if (!table) return { error: "no visible table" };
  const cont = table.parentElement;
  const main = document.querySelector("main");
  const cr = cont.getBoundingClientRect(),
    mr = main.getBoundingClientRect();
  const visLeft = Math.max(cr.left + cont.clientLeft, mr.left, 0);
  const visRight = Math.min(cr.left + cont.clientLeft + cont.clientWidth, mr.left + main.clientWidth, innerWidth);
  const ths = [...table.querySelectorAll("thead th")];
  const names = ths.map((th, i) => th.innerText.trim() || (i === 0 ? "(select)" : "(blank)"));
  const headers = ths.map((th, i) => {
    const r = th.getBoundingClientRect();
    const status =
      r.left >= visRight - 0.5
        ? "off screen"
        : r.right <= visRight + 0.5 && r.left >= visLeft - 0.5
          ? "visible"
          : "cut";
    return {
      name: names[i],
      width: round(r.width),
      status,
      visiblePx: round(Math.max(0, Math.min(r.right, visRight) - Math.max(r.left, visLeft))),
    };
  });
  const tagsIdx = names.indexOf("Tags");
  const nameIdx = names.indexOf("Name");
  const byCount = {};
  let stacked = 0,
    multi = 0;
  const rows = [...table.querySelectorAll("tbody tr")];
  for (const tr of rows) {
    const cell = tr.children[tagsIdx];
    if (!cell) continue;
    const chips = [...cell.querySelectorAll("[data-slot=badge]")];
    const n = chips.length;
    const h = tr.getBoundingClientRect().height;
    (byCount[n] ??= []).push(h);
    if (n >= 2) {
      multi++;
      const tops = new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top)));
      if (tops.size > 1) stacked++;
    }
  }
  const rowHeights = Object.fromEntries(
    Object.entries(byCount).map(([k, v]) => [
      k,
      { rows: v.length, min: round(Math.min(...v)), max: round(Math.max(...v)) },
    ])
  );
  // Status boxes in Under Contract rows.
  const statusIdx = names.indexOf("Status");
  const status = [];
  for (const tr of rows) {
    const trig = tr.querySelector("[data-slot=select-trigger]");
    if (!trig || !/Under Contract/.test(trig.innerText)) continue;
    const t = trig.getBoundingClientRect();
    const svgs = trig.querySelectorAll("svg");
    const arrow = svgs[svgs.length - 1];
    const a = arrow ? arrow.getBoundingClientRect() : null;
    const tagCell = tr.children[tagsIdx];
    const firstChip = tagCell ? tagCell.querySelector("[data-slot=badge], button") : null;
    const fc = firstChip ? firstChip.getBoundingClientRect() : null;
    const statusCell = tr.children[statusIdx].getBoundingClientRect();
    status.push({
      lead: (tr.children[nameIdx]?.querySelector("button")?.innerText || tr.children[nameIdx]?.innerText || "").trim(),
      boxWidth: round(t.width),
      contentNeeds: trig.scrollWidth,
      arrowInside: a ? a.right <= t.right + 0.5 : null,
      arrowPastBoxPx: a ? round(a.right - t.right) : null,
      arrowPastCellPx: a ? round(a.right - statusCell.right) : null,
      arrowOverFirstTagPx: a && fc ? round(a.right - fc.left) : null,
      firstTag: tagCell ? tagCell.querySelector("[data-slot=badge]")?.innerText.trim() || "(none, + button)" : null,
    });
  }
  // The add-tag "+" in each Tags cell.
  const pis = rows
    .map((tr) => (tr.children[tagsIdx] ? window.__lt.plusInfo(tr.children[tagsIdx]) : null))
    .filter(Boolean);
  const plus = {
    rows: pis.length,
    alone: pis.filter((x) => x.alone).length,
    underLastTag: pis.filter((x) => x.underLastTag).length,
  };
  // Phone numbers: in their own column (code before pull request 5) or under the name. Count any that wrap.
  const tels = [...table.querySelectorAll('tbody [data-slot=lead-phone-inline] a, tbody a[href^="tel:"]')].filter(
    (a) => a.getClientRects().length
  );
  const phones = {
    shown: new Set(tels).size,
    wraps: [...new Set(tels)].filter((a) => window.__lt.fragLines(a) > 1).length,
    place: table.querySelector("[data-slot=lead-phone-inline]") ? "under name" : "own column",
  };
  return {
    phones,
    plus,
    naturalWidth: round(table.scrollWidth),
    visibleWidth: round(visRight - visLeft),
    containerScroll: {
      scrollWidth: cont.scrollWidth,
      clientWidth: cont.clientWidth,
      overflowX: getComputedStyle(cont).overflowX,
      has: cont.scrollWidth > cont.clientWidth + 1,
    },
    headers,
    rowHeights,
    tagRowsStacked: `${stacked} of ${multi}`,
    status,
  };
};

export const T_LEAD_CARDS = () => {
  const { fragLines, round } = window.__lt;
  const list = window.__lt.leadsCards();
  if (!list) return { error: "no visible card list" };
  // The top row of a card: checkbox, name, quick note button. Positions are in
  // px from the top left corner of the card's content box (inside the border
  // and the padding). The name's text boxes are cut to the name button when the
  // button hides what does not fit, so only text that is drawn is counted.
  const nameRowOf = (card, nameBtn) => {
    if (!nameBtn) return null;
    const cr = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const px = (v) => parseFloat(v) || 0;
    const box = {
      left: cr.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
      right: cr.right - px(cs.borderRightWidth) - px(cs.paddingRight),
      top: cr.top + px(cs.borderTopWidth) + px(cs.paddingTop),
    };
    const rel = (r) => ({
      left: round(r.left - box.left),
      right: round(r.right - box.left),
      top: round(r.top - box.top),
      bottom: round(r.bottom - box.top),
      width: round(r.width),
      height: round(r.height),
    });
    const b = nameBtn.getBoundingClientRect();
    const clips = getComputedStyle(nameBtn).overflowX !== "visible";
    const texts = [];
    const tw = document.createTreeWalker(nameBtn, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = tw.nextNode())) {
      if (!t.data.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(t);
      for (const q of rg.getClientRects()) {
        if (q.width <= 0.5 || q.height <= 0) continue;
        const left = clips ? Math.max(q.left, b.left) : q.left;
        const right = clips ? Math.min(q.right, b.right) : q.right;
        if (right - left > 0.5) texts.push({ left, right, top: q.top, bottom: q.bottom });
      }
    }
    texts.sort((x, y) => x.top - y.top || x.left - y.left);
    const first = texts[0];
    const check = card.querySelector("[data-slot=checkbox]");
    const note = card.querySelector('[title="Notes"]');
    const k = check?.getBoundingClientRect();
    const n = note?.getBoundingClientRect();
    const row = card.firstElementChild.getBoundingClientRect();
    const mid = (r) => (r.top + r.bottom) / 2;
    const left = texts.length ? Math.min(...texts.map((x) => x.left)) : b.left;
    const right = texts.length ? Math.max(...texts.map((x) => x.right)) : b.right;
    // Text over a control: a text box that overlaps the control's box in both directions.
    const overlaps = (c) =>
      c ? texts.some((x) => x.right > c.left + 0.5 && x.left < c.right - 0.5 && x.bottom > c.top + 0.5 && x.top < c.bottom - 0.5) : false;
    const underNote = overlaps(n);
    const overCheckbox = overlaps(k);
    return {
      lines: fragLines(nameBtn),
      button: rel(b),
      firstLine: first ? rel(first) : null,
      textLeft: round(left - box.left),
      textRight: round(right - box.left),
      contentWidth: round(box.right - box.left),
      textOutside: left < box.left - 0.5 || right > box.right + 0.5,
      textUnderNote: underNote,
      textOverCheckbox: overCheckbox,
      checkbox: k ? rel(k) : null,
      checkboxOffFirstLinePx: k && first ? round(Math.abs(mid(k) - mid(first))) : null,
      noteButton: n ? rel(n) : null,
      noteRightGapPx: n ? round(box.right - n.right) : null,
      noteTopBelowRowTopPx: n ? round(n.top - row.top) : null,
      rowHeight: round(row.height),
    };
  };
  const cards = [...list.children].filter((c) => c.querySelector("[data-slot=select-trigger]"));
  const columns = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size;
  // Anything drawn past the card's own edge.
  let pastEdge = 0;
  for (const c of cards) {
    const cr = c.getBoundingClientRect();
    if (
      [...c.querySelectorAll("*")].some((e) => {
        if (!e.getClientRects().length || e.closest("svg")) return false;
        const r = e.getBoundingClientRect();
        // The checkbox library keeps a 1 px hidden input off to the side: not drawn, so skip it.
        if (r.width <= 1 || r.height <= 1) return false;
        return r.right > cr.right + 0.5 || r.left < cr.left - 0.5;
      })
    )
      pastEdge++;
  }
  const info = cards.map((card, i) => {
    const cr = card.getBoundingClientRect();
    const nameBtn = card.querySelector("button.font-medium");
    const name = nameBtn?.innerText.trim();
    const nameCut = nameBtn ? nameBtn.scrollWidth > nameBtn.clientWidth + 1 : null;
    const chips = [...card.querySelectorAll("[data-slot=badge]")];
    const tags = chips.map((c) => c.innerText.trim());
    const tel = card.querySelector('a[href^="tel:"]');
    const phoneLines = tel ? fragLines(tel) : 0;
    const plus = card.querySelector(".border-dashed");
    const lastChip = chips[chips.length - 1];
    let plusSameLine = null;
    const pi = window.__lt.plusInfo(card);
    const plusAlone = pi ? pi.alone : null,
      plusUnderTag = pi ? pi.underLastTag : null;
    if (plus && lastChip) {
      const p = plus.getBoundingClientRect(),
        c = lastChip.getBoundingClientRect();
      plusSameLine = Math.abs((p.top + p.bottom) / 2 - (c.top + c.bottom) / 2) < 6;
    }
    const trig = card.querySelector("[data-slot=select-trigger]");
    const t = trig.getBoundingClientRect();
    const svgs = trig.querySelectorAll("svg");
    const a = svgs[svgs.length - 1].getBoundingClientRect();
    const tagWrap = chips.length ? new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size : 0;
    return {
      index: i,
      name,
      nameCut,
      nameRow: nameRowOf(card, nameBtn),
      status: trig.innerText.trim(),
      tags,
      phoneLines,
      plusSameLine,
      plusAlone,
      plusUnderTag,
      tagLines: tagWrap,
      cardHeight: round(cr.height),
      statusBox: {
        boxWidth: round(t.width),
        contentNeeds: trig.scrollWidth,
        arrowInside: a.right <= t.right + 0.5,
        arrowPastBoxPx: round(a.right - t.right),
        arrowPastCardPx: round(a.right - (cr.right - 1)),
      },
    };
  });
  const tired = info.find((c) => c.tags.length === 1 && c.tags[0] === "Tired Landlord");
  const uc = info.filter((c) => c.status === "Under Contract");
  return {
    cards: info.length,
    columns,
    pastEdge,
    namesCut: info.filter((c) => c.nameCut).length,
    nameRows: (() => {
      const rows = info.map((c) => c.nameRow).filter(Boolean);
      return {
        measured: rows.length,
        twoOrMoreLines: rows.filter((r) => r.lines >= 2).length,
        // Checkbox center more than 1 px from the center of the name's first line.
        checkboxNotLevel: rows.filter((r) => r.checkboxOffFirstLinePx == null || r.checkboxOffFirstLinePx > 1).length,
        // Note button missing, not at the right edge of the content box, not at the
        // top of the row, or not 28 by 28 px (smaller or larger). 0.5 px tolerance.
        noteMovedOrWrongSize: rows.filter(
          (r) =>
            !r.noteButton ||
            Math.abs(r.noteRightGapPx) > 0.5 ||
            Math.abs(r.noteTopBelowRowTopPx) > 0.5 ||
            Math.abs(r.noteButton.width - 28) > 0.5 ||
            Math.abs(r.noteButton.height - 28) > 0.5
        ).length,
        // Name text outside the card's content box, under the note button or over the checkbox.
        textOutsideOrOverControl: rows.filter((r) => r.textOutside || r.textUnderNote || r.textOverCheckbox).length,
        largestCheckboxOffPx: Math.max(0, ...rows.map((r) => r.checkboxOffFirstLinePx ?? 0)),
      };
    })(),
    statusArrowOutside: info.filter((c) => !c.statusBox.arrowInside).length,
    phoneWrapsIn: info.filter((c) => c.phoneLines > 1).length,
    plusDropsIn: info.filter((c) => c.plusSameLine === false).length,
    plusFoundIn: info.filter((c) => c.plusAlone !== null).length,
    plusAloneIn: info.filter((c) => c.plusAlone).length,
    plusUnderTagIn: info.filter((c) => c.plusUnderTag).length,
    tiredLandlordCard: tired || null,
    underContractCards: uc.slice(0, 3),
    firstCards: info.slice(0, 4),
  };
};

export const SIDEBAR_EMAIL_SEL = "[data-sidebar-email], aside p.truncate, [data-slot=sheet-content] p.truncate";
export const T_SIDEBAR = () => {
  const { round, fragLines } = window.__lt;
  const els = [
    ...document.querySelectorAll("[data-sidebar-email], aside p.truncate, [data-slot=sheet-content] p.truncate"),
  ].filter((e) => e.getClientRects().length);
  if (!els.length) return { error: "no visible sidebar email" };
  const el = els[0];
  const box = el.closest("aside") || el.closest("[data-slot=sheet-content]");
  const rects = [];
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = tw.nextNode())) {
    if (!t.data.trim()) continue;
    const r = document.createRange();
    r.selectNodeContents(t);
    for (const q of r.getClientRects()) if (q.width > 0.5) rects.push(q);
  }
  const er = el.getBoundingClientRect();
  const textLeft = rects.length ? Math.min(...rects.map((q) => q.left)) : null;
  const textRight = rects.length ? Math.max(...rects.map((q) => q.right)) : null;
  const btn = [...box.querySelectorAll("button")].find((b) => /Sign Out/.test(b.textContent));
  const icon = btn?.querySelector("svg")?.getBoundingClientRect();
  const br = btn?.getBoundingClientRect(),
    bx = box.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const text = el.textContent.trim();
  const clipped =
    el.scrollWidth > el.clientWidth + 1 ||
    (textRight != null && textRight > er.right + 1) ||
    (textRight != null && textRight > bx.right - 1);
  return {
    text,
    chars: text.length,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    clipped,
    ellipsis: cs.textOverflow === "ellipsis",
    lines: fragLines(el),
    title: el.getAttribute("title") || el.closest("[title]")?.getAttribute("title") || null,
    textLeftMinusSignOutIconLeftPx: icon && textLeft != null ? round(textLeft - icon.left) : null,
    signOutVisible: !!br && br.height > 0 && br.bottom <= Math.min(bx.bottom, innerHeight) + 0.5 && br.top >= 0,
    where: el.closest("aside") ? "side menu" : "slide-out menu",
  };
};

export const T_CALENDAR = () => {
  // Only events that are drawn: FullCalendar keeps the events behind "+N more" in the page, invisible.
  const evs = [...document.querySelectorAll(".fc-daygrid-event")].filter(
    (e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden"
  );
  const res = {
    events: evs.length,
    titles: 0,
    titlesClipped: 0,
    times: 0,
    timesClipped: 0,
    clippedTitles: [],
    clippedTimes: [],
    shownTimes: [],
  };
  for (const ev of evs) {
    const er = ev.getBoundingClientRect();
    const harness = ev.closest(".fc-daygrid-day-frame") || ev.parentElement;
    const hr = harness.getBoundingClientRect();
    const limit = Math.min(er.right, hr.right);
    const title = ev.querySelector(".fc-event-title");
    const time = ev.querySelector(".fc-event-time");
    const clippedEl = (el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > limit + 1;
    const shownEl = (el) =>
      el &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden" &&
      el.getBoundingClientRect().width > 0;
    if (ev.getAttribute("title")) res.withTooltip = (res.withTooltip || 0) + 1;
    if (!time) {
      const cs = getComputedStyle(ev);
      (res.allDay ??= []).push({
        text: ev.innerText.trim(),
        titleShown: shownEl(title),
        width: Math.round(er.width),
        height: Math.round(er.height),
        background: cs.backgroundColor,
      });
    }
    if (title && !shownEl(title)) {
      res.titles++;
      res.titlesHidden = (res.titlesHidden || 0) + 1;
    } else if (title) {
      res.titles++;
      if (clippedEl(title)) {
        res.titlesClipped++;
        res.clippedTitles.push(`${title.textContent.trim()} (${title.clientWidth}/${title.scrollWidth}px)`);
      }
    }
    if (time) {
      res.times++;
      res.shownTimes.push(time.textContent.trim());
      if (clippedEl(time)) {
        res.timesClipped++;
        res.clippedTimes.push(`${time.textContent.trim()} (${time.clientWidth}/${time.scrollWidth}px)`);
      }
    }
  }
  res.moreLinks = [...document.querySelectorAll(".fc-daygrid-more-link")]
    .filter((e) => e.getClientRects().length)
    .map((e) => e.textContent.trim());
  res.titlesHidden ??= 0;
  res.withTooltip ??= 0;
  res.allDay ??= [];
  const tb = document.querySelector(".fc-header-toolbar");
  if (tb) {
    const chunks = [...tb.querySelectorAll(":scope > .fc-toolbar-chunk")]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0);
    let stacked = chunks.length > 1;
    for (let i = 1; i < chunks.length; i++) if (chunks[i].top < chunks[i - 1].bottom - 1) stacked = false;
    const tr = tb.getBoundingClientRect();
    const titleEl = tb.querySelector(".fc-toolbar-title");
    res.toolbar = {
      stacked,
      titleLines: titleEl ? window.__lt.fragLines(titleEl) : null,
      titleText: titleEl?.textContent.trim(),
      spills: chunks.some((r) => r.right > tr.right + 1 || r.left < tr.left - 1),
    };
  }
  return res;
};

export const T_SELECTS = (root = "main") => {
  const out = [];
  for (const trig of document.querySelectorAll(`${root} [data-slot=select-trigger]`)) {
    if (!trig.getClientRects().length) continue;
    const val = trig.querySelector("[data-slot=select-value]") || trig;
    out.push({
      text: trig.innerText.trim(),
      boxWidth: Math.round(trig.getBoundingClientRect().width),
      valueScrollWidth: val.scrollWidth,
      valueClientWidth: val.clientWidth,
      clipped: val.scrollWidth > val.clientWidth + 1,
    });
  }
  return out;
};

export const T_LOGIN = () => {
  const { textLines } = window.__lt;
  const el = [...document.querySelectorAll("div, p")].find(
    (e) => e.childElementCount === 0 && e.textContent.trim() === "Accounts are for Deal Desk Pro customers only."
  );
  if (!el) return { error: "notice not found" };
  const tl = textLines(el);
  const card = el.closest("[data-slot=card]")?.getBoundingClientRect();
  return {
    lines: tl.lines,
    lastLineWords: tl.lastLineWords,
    lastLine: tl.lastLine,
    allLines: tl.all,
    cardLeftRoomPx: card ? Math.round(card.left) : null,
    cardRightRoomPx: card ? Math.round(innerWidth - card.right) : null,
  };
};

export const T_WELCOME = () => {
  const { textLines } = window.__lt;
  const el = [...document.querySelectorAll("main h1")].find((e) => /Welcome to/.test(e.textContent));
  if (!el) return { error: "heading not found" };
  const tl = textLines(el);
  return { lines: tl.lines, lastLineWords: tl.lastLineWords, lastLine: tl.lastLine, allLines: tl.all };
};

export const T_BUYERS = () => {
  const main = document.querySelector("main");
  const badges = [...main.querySelectorAll("[data-slot=badge]")].filter(
    (b) => b.textContent.trim() === "On Map" && b.getClientRects().length
  );
  const rows = badges.map((b) => {
    let area = b.parentElement;
    while (area && area !== main && !/^Areas:/.test(area.textContent.trim())) area = area.parentElement;
    if (area === main) area = null;
    const br = b.getBoundingClientRect();
    let sameLine = null,
      areaLines = null;
    if (area) {
      // Compare with the line of the area text that comes right before the badge.
      const tw = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      let t,
        prev = null;
      while ((t = tw.nextNode())) {
        if (b.contains(t)) break;
        if (t.data.trim()) prev = t;
      }
      const r = document.createRange();
      if (prev) r.selectNodeContents(prev);
      const rects = prev ? [...r.getClientRects()].filter((q) => q.width > 0.5) : [];
      const last = rects[rects.length - 1];
      areaLines = window.__lt.fragLines(area);
      sameLine = last ? Math.abs((br.top + br.bottom) / 2 - (last.top + last.bottom) / 2) < 8 : null;
    }
    return { area: area?.textContent.trim().replace(/\s*On Map$/, ""), sameLine, areaLines };
  });
  const table = [...main.querySelectorAll("table")].find((t) => t.getClientRects().length);
  const out = {
    badges: rows.length,
    sameLine: rows.filter((r) => r.sameLine).length,
    below: rows.filter((r) => r.sameLine === false).length,
    rows,
  };
  out.shape = table ? "table" : "cards";
  const isTrash = (btn) => !!btn.querySelector("svg[class*=trash]");
  if (table) {
    const c = table.parentElement;
    const cr = c.getBoundingClientRect();
    const right = Math.min(cr.left + c.clientWidth, innerWidth);
    out.tableScroll = {
      has: c.scrollWidth > c.clientWidth + 1,
      scrollWidth: c.scrollWidth,
      clientWidth: c.clientWidth,
    };
    const dels = [...table.querySelectorAll("tbody button")].filter(isTrash);
    out.deleteVisible = `${dels.filter((b) => b.getBoundingClientRect().right <= right + 0.5).length}/${dels.length}`;
  } else {
    const dels = [...main.querySelectorAll("button")].filter((b) => isTrash(b) && b.getClientRects().length);
    out.deleteVisible = `${
      dels.filter((b) => {
        const r = b.getBoundingClientRect();
        const card = b.closest("[data-slot=card]")?.getBoundingClientRect();
        return r.right <= Math.min(innerWidth, card ? card.right : innerWidth) + 0.5;
      }).length
    }/${dels.length}`;
  }
  return out;
};

export const T_DIALER = () => {
  const { textRight, round } = window.__lt;
  const cards = [...document.querySelectorAll("main [data-slot=card]")].filter(
    (c) => c.querySelector('a[href^="tel:"]') && c.getClientRects().length
  );
  const rows = cards.map((c) => {
    const addr = c.querySelector("p.text-xs");
    const btn = c.querySelector('a[href^="tel:"] button, a[href^="tel:"]');
    const tr = addr ? textRight(addr) : null;
    const b = btn.getBoundingClientRect();
    const ar = addr ? addr.getBoundingClientRect() : null;
    const name = c.querySelector("p.font-medium")?.textContent.trim();
    // If the button sits under the text (no shared line), the gap is the vertical one.
    const stacked = ar ? b.top >= ar.bottom - 0.5 : false;
    const gapPx = tr == null ? null : stacked ? round(b.top - ar.bottom) : round(b.left - tr);
    return {
      name,
      address: addr?.textContent.trim(),
      stacked,
      gapPx,
      addressLines: addr ? window.__lt.fragLines(addr) : 0,
      nameLines: window.__lt.fragLines(c.querySelector("p.font-medium")),
    };
  });
  const gaps = rows.map((r) => r.gapPx).filter((g) => g != null);
  return {
    cards: rows.length,
    minGapPx: gaps.length ? Math.min(...gaps) : null,
    under8px: rows.filter((r) => r.gapPx != null && r.gapPx < 8).length,
    under12px: rows.filter((r) => r.gapPx != null && r.gapPx < 12).length,
    stacked: rows.filter((r) => r.stacked).length,
    nameWraps: rows.filter((r) => r.nameLines > 1).length,
    addressWraps: rows.filter((r) => r.addressLines > 1).length,
    rows: rows.slice(0, 12),
  };
};

// Leads: the heading count and the paging bar at the bottom of the list
// (with 60 seeded leads and 50 per page there must be a second page).
export const T_LEADS_PAGING = () => {
  const main = document.querySelector("main");
  main.scrollTo(0, main.scrollHeight);
  const drawn = (e) => e.getClientRects().length > 0;
  const mr = main.getBoundingClientRect();
  const left = Math.max(0, mr.left),
    right = Math.min(innerWidth, mr.left + main.clientWidth);
  const norm = (e) => e.textContent.trim().replace(/\s+/g, " ");
  const leaf = (re) =>
    [...main.querySelectorAll("div, p, span")].find(
      (e) => drawn(e) && re.test(norm(e)) && ![...e.children].some((c) => re.test(norm(c)))
    );
  const showing = leaf(/^Showing \d/),
    pageOf = leaf(/^Page \d+ of \d+$/);
  const inside = (e) => {
    const r = e.getBoundingClientRect();
    return r.left >= left - 0.5 && r.right <= right + 0.5;
  };
  const bar = showing ? showing.parentElement : null;
  const buttons = bar ? [...bar.querySelectorAll("button")].filter(drawn) : [];
  const br = bar ? bar.getBoundingClientRect() : null;
  return {
    heading: document.querySelector("main h1")?.textContent.trim() || null,
    shown: !!showing,
    showingText: showing ? norm(showing) : null,
    pageText: pageOf ? norm(pageOf) : null,
    insidePage: showing ? inside(showing) && (!pageOf || inside(pageOf)) && buttons.every(inside) : null,
    cut: showing
      ? showing.scrollWidth > showing.clientWidth + 1 || (pageOf ? pageOf.scrollWidth > pageOf.clientWidth + 1 : false)
      : null,
    oneRow:
      showing && pageOf
        ? Math.abs(showing.getBoundingClientRect().top - pageOf.getBoundingClientRect().top) < 14
        : null,
    buttons: buttons.length,
    rect: br ? { x: br.x, y: br.y, width: br.width, height: br.height } : null,
  };
};

export const T_DASH = () => {
  const card = [...document.querySelectorAll("main [data-slot=card]")].find((c) =>
    /Upcoming Events/.test(c.textContent)
  );
  if (!card) return { error: "no upcoming events card" };
  const titles = [...card.querySelectorAll("a.block p:first-child")].filter((p) => p.getClientRects().length);
  return {
    titles: titles.length,
    clipped: titles.filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent.trim()),
    wrapped: titles.filter((p) => window.__lt.fragLines(p) > 1).length,
  };
};

export const T_TOAST = () => {
  const t = [...document.querySelectorAll("[data-sonner-toast]")].find((e) => e.getClientRects().length);
  if (!t) return { error: "no toast" };
  const cs = getComputedStyle(t);
  const title = t.querySelector("[data-title]") || t;
  return {
    text: t.innerText.trim(),
    fontFamily: getComputedStyle(title).fontFamily,
    fontSize: getComputedStyle(title).fontSize,
    background: cs.backgroundColor,
    color: cs.color,
    theme:
      t.closest("[data-sonner-toaster]")?.getAttribute("data-sonner-theme") ||
      t.closest("[data-sonner-toaster]")?.getAttribute("data-theme"),
  };
};

export const T_POPUP = () => {
  const c = [...document.querySelectorAll(".leaflet-popup-content")].find((e) => e.getClientRects().length);
  if (!c) return { error: "no popup" };
  const inner = c.firstElementChild || c;
  const strong = c.querySelector("strong");
  return {
    text: c.innerText.trim().replace(/\s+/g, " ").slice(0, 120),
    fontFamily: getComputedStyle(inner).fontFamily,
    strongFontFamily: strong ? getComputedStyle(strong).fontFamily : null,
    containerFontFamily: getComputedStyle(document.querySelector(".leaflet-container")).fontFamily,
  };
};
