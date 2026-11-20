// The summary rows of a capture run, and the Markdown report made from them.
//
// capture.mjs saves everything it measured as JSON (out/reports/detector-<label>.json).
// The functions here turn that JSON into rows of plain text, one cell per screen
// width. capture.mjs uses them to write detector-<label>.md; compare.mjs uses the
// same rows to put a "before" run next to an "after" run. Because the rows are
// worked out from the saved JSON, an older run can be compared with a newer one
// as long as its JSON still has the fields a row reads.
//
// To add a row for a new check: add one `add("Name", (w) => ...)` line below.
// The function gets a width and returns a short text, or null for "n/a".

/** The main widths and the extra widths of a run, as numbers. */
export function widthsOf(rep) {
  return {
    main: (rep.widths || []).map((x) => x.w),
    extra: (rep.extraWidths || []).map((x) => x.w),
  };
}

const isBlockedNoise = (m) => /ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(m);

/** Console errors of one view at one width, without the noise from blocked map tiles. */
export function consoleErrorsOf(rep, view, w) {
  return ((rep.consoleErrors || {})[view]?.[w] || []).filter((m) => !isBlockedNoise(m));
}

/** The four counts for one width, over every view that ran at that width. */
export function countsFor(rep, w) {
  const c = { clipped: 0, sideways: 0, spills: 0, loneWords: 0 };
  for (const byWidth of Object.values(rep.results || {})) {
    const g = byWidth[w]?.generic;
    if (!g) continue;
    for (const o of g.overflow || []) {
      if (!o.inViewport) continue;
      if (o.kind === "clipped") c.clipped++;
      else if (o.kind === "sideways scroll") c.sideways++;
      else c.spills++;
    }
    c.loneWords += (g.orphans || []).filter((o) => o.inViewport).length;
  }
  return c;
}

/** One line per clipped, scrolling or spilling element and per lone last word, in view. */
export function itemsFor(rep, w) {
  const out = [];
  for (const [view, byWidth] of Object.entries(rep.results || {})) {
    const g = byWidth[w]?.generic;
    if (!g) continue;
    for (const o of g.overflow || []) if (o.inViewport) out.push(`${view} | ${o.kind} | ${o.text.slice(0, 50)}`);
    for (const o of g.orphans || []) {
      if (o.inViewport) out.push(`${view} | lone last word | ${o.text.slice(0, 50)} (last line "${o.lastLine}")`);
    }
  }
  return out;
}

/**
 * Every summary row of a run: [{ name, cells }] where cells maps a width to
 * its text ("n/a" when the check did not run at that width).
 */
