/**
 * Static scanner shared by the two FE↔API parity guards.
 *
 * `route-parity.test.ts` compares the PATHS `web-internal` calls against the
 * paths `apps/api` serves. `body-parity.test.ts` compares the request-body KEYS.
 * Both need the same awkward primitives — walk the two source trees, read a
 * template literal that contains nested `${...}` holes, normalise a path to a
 * comparable shape — so they live here once instead of drifting apart in two
 * test files.
 *
 * Test-only module: nothing under `app/api/**` imports it, so it is never
 * bundled. It reads the repo from disk (`node:fs`) by design — the whole point is
 * to compare two halves that no single unit test can see at once.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const API_V1 = join(REPO_ROOT, 'apps/api/src/app/api/v1');
/**
 * The WHOLE frontend source tree, not just its data layer. Scanning only
 * `src/lib` was O44: `readdirSync` there is flat AND blind to `src/app/**`, so
 * the 25 `api.*` calls that page components make directly were never compared
 * against the served routes — which hid six dead admin endpoints.
 */
export const FE_SRC = join(REPO_ROOT, 'web-internal/src');

/** HTTP methods a Next route handler may export. */
export const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

/** Every `route.ts` under `apps/api/src/app/api/v1`. */
export function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkRoutes(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every non-test `.ts`/`.tsx` under the frontend source tree. `.tsx` matters as
 * much as `.ts` here: page components are where the untracked calls hid (O44).
 */
export function walkFe(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkFe(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) {
      continue;
    }
    out.push(full);
  }
  return out;
}

/**
 * Removes comments from TypeScript source, leaving string and template literals
 * intact. Body-key matching MUST run on code only: these route files document
 * their own wire contract in prose, so a key named in a doc comment would satisfy
 * a naive `\bkey\b` search on the raw text and the guard would pass on a handler
 * that never reads the field — exactly the bug it exists to catch.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const lit = readLiteral(src, i);
      if (lit) {
        out += src.slice(i, lit.end);
        i = lit.end;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** A route file's normalised path (`[id]` → `{}`) plus its source text. */
export interface RouteFile {
  path: string;
  /** Full source, comments included. */
  src: string;
  /** Source with comments removed — what key matching must use. */
  code: string;
  /**
   * The route's own code plus the code of every `@/lib/*` module it imports —
   * the full text in which a body key may legitimately be read.
   */
  readsFrom: string;
  file: string;
}

/**
 * The `@/lib/*` modules a route may delegate to, as module name → comment-stripped
 * source. Many handlers do not name the wire keys themselves: they read
 * `Parameters<typeof toCampaignInput>[0]` and hand the body to a `*ToInput` mapper
 * in `wire.ts`, which is where the snake_case keys actually live. A key search
 * that stopped at the route file would call every one of those routes broken.
 */
function libSources(): Map<string, string> {
  const dir = join(REPO_ROOT, 'apps/api/src/lib');
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir)) {
    if (!/\.ts$/.test(entry) || /\.test\.ts$/.test(entry)) {
      continue;
    }
    out.set(entry.replace(/\.ts$/, ''), stripComments(readFileSync(join(dir, entry), 'utf8')));
  }
  return out;
}

/** Every served route file, keyed by normalised path. */
export function routeFiles(): RouteFile[] {
  const libs = libSources();
  return walkRoutes(API_V1).map((file) => {
    const src = readFileSync(file, 'utf8');
    const code = stripComments(src);
    // Follow `@/lib/x` imports so a delegated mapper's keys count as read.
    const delegated: string[] = [];
    for (const m of code.matchAll(/from\s+'@\/lib\/([\w-]+)'/g)) {
      const lib = libs.get(m[1]);
      if (lib) {
        delegated.push(lib);
      }
    }
    return {
      path:
        '/' +
        file
          .slice(API_V1.length + 1)
          .replace(/\/route\.ts$/, '')
          .replace(/\[[^\]]+\]/g, '{}'),
      src,
      code,
      readsFrom: [code, ...delegated].join('\n'),
      file: file.slice(REPO_ROOT.length),
    };
  });
}

/**
 * The route table apps/api actually serves, as `METHOD /path` with every dynamic
 * segment normalised to `{}` (`[id]` and `${id}` compare equal).
 */
