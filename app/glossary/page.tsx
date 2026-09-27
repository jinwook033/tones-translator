// 5 · 용어집 — 용어 고정과 분류
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell, EmptyState, btnPrimary, btnGhost, inputStyle } from "../_ui/Shell";
import { CATEGORY_META, type GlossaryCategory } from "@/lib/translator/types";

interface Entry {
  korean: string;
  category: string;
  en: string | null;
  cn: string | null;
  tw: string | null;
  ja: string | null;
  locked?: boolean;
  substitute?: boolean;
  note?: string | null;
}

const CATEGORY_CODES = Object.keys(CATEGORY_META) as GlossaryCategory[];

/** 이 용어가 실제로 토큰 고정되는가 — glossary-engine.shouldSubstitute 와 같은 규칙 */
function isPinned(e: Entry): boolean {
  if (typeof e.substitute === "boolean") return e.substitute;
  return CATEGORY_META[e.category as GlossaryCategory]?.substitute ?? true;
}

const EMPTY: Entry = { korean: "", category: "procedure", en: "", cn: "", tw: "", ja: "", locked: true };

export default function GlossaryPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Entry>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/translator/glossary");
      if (!res.ok) throw new Error("용어집을 불러오지 못했습니다");
      const d = await res.json();
      setEntries(d.entries || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) m[e.category] = (m[e.category] || 0) + 1;
    return m;
  }, [entries]);

  const rows = useMemo(() => {
    let r = entries;
    if (cat) r = r.filter((e) => e.category === cat);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      r = r.filter((e) =>
        (e.korean + (e.en ?? "") + (e.cn ?? "") + (e.tw ?? "") + (e.ja ?? "")).toLowerCase().includes(q),
      );
    }
    return r;
  }, [entries, cat, query]);

  async function save() {
    if (!form.korean.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/translator/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "저장 실패");
      setMessage(`"${form.korean}" 추가했습니다.`);
      setForm(EMPTY); setShowAdd(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function remove(korean: string) {
    if (!confirm(`"${korean}" 을(를) 용어집에서 지웁니다.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/translator/glossary", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ korean }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "삭제 실패");
      }
      setMessage(`"${korean}" 지웠습니다.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  const GRID = "150px 160px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 54px 44px";

  return (
    <Shell
      right={
        <button onClick={() => setShowAdd((v) => !v)} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ph ph-plus" style={{ fontSize: 13 }} />
          용어 추가
        </button>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 7, width: 280,
            background: "var(--surface2)", border: "1px solid var(--line2)", borderRadius: 6, padding: "6px 10px",
          }}
        >
          <i className="ph ph-magnifying-glass" style={{ fontSize: 13, color: "var(--dim)" }} />
          <input
            id="gq"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="한국어 또는 번역 검색"
            style={{ flex: 1, background: "transparent", border: 0, color: "var(--txt)", fontSize: 12.5, outline: "none" }}
          />
        </div>
        <span style={{ fontSize: 12, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
          전체 {entries.length}건 · {Object.keys(counts).length}개 분류
          {rows.length !== entries.length && ` · ${rows.length}건 표시`}
        </span>
      </div>

      {/* 분류 칩 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CATEGORY_CODES.filter((c) => counts[c]).map((c) => {
          const on = cat === c;
          const meta = CATEGORY_META[c];
          return (
            <button
              key={c}
              onClick={() => setCat(on ? null : c)}
              title={meta.substitute ? "토큰으로 고정" : "문맥에 맡김"}
              style={{
                display: "flex", alignItems: "center", gap: 7, padding: "5px 10px", borderRadius: 6,
                fontSize: 12, cursor: "pointer",
                background: on ? "var(--accent-soft)" : "var(--surface)",
                border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                color: on ? "var(--accent)" : "var(--txt)",
              }}
            >
              <span>{c}</span>
              <span style={{ color: "var(--muted)" }}>{meta.label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: on ? "var(--accent)" : "var(--dim)" }}>
                {counts[c]}
              </span>
            </button>
          );
        })}
      </div>

      {error && <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>}
      {message && <p style={{ color: "var(--accent)", fontSize: 13, margin: 0 }}>{message}</p>}

      {/* 추가 폼 */}
      {showAdd && (
        <div
          style={{
            background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: 8,
            padding: 16, display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>용어 추가</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
            <input id="f-ko" value={form.korean} onChange={(e) => setForm({ ...form, korean: e.target.value })} placeholder="한국어" style={inputStyle} />
            <select id="f-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle}>
              {CATEGORY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c} ({CATEGORY_META[c].label}) {CATEGORY_META[c].substitute ? "· 고정" : "· 문맥번역"}
                </option>
              ))}
            </select>
            <input id="f-en" value={form.en ?? ""} onChange={(e) => setForm({ ...form, en: e.target.value })} placeholder="English" style={inputStyle} />
            <input id="f-cn" value={form.cn ?? ""} onChange={(e) => setForm({ ...form, cn: e.target.value })} placeholder="简体中文" style={{ ...inputStyle, fontFamily: "var(--sc)" }} />
            <input id="f-tw" value={form.tw ?? ""} onChange={(e) => setForm({ ...form, tw: e.target.value })} placeholder="繁體中文" style={{ ...inputStyle, fontFamily: "var(--tc)" }} />
            <input id="f-ja" value={form.ja ?? ""} onChange={(e) => setForm({ ...form, ja: e.target.value })} placeholder="日本語" style={{ ...inputStyle, fontFamily: "var(--ja)" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy || !form.korean.trim()} style={{ ...btnPrimary, opacity: busy || !form.korean.trim() ? 0.4 : 1 }}>
              {busy ? "저장 중…" : "저장"}
            </button>
            <button onClick={() => { setShowAdd(false); setForm(EMPTY); }} style={btnGhost}>취소</button>
          </div>
        </div>
      )}

      {/* 표 */}
      {loading ? (
        <p style={{ color: "var(--dim)", fontSize: 13, margin: 0 }}>불러오는 중…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="ph-book-open" title="해당하는 용어가 없습니다" body="검색어나 분류 필터를 바꿔보세요." />
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          <div
            style={{
              display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "10px 14px",
              background: "var(--surface2)", borderBottom: "1px solid var(--line)",
              fontSize: 11, letterSpacing: ".05em", color: "var(--dim)",
            }}
          >
            <span>한국어</span><span>분류</span><span>ENGLISH</span><span>简体</span><span>繁體</span><span>日本語</span><span>고정</span><span />
          </div>
          {rows.map((g) => {
            const meta = CATEGORY_META[g.category as GlossaryCategory];
            const pinned = isPinned(g);
            return (
              <div
                key={g.korean}
                style={{
                  display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "11px 14px",
                  borderBottom: "1px solid var(--line)", alignItems: "center", fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 500 }}>{g.korean}</span>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {g.category}{meta ? ` (${meta.label})` : ""}
                </span>
                <span>{g.en}</span>
                <span lang="zh-CN" style={{ fontFamily: "var(--sc)" }}>{g.cn}</span>
                <span lang="zh-TW" style={{ fontFamily: "var(--tc)" }}>{g.tw}</span>
                <span lang="ja" style={{ fontFamily: "var(--ja)" }}>{g.ja}</span>
                <span title={pinned ? "토큰으로 고정" : "문맥에 맡김"}>
                  <i
                    className={`ph ${pinned ? "ph-push-pin" : "ph-push-pin-slash"}`}
                    style={{ fontSize: 14, color: pinned ? "var(--accent)" : "var(--dim)" }}
                  />
                </span>
                <button
                  onClick={() => remove(g.korean)}
                  title="삭제"
                  style={{
                    width: 26, height: 26, display: "grid", placeItems: "center", borderRadius: 5,
                    border: "1px solid transparent", background: "transparent", color: "var(--dim)", cursor: "pointer",
                  }}
                >
                  <i className="ph ph-trash" style={{ fontSize: 13 }} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