export function summaryRows(rep) {
  const { main, extra } = widthsOf(rep);
  const all = [...main, ...extra];
  const R = rep.results || {};
  const get = (view, w) => R[view]?.[w] || {};
  const rows = [];
  const add = (name, fn) => {
    const cells = {};
    for (const w of all) {
      let v;
      try {
        v = fn(w);
      } catch {
        v = null;
      }
      cells[w] = v == null || v === "" ? "n/a" : String(v).replace(/\|/g, "/");
    }
    rows.push({ name, cells });
  };
  const ranAt = (view, w) => !!R[view]?.[w];

  // ---- Leads list
  add("Leads: shape", (w) => {
    const v = get("leads", w);
    if (!v.leadsShape) return null;
    const c = v.cards;
    return v.leadsShape === "cards" && c && !c.error ? `cards, ${c.columns} column(s)` : v.leadsShape;
  });
  add("Leads: heading and paging bar", (w) => {
    const g = get("leads", w).paging;
    if (!g) return null;
    const bar = g.shown
      ? `paging bar "${g.showingText}"${g.pageText ? `, "${g.pageText}"` : ""}, ${g.buttons} button(s), ${g.oneRow === false ? "TWO ROWS" : "one row"}, ${g.insidePage ? "inside the page" : "OUTSIDE THE PAGE"}, ${g.cut ? "CUT" : "not cut"}`
      : "no paging bar";
    return `heading "${g.heading}"; ${bar}`;
  });
  add("Leads table: natural vs visible width", (w) => {
    const t = get("leads", w).table;
    return t && !t.error ? `${t.naturalWidth} vs ${t.visibleWidth} px` : null;
  });
  add("Leads table: sideways scroll, columns cut or off screen", (w) => {
    const t = get("leads", w).table;
    if (!t || t.error) return null;
    const bad = t.headers
      .filter((h) => h.status !== "visible")
      .map((h) => `${h.name} ${h.status}${h.status === "cut" ? ` (${h.visiblePx}/${h.width}px)` : ""}`);
    const scroll = t.containerScroll.has
      ? `scroll YES (${t.containerScroll.scrollWidth}/${t.containerScroll.clientWidth})`
      : "no scroll";
    return `${scroll}; ${bad.length ? bad.join(", ") : "all columns visible"}`;
  });
  add("Leads table: row height by tag count (0/1/2/3)", (w) => {
    const t = get("leads", w).table;
    if (!t || t.error) return null;
    const heights = [0, 1, 2, 3]
      .map((k) =>
        t.rowHeights[k]
          ? t.rowHeights[k].min === t.rowHeights[k].max
            ? t.rowHeights[k].min
            : `${t.rowHeights[k].min}-${t.rowHeights[k].max}`
          : "-"
      )
      .join(" / ");
    return `${heights}; tags stack in ${t.tagRowsStacked}`;
  });
  add("Leads: phone numbers that wrap", (w) => {
    const v = get("leads", w);
    if (v.table && !v.table.error && v.table.phones)
      return `table: ${v.table.phones.place}, wraps ${v.table.phones.wraps}/${v.table.phones.shown}`;
    if (v.cards && !v.cards.error) return `cards: wraps ${v.cards.phoneWrapsIn}/${v.cards.cards}`;
    return null;
  });
  add('Leads: status box with "Under Contract": box / needs / arrow', (w) => {
    const t = get("leads", w).table;
    const c = get("leads", w).cards;
    if (t && !t.error && t.status.length) {
      const s = t.status[0];
      return `table: ${s.boxWidth} / ${s.contentNeeds} px, arrow ${s.arrowInside ? "inside" : `${s.arrowPastBoxPx}px OUTSIDE the box, over the first tag by ${s.arrowOverFirstTagPx}px (${s.firstTag})`}`;
    }
    if (c && !c.error && c.underContractCards.length) {
      const s = c.underContractCards[0].statusBox;
      return `card: ${s.boxWidth} / ${s.contentNeeds} px, arrow ${s.arrowInside ? "inside" : `${s.arrowPastBoxPx}px OUTSIDE the box`}, ${s.arrowPastCardPx > 0 ? `${s.arrowPastCardPx}px PAST the card edge` : "inside the card"}`;
    }
    return null;
  });
  add('Leads table: add-tag "+" alone on a line / under its own last tag', (w) => {
    const t = get("leads", w).table;
    return t && !t.error && t.plus ? `${t.plus.alone} / ${t.plus.underLastTag} (of ${t.plus.rows} rows with +)` : null;
  });
  add("Leads cards: past the card edge, names cut, status arrow outside", (w) => {
    const c = get("leads", w).cards;
    return c && !c.error
      ? `past edge ${c.pastEdge}, names cut ${c.namesCut}, arrow outside ${c.statusArrowOutside} (of ${c.cards} cards)`
      : null;
  });
  add("Leads cards: name on 2+ lines, checkbox level with line 1, note button in place, name text inside", (w) => {
    const c = get("leads", w).cards;
    const r = c && !c.error ? c.nameRows : null;
    if (!r) return null;
    return (
      `2+ lines ${r.twoOrMoreLines}, ` +
      `checkbox ${r.checkboxNotLevel ? `NOT LEVEL ${r.checkboxNotLevel}` : "level"}, ` +
      `note button ${r.noteMovedOrWrongSize ? `MOVED OR WRONG SIZE ${r.noteMovedOrWrongSize}` : "in place"}, ` +
      `text ${r.textOutsideOrOverControl ? `OUTSIDE OR OVER CHECKBOX OR NOTE BUTTON ${r.textOutsideOrOverControl}` : "inside"} (of ${r.measured} cards)`
    );
  });
  add('Leads cards: add-tag "+" alone on a line / under its own last tag', (w) => {
    const c = get("leads", w).cards;
    return c && !c.error ? `${c.plusAloneIn} / ${c.plusUnderTagIn} (of ${c.plusFoundIn} cards with +)` : null;
  });
  add('Leads cards: card with the one tag "Tired Landlord"', (w) => {
    const c = get("leads", w).cards;
    if (!c || c.error) return null;
    const t = c.tiredLandlordCard;
    return t
      ? `phone on ${t.phoneLines} line(s), + ${t.plusSameLine == null ? "not found" : t.plusSameLine ? "beside the tag" : "below the tag"}`
      : "no such card";
  });
  const filter = (view, key) => (w) => {
    const f = get(view, w)[key];
    return f && !f.error ? `${f.width}px, arrow ${f.arrowInside ? "inside" : `${f.arrowPastPx}px OUTSIDE`}` : f?.error;
  };
  add('Leads: status filter set to "Under Contract"', filter("leads", "filter-leads"));
  add('Map: status filter set to "Under Contract"', filter("map", "filter-map"));

  // ---- Side menu
  add("Side menu email: fits or cut", (w) => {
    const s = get("leads", w).sidebar;
    return s && !s.error
      ? `${s.clipped ? "CUT" : "fits"} (${s.chars} characters, ${s.clientWidth}/${s.scrollWidth}px, ${s.where})`
      : s?.error;
  });
  add("Side menu email: lines, left edge vs Sign Out icon, hover title", (w) => {
    const s = get("leads", w).sidebar;
    return s && !s.error
      ? `${s.lines} line(s), ${s.textLeftMinusSignOutIconLeftPx}px, title ${s.title ? "yes" : "no"}`
      : null;
  });
  add("Side menu email, 34 characters: lines, shown in full, Sign Out shown", (w) => {
    const s = get("leads", w).sidebarLong;
    return s && !s.error
      ? `${s.lines} line(s), ${s.clipped ? "CUT" : "shown in full"}, Sign Out ${s.signOutVisible ? "shown" : "HIDDEN"}`
      : s?.error;
  });

  // ---- Calendar
  add("Calendar month: titles / times cut", (w) => {
    const c = get("calendar", w).calendar;
    if (!c) return null;
    const times = c.clippedTimes.length
      ? ` (${[...new Set(c.clippedTimes.map((x) => x.split(" ")[0]))].join(", ")})`
      : "";
    return `titles ${c.titlesClipped}/${c.titles}, times ${c.timesClipped}/${c.times}${times}`;
  });
  add("Calendar month: titles hidden on purpose / tooltips / more links", (w) => {
    const c = get("calendar", w).calendar;
    return c
      ? `hidden ${c.titlesHidden}/${c.titles}, tooltips ${c.withTooltip}/${c.events}, more: ${(c.moreLinks || []).join(" ") || "none"}`
      : null;
  });
  add("Calendar month: all-day event", (w) => {
    const c = get("calendar", w).calendar;
    if (!c) return null;
    const a = c.allDay?.[0];
    return a
      ? `"${a.text}" ${a.width}x${a.height}px, title ${a.titleShown ? "shown" : "hidden"}, ${a.background}`
      : "none shown";
  });
  add("Calendar toolbar: stacked or one row, title lines", (w) => {
    const t = get("calendar", w).calendar?.toolbar;
    return t
      ? `${t.stacked ? "stacked" : "one row"}, "${t.titleText}" on ${t.titleLines} line(s)${t.spills ? ", SPILLS" : ""}`
      : null;
  });

  // ---- Select boxes: the text in the closed box and whether it is cut
  const selects = (a) =>
    a && a.length
      ? a.map((x) => `"${x.text}" ${x.clipped ? `CUT ${x.valueClientWidth}/${x.valueScrollWidth}px` : "ok"}`).join(", ")
      : null;
  add("Select: Skip Trace export format", (w) => selects(get("skip-trace", w).selectsExport));
  add("Select: Skip Trace import format", (w) => selects(get("skip-trace", w).selectsImport));
  add("Select: import column mapping (first 3)", (w) =>
    selects((get("import-mapping", w).selectsImportMapping || []).slice(0, 3))
  );
  add("Select: sequence step action", (w) => selects(get("sequence-detail", w).selectsSequence));
  add("Select: dialer call result", (w) => selects(get("dialer", w).selectsDisposition));
  add("Select: Add Lead status", (w) => selects(get("leads", w).selectsAddLead));

  // ---- Login and welcome
  add("Login notice: lines, words on the last line", (w) => {
    const l = get("login", w).login;
    return l && !l.error
      ? `${l.lines} line(s), last line "${l.lastLine}" (${l.lastLineWords} word${l.lastLineWords === 1 ? "" : "s"})`
      : null;
  });
  add("Login card: room left / right of the card (px)", (w) => {
    const l = get("login", w).login;
    return l && !l.error ? `${l.cardLeftRoomPx} / ${l.cardRightRoomPx}` : null;
  });
  add("Welcome heading: lines, words on the last line", (w) => {
    const l = get("welcome", w).heading;
    return l && !l.error ? `${l.lines} line(s), last line "${l.lastLine}" (${l.lastLineWords})` : null;
  });

  // ---- Buyers, dialer, settings, dashboard
  add("Buyers: shape, table sideways scroll, delete buttons visible", (w) => {
    const b = get("buyers", w).buyers;
    if (!b) return null;
    const scroll = b.tableScroll
      ? `, scroll ${b.tableScroll.has ? `YES ${b.tableScroll.scrollWidth}/${b.tableScroll.clientWidth}` : "no"}`
      : "";
    return `${b.shape}${scroll}, delete ${b.deleteVisible}`;
  });
  add('Buyers: "On Map" badge beside the area / below it', (w) => {
    const b = get("buyers", w).buyers;
    return b ? `${b.sameLine} / ${b.below} (of ${b.badges})` : null;
  });
  add("Dialer cards: gap between address and call button", (w) => {
    const d = get("dialer", w).dialer;
    if (!d) return null;
    return `smallest ${d.minGapPx}px, under 12px in ${d.under12px}/${d.cards}${d.stacked ? `, button under the text in ${d.stacked}` : ""}${d.nameWraps ? `, name wraps in ${d.nameWraps}` : ""}`;
  });
  const hints = (key) => (w) => {
    const s = get("settings", w)[key];
    if (!s) return null;
    return s.clipped.length
      ? `${s.clipped.length} CUT: ${s.clipped.map((x) => x.split(":")[0]).join(", ")}`
      : `none of ${s.placeholders.length}`;
  };
  add("Settings: field hints cut, empty fields", hints("settingsHints"));
  add("Settings: field hints cut, a value is saved", hints("settingsSaved"));
  add("Dashboard: upcoming event titles cut / wrapped", (w) => {
    const d = get("dashboard", w).dash;
    return d && !d.error ? `cut ${d.clipped.length}/${d.titles}, wrapped ${d.wrapped}` : d?.error;
  });

  // ---- Fonts
  add("Toast: text, font, background, theme", (w) => {
    const t = get("dialer", w).toast;
    return t && !t.error ? `"${t.text}", ${t.fontFamily.split(",")[0]}, ${t.background}, theme ${t.theme}` : t?.error;
  });
  add("Map pop-up font", (w) => {
    const p = get("map", w).popup;
    return p && !p.error
      ? `${p.fontFamily.split(",")[0]} (map container ${p.containerFontFamily.split(",")[0]})`
      : p?.error;
  });
  add("Mono font (phone number in the power dialer)", (w) => get("dialer", w).monoFont);

  // ---- Every view
  const viewsAt = (w) => Object.keys(R).filter((k) => ranAt(k, w));
  add("Views that ran", (w) => (viewsAt(w).length ? String(viewsAt(w).length) : null));
  add("Page-level sideways scroll (views)", (w) => {
    if (!viewsAt(w).length) return null;
    const v = viewsAt(w).filter((k) => R[k][w]?.generic?.pageScroll?.has);
    return v.length ? v.join(", ") : "none";
  });
  add("Clipped / sideways scroll / spills (in view, all views)", (w) => {
    if (!viewsAt(w).length) return null;
    const c = countsFor(rep, w);
    return `${c.clipped} / ${c.sideways} / ${c.spills}`;
  });
  add("Lone last words in view (views)", (w) => {
    if (!viewsAt(w).length) return null;
    const v = viewsAt(w)
      .map((k) => [k, (R[k][w]?.generic?.orphans || []).filter((o) => o.inViewport).length])
      .filter(([, n]) => n > 0);
    return v.length ? v.map(([k, n]) => `${k} (${n})`).join(", ") : "none";
  });
  add("Button inside a button (views)", (w) => {
    if (!viewsAt(w).length) return null;
    const v = viewsAt(w)
      .map((k) => [k, R[k][w]?.generic?.nestedButtons?.all || 0])
      .filter(([, n]) => n > 0);
    return v.length ? v.map(([k, n]) => `${k} (${n})`).join(", ") : "none";
  });
  add("Console errors (views; blocked map tiles not counted)", (w) => {
    if (!viewsAt(w).length) return null;
    const v = Object.keys(rep.consoleErrors || {}).filter((k) => consoleErrorsOf(rep, k, w).length);
    return v.length ? v.map((k) => `${k} (${consoleErrorsOf(rep, k, w).length})`).join(", ") : "none";
  });

  return rows;
}

