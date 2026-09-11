// Excel-like formula engine for computed fields. Formulas reference other
// fields by label in curly braces — e.g. "{Stunden Montag} + {Stunden Dienstag}"
// or "ROUND(SUM({A},{B},{C}) / 3, 1)" — and are re-evaluated whenever any
// referenced value changes. No eval(): a small hand-written tokenizer +
// recursive-descent parser. Shared by the fill form (live preview) and the
// server fill engine (authoritative value at export time).
import type { FieldValue, FillValues, TemplateField } from "./types";

type Token =
  | { type: "num"; value: number }
  | { type: "ref"; value: string }
  | { type: "ident"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "%" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  SUM: (args) => args.reduce((a, b) => a + b, 0),
  MIN: (args) => (args.length ? Math.min(...args) : 0),
  MAX: (args) => (args.length ? Math.max(...args) : 0),
  AVG: (args) => (args.length ? args.reduce((a, b) => a + b, 0) / args.length : 0),
  ABS: (args) => Math.abs(args[0] ?? 0),
  ROUND: (args) => {
    const factor = 10 ** (args[1] ?? 0);
    return Math.round((args[0] ?? 0) * factor) / factor;
  },
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "{") {
      const end = expr.indexOf("}", i);
      if (end === -1) throw new Error("unterminated reference");
      tokens.push({ type: "ref", value: expr.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%") {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }
    if (/[0-9.,]/.test(c)) {
      let j = i;
      let s = "";
      while (j < expr.length && /[0-9.,]/.test(expr[j])) {
        s += expr[j];
        j++;
      }
      const n = parseFloat(s.replace(",", "."));
      if (!Number.isFinite(n)) throw new Error("invalid number");
      tokens.push({ type: "num", value: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      let s = "";
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) {
        s += expr[j];
        j++;
      }
      tokens.push({ type: "ident", value: s.toUpperCase() });
      i = j;
      continue;
    }
    throw new Error(`unexpected character: ${c}`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private getRef: (label: string) => number
  ) {}

  parse(): number {
    if (this.tokens.length === 0) return 0;
    const v = this.parseExpr();
    if (this.pos < this.tokens.length) throw new Error("unexpected token");
    return v;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error("unexpected end of formula");
    this.pos++;
    return t;
  }

  private parseExpr(): number {
    let v = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t?.type === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        const rhs = this.parseTerm();
        v = t.value === "+" ? v + rhs : v - rhs;
      } else break;
    }
    return v;
  }

  private parseTerm(): number {
    let v = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t?.type === "op" && (t.value === "*" || t.value === "/" || t.value === "%")) {
        this.next();
        const rhs = this.parseUnary();
        if (t.value === "*") v *= rhs;
        else if (t.value === "/") v = rhs === 0 ? 0 : v / rhs;
        else v = rhs === 0 ? 0 : v % rhs;
      } else break;
    }
    return v;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (t?.type === "op" && t.value === "-") {
      this.next();
      return -this.parseUnary();
    }
    if (t?.type === "op" && t.value === "+") {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.next();
    if (t.type === "num") return t.value;
    if (t.type === "ref") return this.getRef(t.value);
    if (t.type === "lparen") {
      const v = this.parseExpr();
      if (this.next().type !== "rparen") throw new Error("expected )");
      return v;
    }
    if (t.type === "ident") {
      const fn = FUNCTIONS[t.value];
      if (!fn) throw new Error(`unknown function: ${t.value}`);
      if (this.peek()?.type !== "lparen") throw new Error("expected (");
      this.next();
      const args: number[] = [];
      if (this.peek()?.type !== "rparen") {
        args.push(this.parseExpr());
        while (this.peek()?.type === "comma") {
          this.next();
          args.push(this.parseExpr());
        }
      }
      if (this.next().type !== "rparen") throw new Error("expected )");
      return fn(args);
    }
    throw new Error("unexpected token");
  }
}

/** Evaluates a formula string, resolving `{Label}` references via `getRef`. */
export function evaluateExpression(expr: string, getRef: (label: string) => number): number {
  return new Parser(tokenize(expr), getRef).parse();
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function numFromValue(v: FieldValue): number {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return 0;
  const n = parseFloat(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatResult(n: number): string {
  const rounded = Math.round(n * 10000) / 10000;
  const str = rounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return (str === "" || str === "-" ? "0" : str).replace(".", ",");
}

/**
 * Computes every field's `formula`, resolving inter-field dependencies
 * (including formula-on-formula chains) and returns a copy of `values` with
 * the results filled in. Circular references resolve to "#FEHLER".
 */
export function evaluateFormulas(fields: TemplateField[], values: FillValues): FillValues {
  const byId = new Map(fields.map((f) => [f.id, f] as const));
  const labelToId = new Map<string, string>();
  for (const f of fields) {
    const key = normalizeLabel(f.label);
    if (key && !labelToId.has(key)) labelToId.set(key, f.id);
  }

  const resolved = new Map<string, number | null>();
  const resolving = new Set<string>();

  function resolve(id: string): number {
    if (resolved.has(id)) return resolved.get(id) ?? 0;
    const field = byId.get(id);
    if (!field) return 0;
    if (!field.formula?.trim()) {
      const n = numFromValue(values[id]);
      resolved.set(id, n);
      return n;
    }
    if (resolving.has(id)) {
      resolved.set(id, null);
      return 0;
    }
    resolving.add(id);
    let n: number;
    try {
      n = evaluateExpression(field.formula, (label) => {
        const refId = labelToId.get(normalizeLabel(label));
        if (!refId || refId === id) return 0;
        return resolve(refId);
      });
    } catch {
      n = NaN;
    }
    resolving.delete(id);
    const ok = Number.isFinite(n);
    resolved.set(id, ok ? n : null);
    return ok ? n : 0;
  }

  const out: FillValues = { ...values };
  for (const f of fields) {
    if (!f.formula?.trim()) continue;
    resolve(f.id);
    const n = resolved.get(f.id);
    out[f.id] = n === null || n === undefined ? "#FEHLER" : formatResult(n);
  }
  return out;
}