export function apiRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const { path, code } of routeFiles()) {
    for (const method of METHODS) {
      if (new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(code)) {
        routes.add(`${method} ${path}`);
      }
    }
  }
  return routes;
}

/**
 * Reads one string/template literal starting at `open` and returns its raw text
 * plus the index after its closing quote. A regex cannot do this: FE paths embed
 * `${cond ? `?${qs}` : ''}`, i.e. nested template literals AND nested braces, so
 * the argument is scanned with a depth counter instead.
 */
export function readLiteral(src: string, open: number): { raw: string; end: number } | null {
  const quote = src[open];
  if (quote !== '`' && quote !== "'" && quote !== '"') {
    return null;
  }
  let raw = '';
  let i = open + 1;
  let depth = 0; // nesting inside ${ ... }
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      raw += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      depth += 1;
      raw += '${';
      i += 2;
      continue;
    }
    if (depth > 0) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      raw += ch;
      i += 1;
      continue;
    }
    if (ch === quote) {
      return { raw, end: i + 1 };
    }
    raw += ch;
    i += 1;
  }
  return null;
}

/** Collapses a raw FE path literal to a comparable route shape. */
export function normalisePath(raw: string): string {
  let path = '';
  let i = 0;
  let depth = 0;
  // Replace each balanced ${...} hole with a single {} placeholder.
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      depth = 1;
      i += 2;
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth += 1;
        if (raw[i] === '}') depth -= 1;
        i += 1;
      }
      path += '{}';
      continue;
    }
    path += raw[i];
    i += 1;
  }
  return path.replace(/\?.*$/, '').replace(/\/+$/, '');
}

/** One `api.<method>(<path>, <body?>)` call found in the frontend. */
export interface FeCall {
  call: string;
  method: string;
  path: string;
  /** Raw source of the body argument when written inline, else `null`. */
  bodyObject: string | null;
  /**
   * Top-level wire keys the body carries, from an inline literal or from the
   * declared interface of a variable body. Empty for a bodyless call.
   */
  bodyKeys: string[];
  /** Where the keys came from, for the failure message. */
  bodySource: 'literal' | 'interface' | 'none' | 'unresolved';
  file: string;
}

const CALL_RE = /\bapi\.(get|post|patch|put|del|delete)\s*(?:<[\s\S]*?>)?\s*\(\s*/g;

/**
 * Every `api.<method>(<path>)` call in the FE data layer, as `METHOD /path`.
 * Calls whose path is fully computed at runtime (a variable base rather than a
 * literal) cannot be checked statically and are skipped — the count assertion in
 * the tests keeps this from silently checking nothing.
 */
export function feCalls(): FeCall[] {
  const out: FeCall[] = [];
  for (const file of walkFe(FE_SRC)) {
    // Comments stripped for the same reason as the route side: a commented-out
    // call is not a call, and a key named in prose is not a key that is sent.
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(CALL_RE)) {
      const lit = readLiteral(src, m.index + m[0].length);
      if (!lit || lit.raw.startsWith('${')) {
        continue; // computed base — not statically checkable
      }
      const method = m[1].toUpperCase() === 'DEL' ? 'DELETE' : m[1].toUpperCase();
      const path = normalisePath(lit.raw);
      const body = readBody(src, lit.end);
      out.push({
        call: `${method} ${path}`,
        method,
        path,
        bodyObject: body.kind === 'literal' ? body.raw : null,
        bodyKeys: body.keys,
        bodySource: body.kind,
        file: file.slice(REPO_ROOT.length),
      });
    }
  }
  return out;
}

/** What the second argument of an `api.<method>()` call turned out to be. */
export interface BodyRead {
  kind: 'literal' | 'interface' | 'none' | 'unresolved';
  raw: string;
  keys: string[];
}

/**
 * Reads the request body of an `api.post(path, body)` call and returns the
 * top-level wire keys it carries.
 *
 * Two spellings both matter, and skipping the second was how `/attempts/{id}/close`
 * and `/attempts/{id}/qualify` — the steps right after the negotiation — went
 * unchecked:
 *
 *   - `api.post(path, { a, b })` — an inline literal; keys read straight off it.
 *   - `api.post(path, input)` — a variable. TypeScript checks it against the FE's
 *     OWN interface, which is declared in the FE and asserts nothing about the
 *     route, so drift here is just as invisible. The declared type is resolved
 *     (`function f(input: ClosingInput)` → `interface ClosingInput`) and its field
 *     names are used instead.
 *
 * `unresolved` is returned when the variable's type cannot be found, so the tests
 * can assert that the unresolved set stays small rather than let it hide drift.
 */
