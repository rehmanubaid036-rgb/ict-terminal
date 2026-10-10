// Pine Script (v4 / v5 / v6 syntax) lexer and parser: indentation blocks, `var` / `varip`, `:=`, tuples,
// `? :`, `if` / `for` / `while` / `switch` as statements and as expressions, user functions (`f(x) => ...`),
// methods, named arguments, `[n]` history, dotted namespaces (ta.sma), colours (#rrggbb), line continuation
// inside brackets and on indented continuation lines. Types are parsed and ignored (Pine is dynamic for us).

export type Tok = { k: 'num' | 'str' | 'id' | 'op' | 'nl' | 'indent' | 'dedent' | 'eof' | 'color'; v: string; line: number }

const KEYWORDS = new Set(['if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'and', 'or', 'not', 'var', 'varip', 'break', 'continue', 'import', 'export', 'method', 'type', 'enum'])
const TYPES = new Set(['int', 'float', 'bool', 'string', 'color', 'series', 'simple', 'const', 'input', 'line', 'label', 'box', 'table', 'linefill', 'array', 'matrix', 'map', 'polyline', 'chart.point'])

export function lex(src: string): Tok[] {
  const out: Tok[] = []
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const stack = [0]
  let depth = 0                  // inside ( [ { : newlines are spaces
  let pendingCont = false        // the previous logical line ended with an operator: the next line continues it
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln]
    const line = raw.replace(/^(\s*)\/\/.*$/, '$1')
    if (!line.trim()) continue
    const indent = line.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length
    if (depth === 0 && !pendingCont) {
      const top = stack[stack.length - 1]
      // a deeper indent that is not a block start (after `=>`, `if`, `for` ...) continues the previous line
      const last = out[out.length - 1]
      const opensBlock = !!last && last.k === 'nl' && blockOpener(out)
      if (indent > top) {
        if (opensBlock) { stack.push(indent); out.push({ k: 'indent', v: '', line: ln + 1 }) } else if (last && last.k === 'nl') out.pop()
      } else {
        while (indent < stack[stack.length - 1]) { stack.pop(); out.push({ k: 'dedent', v: '', line: ln + 1 }) }
      }
    } else if (depth === 0 && pendingCont) {
      const last = out[out.length - 1]
      if (last && last.k === 'nl') out.pop()
    }
    pendingCont = false
    let i = indent
    const s = line
    while (i < s.length) {
      const c = s[i]
      if (c === ' ' || c === '\t') { i++; continue }
      if (c === '/' && s[i + 1] === '/') break
      if (c === '"' || c === "'") {
        let j = i + 1, v = ''
        while (j < s.length && s[j] !== c) { if (s[j] === '\\' && j + 1 < s.length) { v += s[j + 1]; j += 2 } else v += s[j++] }
        out.push({ k: 'str', v, line: ln + 1 }); i = j + 1; continue
      }
      if (c === '#' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?/.test(s.slice(i))) {
        const m = s.slice(i).match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?/)![0]
        out.push({ k: 'color', v: m, line: ln + 1 }); i += m.length; continue
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
        const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)![0]
        out.push({ k: 'num', v: m, line: ln + 1 }); i += m.length; continue
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)![0]
        out.push({ k: 'id', v: m, line: ln + 1 }); i += m.length; continue
      }
      const three = s.slice(i, i + 3), two = s.slice(i, i + 2)
      if (['=>'].includes(two) || ['==', '!=', '<=', '>=', ':=', '+=', '-=', '*=', '/=', '%='].includes(two)) { out.push({ k: 'op', v: two, line: ln + 1 }); i += 2; continue }
      void three
      if ('([{'.includes(c)) depth++
      if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
      out.push({ k: 'op', v: c, line: ln + 1 }); i++
    }
    const last = out[out.length - 1]
    if (depth === 0 && last && last.k !== 'nl') {
      if (last.k === 'op' && /^(=>|\?|:|,|\+|-|\*|\/|%|=|:=|==|!=|<|>|<=|>=|\.)$/.test(last.v) && last.v !== '=>' || (last.k === 'id' && (last.v === 'and' || last.v === 'or' || last.v === 'not'))) pendingCont = true
      if (last.k === 'op' && last.v === '=>') pendingCont = false
      out.push({ k: 'nl', v: '', line: ln + 1 })
    }
  }
  if (out[out.length - 1]?.k !== 'nl') out.push({ k: 'nl', v: '', line: lines.length })
  while (stack.length > 1) { stack.pop(); out.push({ k: 'dedent', v: '', line: lines.length }) }
  out.push({ k: 'eof', v: '', line: lines.length })
  return out
}