/** A Markdown table of the rows for the given widths. Rows that are "n/a" at every width are left out. */
export function rowsTable(rows, widths, firstHeader = "Check") {
  const shown = rows.filter((r) => widths.some((w) => r.cells[w] !== "n/a"));
  let md = `| ${firstHeader} | ${widths.join(" | ")} |\n| --- | ${widths.map(() => "---").join(" | ")} |\n`;
  for (const r of shown) md += `| ${r.name} | ${widths.map((w) => r.cells[w]).join(" | ")} |\n`;
  return md;
}

/** The Markdown report of one run (detector-<label>.md). */
export function markdown(rep) {
  const { main, extra } = widthsOf(rep);
  const rows = summaryRows(rep);
  const R = rep.results || {};
  const opt = rep.options || {};
  let md = `# Layout check: ${rep.label}\n\n`;
  md += `App: ${rep.baseUrl}. Run ${rep.started}. Browser clock fixed at ${rep.fixedBrowserTime} (America/New_York).`;
  if (opt.weight) md += ` Base text weight injected: ${opt.weight}.`;
  if (rep.baseWeightSeen) md += ` Base text weight seen on the page: ${rep.baseWeightSeen}.`;
  if (opt.views) md += ` Only these views: ${opt.views.join(", ")}.`;
  md += `\n\n## Main widths\n\n${rowsTable(rows, main)}`;
  if (extra.length) {
    md += `\n## Extra widths\n\nOnly some views run at these widths (see EXTRA_WIDTHS in capture.mjs), so compare their counts only with each other.\n\n${rowsTable(rows, extra)}`;
  }
  if (rep.loginHtml) {
    md += `\nLogin page HTML: exact notice ${rep.loginHtml.hasExactNotice ? "present" : "MISSING"}, "sign up" wording ${rep.loginHtml.signUpWording ? "FOUND" : "none"}, "create account" wording ${rep.loginHtml.createAccountWording ? "FOUND" : "none"}.\n`;
  }
  const blockedHosts = Object.entries(rep.blockedHosts || {});
  md += `\nBlocked hosts: ${blockedHosts.length ? blockedHosts.map(([h, n]) => `${h} (${n})`).join(", ") : "none"}.\n`;
  const faked = rep.fakedWrites || [];
  md += `Write calls answered in the browser with a made-up success: ${faked.length ? [...new Set(faked.map((b) => `${b.method} ${b.path} on ${b.view}`))].join("; ") + ` (${faked.length})` : "none"}.\n`;
  const blocked = rep.blockedWrites || [];
  md += `Blocked write calls: ${blocked.length ? [...new Set(blocked.map((b) => `${b.method} ${b.path} on ${b.view}`))].join("; ") : "none"}.\n`;
  if ((rep.warnings || []).length) md += `\nWarnings:\n${rep.warnings.map((x) => `- ${x}`).join("\n")}\n`;
  md += `\n## Details: clipped, sideways and spilling elements and lone last words, in view\n\n`;
  let any = false;
  for (const view of Object.keys(R)) {
    for (const w of [...main, ...extra]) {
      const list = (R[view][w]?.generic?.overflow || []).filter((o) => o.inViewport);
      const lone = (R[view][w]?.generic?.orphans || []).filter((o) => o.inViewport);
      if (!list.length && !lone.length) continue;
      any = true;
      const a = list.map((o) => `${o.kind} "${o.text.slice(0, 40)}" (${o.clientWidth}/${o.scrollWidth}px)`).join("; ");
      const b = lone.length
        ? `${list.length ? "; " : ""}lone last word: ${lone.map((o) => `"${o.text.slice(0, 50)}" last line "${o.lastLine}"`).join("; ")}`
        : "";
      md += `- **${view} ${w}**: ${a}${b}\n`;
    }
  }
  if (!any) md += "None.\n";
  return md;
}