export function readBody(src: string, afterPath: number): BodyRead {
  let i = afterPath;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] !== ',') {
    return { kind: 'none', raw: '', keys: [] };
  }
  i += 1;
  while (i < src.length && /\s/.test(src[i])) i += 1;

  if (src[i] === '{') {
    const raw = readObjectLiteral(src, i);
    return raw ? { kind: 'literal', raw, keys: topLevelKeys(raw) } : { kind: 'unresolved', raw: '', keys: [] };
  }

  const ident = /^([A-Za-z_$][\w$]*)\s*[),]/.exec(src.slice(i));
  if (!ident) {
    return { kind: 'unresolved', raw: '', keys: [] };
  }
  // A locally-built body (`const payload = { ... }; api.post(path, payload)`) is
  // still a literal — read the initialiser rather than giving up on it.
  const local = localObjectLiteral(src, ident[1], i);
  if (local) {
    return { kind: 'literal', raw: local, keys: topLevelKeys(local) };
  }
  const type = declaredType(src, ident[1], i);
  if (!type) {
    return { kind: 'unresolved', raw: ident[1], keys: [] };
  }
  const fields = interfaceFields(src, type);
  return fields
    ? { kind: 'interface', raw: type, keys: fields }
    : { kind: 'unresolved', raw: `${ident[1]}: ${type}`, keys: [] };
}

/** Reads a balanced `{...}` starting at `open`. */
export function readObjectLiteral(src: string, open: number): string | null {
  if (src[open] !== '{') {
    return null;
  }
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return src.slice(open, i + 1);
      }
    }
    i += 1;
  }
  return null;
}

/**
 * The object literal a local `const <name> = { ... }` is initialised with, when
 * one is declared before the call. Returns `null` when the initialiser is not a
 * plain literal — a ternary (`override === null ? {} : { override }`) yields the
 * branch that actually carries keys, since an empty body asserts nothing.
 */