/** The logical line that just ended opens a block: it ends with `=>` or starts with if / for / while / switch / else. */
function blockOpener(out: Tok[]): boolean {
  let j = out.length - 1
  if (out[j]?.k === 'nl') j--
  if (out[j]?.k === 'op' && out[j].v === '=>') return true
  // walk back to the start of the logical line
  let start = j
  while (start >= 0 && out[start].k !== 'nl' && out[start].k !== 'indent' && out[start].k !== 'dedent') start--
  start++
  const first = out[start]
  if (!first) return false
  if (first.k === 'id' && ['if', 'for', 'while', 'switch', 'else'].includes(first.v)) return true
  // `x = if cond`, `y = switch`, `[a, b] = if`
  for (let k = start; k <= j; k++) if (out[k].k === 'id' && ['if', 'switch', 'for', 'while'].includes(out[k].v) && k > start && out[k - 1].k === 'op' && /^(=|:=|\?|:|=>)$/.test(out[k - 1].v)) return true
  // a switch case line `cond => ` with a block, or `=>` anywhere at the end handled above
  // an `else` after a ternary is not a block; `if` inside parentheses is not either
  return false
}

// ---- AST -------------------------------------------------------------------------------------------
export type Node =
  | { t: 'num'; v: number; id: number }
  | { t: 'str'; v: string; id: number }
  | { t: 'bool'; v: boolean; id: number }
  | { t: 'na'; id: number }
  | { t: 'color'; v: string; id: number }
  | { t: 'id'; v: string; id: number }
  | { t: 'member'; obj: Node; name: string; id: number }
  | { t: 'index'; obj: Node; k: Node; id: number }
  | { t: 'call'; fn: Node; args: Node[]; named: Record<string, Node>; id: number }
  | { t: 'un'; op: string; a: Node; id: number }
  | { t: 'bin'; op: string; a: Node; b: Node; id: number }
  | { t: 'tern'; c: Node; a: Node; b: Node; id: number }
  | { t: 'tuple'; items: Node[]; id: number }
  | { t: 'if'; cases: { c: Node | null; body: Stmt[] }[]; id: number }
  | { t: 'switch'; subject: Node | null; cases: { c: Node | null; body: Stmt[] }[]; id: number }
  | { t: 'for'; name: string; from: Node; to: Node; step: Node | null; body: Stmt[]; id: number }
  | { t: 'forin'; names: string[]; arr: Node; body: Stmt[]; id: number }
  | { t: 'while'; c: Node; body: Stmt[]; id: number }
  | { t: 'fn'; name: string; params: { name: string; def: Node | null }[]; body: Stmt[]; id: number }

export type Stmt =
  | { s: 'decl'; names: string[]; mode: '' | 'var' | 'varip'; e: Node; line: number }
  | { s: 'assign'; name: string; op: string; e: Node; line: number }
  | { s: 'expr'; e: Node; line: number }
  | { s: 'break'; line: number } | { s: 'continue'; line: number }

export interface Program { body: Stmt[]; version: number; fns: Record<string, Node & { t: 'fn' }> }

