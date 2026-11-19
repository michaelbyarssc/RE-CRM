// Safe-by-default HTML for the few places that must hand an HTML string to a
// library (the Leaflet popups and icons on the map page).
//
//   html`<b>${name}</b>`.toString()
//
// Every interpolated value is escaped for HTML text and for double-quoted
// attributes. The only values inserted as markup are fragments made by this
// same tag (or lists of them), so nested pieces and lists work. There is no
// other way to mark a string as trusted.
//
// Plain TypeScript with no imports, so a Node test can load this file as is.

const trusted = new WeakSet<object>();
let minting = false;

export class SafeHtml {
  readonly value: string;

  constructor(value: string) {
    if (!minting) throw new TypeError("SafeHtml can only be made with the html tag");
    this.value = value;
    trusted.add(this);
    Object.freeze(this);
  }

  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (typeof value === "object" && trusted.has(value)) return (value as SafeHtml).value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + strings[i + 1];
  }
  minting = true;
  try {
    return new SafeHtml(out);
  } finally {
    minting = false;
  }
}