export function localObjectLiteral(src: string, name: string, before: number): string | null {
  const head = src.slice(0, before);
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*`, 'g');
  let last = -1;
  for (const m of head.matchAll(decl)) {
    last = m.index + m[0].length;
  }
  if (last < 0) {
    return null;
  }
  // Take the last `{...}` on the initialiser's line-run: for a ternary that is
  // the branch with the keys, and for a plain literal it is the literal itself.
  let best: string | null = null;
  const tail = src.slice(last);
  const stop = tail.indexOf(';');
  const init = stop < 0 ? tail : tail.slice(0, stop + 1);
  for (let k = 0; k < init.length; k += 1) {
    if (init[k] !== '{') {
      continue;
    }
    const lit = readObjectLiteral(init, k);
    if (lit && lit !== '{}' && (!best || lit.length > best.length)) {
      best = lit;
    }
    if (lit) {
      k += lit.length - 1;
    }
  }
  return best;
}

/**
 * The declared type of a variable named `name`, as annotated in the nearest
 * preceding `name: Type` binding (a function parameter or a `const`). Generic
 * arguments and array brackets are stripped, so `rows: BulkRow[]` yields
 * `BulkRow`. Searching backwards from the call site is enough here: the FE data
 * layer is one thin function per endpoint, so the parameter list is a few lines
 * above its own `api.post`.
 */
export function declaredType(src: string, name: string, before: number): string | null {
  const re = new RegExp(`\\b${name}\\s*:\\s*([A-Za-z_$][\\w$.]*)(\\s*\\[\\s*\\])?`, 'g');
  let found: string | null = null;
  for (const m of src.slice(0, before).matchAll(re)) {
    found = m[1]; // keep the last (nearest) annotation
  }
  return found;
}

/**
 * The top-level field names of `interface <name> { ... }` declared in this
 * source. Nested object types are skipped by the same depth counter as
 * `topLevelKeys`; `extends` clauses are not followed (the wire types in this repo
 * are flat declarations).
 */
export function interfaceFields(src: string, name: string): string[] | null {
  const decl = new RegExp(`\\binterface\\s+${name}\\b[^{]*`, 'g').exec(src);
  if (!decl) {
    return null;
  }
  const body = readObjectLiteral(src, decl.index + decl[0].length);
  if (!body) {
    return null;
  }
  const fields: string[] = [];
  let depth = 0;
  for (const m of body.slice(1, -1).matchAll(/([{}[\]()])|(?:^|[,;\n])\s*([A-Za-z_$][\w$]*)\??\s*:/g)) {
    if (m[1]) {
      if ('{[('.includes(m[1])) depth += 1;
      else depth -= 1;
      continue;
    }
    if (depth === 0 && m[2]) {
      fields.push(m[2]);
    }
  }
  return fields;
}

/**
 * The top-level property names of an object literal's source text. Nested
 * objects/arrays are skipped (a depth counter), so `{ parties: { allocations:
 * [...] } }` yields just `parties` — the nested shapes are the wire types'
 * business, and those are shared as interfaces.
 *
 * Shorthand (`{ rows }`) IS reported — the property name is the identifier, so it
 * is a wire key like any other. Computed keys and spreads are not: a spread's keys
 * are not visible in the literal at all.
 */
export function topLevelKeys(objectSrc: string): string[] {
  const inner = objectSrc.slice(1, -1);
  const keys: string[] = [];
  let depth = 0;
  // Group 2/3: `key:` — group 4/5: shorthand `{ rows }`, whose property name is
  // the identifier itself and is just as much a wire key.
  const tokenRe =
    /([{}[\]()])|(^|[,;])\s*([A-Za-z_$][\w$]*)\s*:|(^|[,;])\s*([A-Za-z_$][\w$]*)\s*(?=[,;]|$)/g;
  for (const m of inner.matchAll(tokenRe)) {
    if (m[1]) {
      if ('{[('.includes(m[1])) depth += 1;
      else depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    if (m[3]) {
      keys.push(m[3]);
    } else if (m[5]) {
      keys.push(m[5]);
    }
  }
  return keys;
}

/**
 * Does a FE call shape match a served route shape? Compared per path segment:
 * a `{}` on either side matches any single segment, so the FE's
 * `/divisions/Creative/brief-queue` matches the route `/divisions/{}/brief-queue`.
 * A trailing `{}` on the FE side may also be an interpolated query string
 * (`` `/my-tasks${query}` ``), so one extra trailing placeholder is allowed.
 */
export function servedBy(feCall: string, route: string): boolean {
  const [feMethod, fePath = ''] = feCall.split(' ');
  const [rtMethod, rtPath = ''] = route.split(' ');
  if (feMethod !== rtMethod) {
    return false;
  }
  const rt = rtPath.split('/');
  const segmentsMatch = (fe: string[]) =>
    fe.length === rt.length && fe.every((seg, i) => seg === rt[i] || seg === '{}' || rt[i] === '{}');

  // An interpolated query string can appear either as its own trailing segment
  // (`/a/${qs}`) or glued to the last one (`` `/my-tasks${query}` `` →
  // `/my-tasks{}`). Try the literal shape first, then those two readings.
  const base = fePath.split('/');
  if (segmentsMatch(base)) {
    return true;
  }
  const last = base[base.length - 1];
  if (last === '{}' && segmentsMatch(base.slice(0, -1))) {
    return true;
  }
  if (last.endsWith('{}') && last.length > 2) {
    return segmentsMatch([...base.slice(0, -1), last.slice(0, -2)]);
  }
  return false;
}

/**
 * The route file that serves a FE call, or `null`. When several route shapes
 * match, the most specific one wins (fewest `{}` placeholders) — otherwise
 * `POST /leads/bulk` resolves to `/leads/{}` and gets compared against the wrong
 * handler's body.
 */
export function routeFor(call: FeCall, files: RouteFile[]): RouteFile | null {
  let best: RouteFile | null = null;
  let bestScore = -1;
  for (const rf of files) {
    if (!new RegExp(`export\\s+(async\\s+)?function\\s+${call.method}\\b`).test(rf.code)) {
      continue;
    }
    if (!servedBy(call.call, `${call.method} ${rf.path}`)) {
      continue;
    }
    const score = rf.path.split('/').filter((seg) => seg !== '{}').length;
    if (score > bestScore) {
      bestScore = score;
      best = rf;
    }
  }
  return best;
}