export function parse(src: string): Program {
  const vm = src.match(/\/\/\s*@version\s*=\s*(\d+)/)
  const toks = lex(src)
  let p = 0, nid = 0
  const id = () => ++nid
  const peek = (o = 0) => toks[p + o]
  const at = (k: Tok['k'], v?: string) => peek().k === k && (v === undefined || peek().v === v)
  const atOp = (v: string) => at('op', v)
  const atKw = (v: string) => at('id', v)
  const take = () => toks[p++]
  const err = (m: string): never => { throw new Error(`Line ${peek().line}: ${m}`) }
  const expect = (k: Tok['k'], v?: string) => { if (!at(k, v)) err(`Expected ${v ?? k}, got "${peek().v || peek().k}".`); return take() }
  const skipNl = () => { while (at('nl')) take() }
  const fns: Record<string, Node & { t: 'fn' }> = {}

  const block = (): Stmt[] => {
    // either an indented block, or a single statement on the same line
    skipNl()
    if (at('indent')) {
      take()
      const body: Stmt[] = []
      while (!at('dedent') && !at('eof')) { skipNl(); if (at('dedent') || at('eof')) break; body.push(statement()) ; skipNl() }
      if (at('dedent')) take()
      return body
    }
    return [statement()]
  }

  const statement = (): Stmt => {
    const line = peek().line
    if (atKw('break')) { take(); return { s: 'break', line } }
    if (atKw('continue')) { take(); return { s: 'continue', line } }
    if (atKw('import')) { while (!at('nl') && !at('eof')) take(); return { s: 'expr', e: { t: 'na', id: id() }, line } }
    if (atKw('export')) take()
    if (atKw('type') && peek(1).k === 'id') { // type Foo \n  int a \n  float b  -> a constructor Foo.new(a, b)
      take(); const name = take().v; const fields: string[] = []
      skipNl(); if (at('indent')) { take(); while (!at('dedent') && !at('eof')) { skipNl(); if (at('dedent')) break; const parts: Tok[] = []; while (!at('nl') && !at('eof')) parts.push(take()); const idx = parts.findIndex(x => x.k === 'op' && x.v === '='); const nm = (idx >= 0 ? parts[idx - 1] : parts[parts.length - 1]); if (nm) fields.push(nm.v); skipNl() } if (at('dedent')) take() }
      fns[`${name}.new`] = { t: 'fn', name: `${name}.new`, params: fields.map(f => ({ name: f, def: null })), body: [{ s: 'expr', e: { t: 'call', fn: { t: 'id', v: '__object', id: id() }, args: [{ t: 'str', v: fields.join(','), id: id() }, ...fields.map(f => ({ t: 'id', v: f, id: id() } as Node))], named: {}, id: id() }, line }], id: id() }
      return { s: 'expr', e: { t: 'na', id: id() }, line }
    }
    if (atKw('method')) take()
    // function definition:  name(a, b = 1) => ...
    if (at('id') && peek(1).k === 'op' && peek(1).v === '(' && isFnDef()) {
      const name = take().v; take()
      const params: { name: string; def: Node | null }[] = []
      while (!atOp(')')) {
        skipNl()
        while (at('id') && (TYPES.has(peek().v) || peek().v === 'series' || peek().v === 'simple') && peek(1).k === 'id') take()   // types
        if (at('id') && peek().v === 'series' && atOp('<')) { /* unused */ }
        const pn = expect('id').v
        let def: Node | null = null
        if (atOp('=')) { take(); def = expr() }
        params.push({ name: pn, def })
        if (atOp(',')) take()
        skipNl()
      }
      take(); expect('op', '=>')
      const body = at('nl') ? block() : [{ s: 'expr', e: expr(), line } as Stmt]
      const fn: Node & { t: 'fn' } = { t: 'fn', name, params, body, id: id() }
      fns[name] = fn
      return { s: 'expr', e: { t: 'na', id: id() }, line }
    }
    // declaration: [var|varip] [type] name = expr   |   [a, b] = expr
    let mode: '' | 'var' | 'varip' = ''
    if (atKw('var') || atKw('varip')) { mode = take().v as 'var' | 'varip' }
    if (atOp('[')) {
      const save = p
      take(); const names: string[] = []
      while (at('id')) { names.push(take().v); if (atOp(',')) take() }
      if (atOp(']') && peek(1).k === 'op' && peek(1).v === '=') { take(); take(); return { s: 'decl', names, mode, e: expr(), line } }
      p = save
    }
    if (at('id') && !KEYWORDS.has(peek().v)) {
      // optional type words before the name:  float x = ...,  array<float> a = ...,  line l = ...
      let q = 0
      while (peek(q).k === 'id' && !KEYWORDS.has(peek(q).v) && peek(q + 1).k === 'id' && !KEYWORDS.has(peek(q + 1).v)) q++
      if (peek(q).k === 'id' && peek(q + 1).k === 'op' && peek(q + 1).v === '<') { // generic type
        let d = 0, r = q + 1
        while (r < toks.length - p) { if (peek(r).v === '<') d++; if (peek(r).v === '>') { d--; if (d === 0) break } r++ }
        if (peek(r + 1).k === 'id') q = r + 1
      }
      const nameTok = peek(q)
      const after = peek(q + 1)
      if (after.k === 'op' && after.v === '=' ) { p += q; const name = take().v; take(); return { s: 'decl', names: [name], mode, e: expr(), line } }
      if (after.k === 'op' && [':=', '+=', '-=', '*=', '/=', '%='].includes(after.v) && q === 0) { const name = take().v; const op = take().v; return { s: 'assign', name, op, e: expr(), line } }
      if (mode) { p += q; const name = take().v; return { s: 'decl', names: [name], mode, e: { t: 'na', id: id() }, line } }
      void nameTok
    }
    if (mode) err('Expected a name after var.')
    return { s: 'expr', e: expr(), line }
  }

  const isFnDef = (): boolean => {
    // name ( ... ) =>   on one logical line
    let d = 0, q = 1
    while (peek(q).k !== 'eof') {
      const t = peek(q)
      if (t.k === 'op' && t.v === '(') d++
      else if (t.k === 'op' && t.v === ')') { d--; if (d === 0) return peek(q + 1).k === 'op' && peek(q + 1).v === '=>' }
      else if (t.k === 'nl' && d === 0) return false
      q++
    }
    return false
  }

  // ---- expressions (precedence: ?: < or < and < not < == != < > >= <= < + - < * / % < unary < [] . call) ----
  const expr = (): Node => {
    if (atKw('if')) return ifExpr()
    if (atKw('switch')) return switchExpr()
    if (atKw('for')) return forExpr()
    if (atKw('while')) { take(); const c = expr(); const body = block(); return { t: 'while', c, body, id: id() } }
    return ternary()
  }
  const ternary = (): Node => {
    const c = orExpr()
    if (atOp('?')) {
      take(); skipNl(); const a = ternary(); skipNl(); expect('op', ':'); skipNl(); const b = ternary()
      return { t: 'tern', c, a, b, id: id() }
    }
    return c
  }
  const orExpr = (): Node => { let a = andExpr(); while (atKw('or')) { take(); skipNl(); a = { t: 'bin', op: 'or', a, b: andExpr(), id: id() } } return a }
  const andExpr = (): Node => { let a = notExpr(); while (atKw('and')) { take(); skipNl(); a = { t: 'bin', op: 'and', a, b: notExpr(), id: id() } } return a }
  const notExpr = (): Node => { if (atKw('not')) { take(); return { t: 'un', op: 'not', a: notExpr(), id: id() } } return cmp() }
  const cmp = (): Node => {
    let a = add()
    while (at('op') && ['==', '!=', '<', '>', '<=', '>='].includes(peek().v)) { const op = take().v; skipNl(); a = { t: 'bin', op, a, b: add(), id: id() } }
    return a
  }
  const add = (): Node => { let a = mul(); while (at('op') && (peek().v === '+' || peek().v === '-')) { const op = take().v; skipNl(); a = { t: 'bin', op, a, b: mul(), id: id() } } return a }
  const mul = (): Node => { let a = unary(); while (at('op') && ['*', '/', '%'].includes(peek().v)) { const op = take().v; skipNl(); a = { t: 'bin', op, a, b: unary(), id: id() } } return a }
  const unary = (): Node => {
    if (atOp('-')) { take(); return { t: 'un', op: '-', a: unary(), id: id() } }
    if (atOp('+')) { take(); return unary() }
    return postfix()
  }
  const postfix = (): Node => {
    let a = primary()
    for (;;) {
      if (atOp('[')) { take(); skipNl(); const k = expr(); skipNl(); expect('op', ']'); a = { t: 'index', obj: a, k, id: id() }; continue }
      if (atOp('.') && peek(1).k === 'id') { take(); const name = take().v; a = { t: 'member', obj: a, name, id: id() }; continue }
      if (atOp('(')) { a = call(a); continue }
      break
    }
    return a
  }
  const call = (fn: Node): Node => {
    take()
    const args: Node[] = [], named: Record<string, Node> = {}
    skipNl()
    while (!atOp(')')) {
      if (at('id') && peek(1).k === 'op' && peek(1).v === '=' ) { const n = take().v; take(); skipNl(); named[n] = expr() } else args.push(expr())
      skipNl()
      if (atOp(',')) { take(); skipNl() } else if (!atOp(')')) err('Expected "," or ")" in the call.')
    }
    take()
    return { t: 'call', fn, args, named, id: id() }
  }
  const primary = (): Node => {
    const t = peek()
    if (t.k === 'num') { take(); return { t: 'num', v: Number(t.v), id: id() } }
    if (t.k === 'str') { take(); return { t: 'str', v: t.v, id: id() } }
    if (t.k === 'color') { take(); return { t: 'color', v: t.v, id: id() } }
    if (t.k === 'op' && t.v === '(') { take(); skipNl(); const e = expr(); skipNl(); expect('op', ')'); return e }
    if (t.k === 'op' && t.v === '[') {
      take(); skipNl(); const items: Node[] = []
      while (!atOp(']')) { items.push(expr()); skipNl(); if (atOp(',')) { take(); skipNl() } }
      take(); return { t: 'tuple', items, id: id() }
    }
    if (t.k === 'id') {
      if (t.v === 'true' || t.v === 'false') { take(); return { t: 'bool', v: t.v === 'true', id: id() } }
      if (t.v === 'na' && !(peek(1).k === 'op' && peek(1).v === '(')) { take(); return { t: 'na', id: id() } }
      if (t.v === 'if') return ifExpr()
      if (t.v === 'switch') return switchExpr()
      if (KEYWORDS.has(t.v) && t.v !== 'not') err(`Unexpected "${t.v}".`)
      take(); return { t: 'id', v: t.v, id: id() }
    }
    return err(`Unexpected "${t.v || t.k}".`)
  }
  const ifExpr = (): Node => {
    expect('id', 'if')
    const cases: { c: Node | null; body: Stmt[] }[] = [{ c: expr(), body: block() }]
    for (;;) {
      const save = p
      skipNl()
      if (atKw('else')) {
        take()
        if (atKw('if')) { take(); cases.push({ c: expr(), body: block() }); continue }
        cases.push({ c: null, body: block() }); break
      }
      p = save; break
    }
    return { t: 'if', cases, id: id() }
  }
  const switchExpr = (): Node => {
    expect('id', 'switch')
    const subject = at('nl') ? null : expr()
    const cases: { c: Node | null; body: Stmt[] }[] = []
    skipNl(); expect('indent')
    while (!at('dedent') && !at('eof')) {
      skipNl(); if (at('dedent')) break
      let c: Node | null = null
      if (atOp('=>')) { take() } else { c = expr(); expect('op', '=>') }
      const body = at('nl') ? block() : [{ s: 'expr', e: expr(), line: peek().line } as Stmt]
      cases.push({ c, body }); skipNl()
    }
    if (at('dedent')) take()
    return { t: 'switch', subject, cases, id: id() }
  }
  const forExpr = (): Node => {
    expect('id', 'for')
    if (atOp('[')) { take(); const names: string[] = []; while (at('id')) { names.push(take().v); if (atOp(',')) take() } expect('op', ']'); expect('id', 'in'); const arr = expr(); return { t: 'forin', names, arr, body: block(), id: id() } }
    const name = expect('id').v
    if (atKw('in')) { take(); const arr = expr(); return { t: 'forin', names: [name], arr, body: block(), id: id() } }
    expect('op', '='); const from = expr(); expect('id', 'to'); const to = expr()
    let step: Node | null = null
    if (atKw('by')) { take(); step = expr() }
    return { t: 'for', name, from, to, step, body: block(), id: id() }
  }

  const body: Stmt[] = []
  skipNl()
  while (!at('eof')) { if (at('dedent') || at('indent')) { take(); continue } body.push(statement()); skipNl() }
  return { body, version: vm ? Number(vm[1]) : 5, fns }
}
