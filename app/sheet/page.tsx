// 이벤트 시트 — 이벤트 명칭 / 한글 / 영어 / 중국어(간체) / 일본어 / 중국어(번체)
//
// 한글 칸을 채우고 실행하면 나머지 4칸이 채워진다. 저장하면 다시 불러 쓸 수 있다.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Shell, EmptyState, btnPrimary, btnGhost, inputStyle } from "../_ui/Shell";
import { langMeta } from "../_ui/lang";
import type { TargetLang } from "@/lib/translator/types";

const LANG_COLS: { id: TargetLang; label: string }[] = [
  { id: "en", label: "영어" },
  { id: "cn", label: "중국어(간체)" },
  { id: "ja", label: "일본어" },
  { id: "tw", label: "중국어(번체)" },
];

interface Row {
  id: string;
  name: string;
  ko: string;
  translations: Partial<Record<TargetLang, string>>;
  reused?: Partial<Record<TargetLang, boolean>>;
  error?: string;
}

interface SheetMeta { id: string; title: string; rowCount: number; updatedAt: string }

const GRID = "38px 180px minmax(160px,1fr) minmax(160px,1fr) minmax(160px,1fr) minmax(160px,1fr) minmax(160px,1fr) 34px";

function blank(): Row {
  return { id: Math.random().toString(36).slice(2, 10), name: "", ko: "", translations: {} };
}

export default function SheetPage() {
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<Row[]>([blank(), blank(), blank()]);
  const [saved, setSaved] = useState<SheetMeta[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<{ items: number; reused: number; krw: number } | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [showPaste, setShowPaste] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/translator/sheet");
      if (!res.ok) return;
      const d = await res.json();
      setSaved(d.sheets || []);
    } catch { /* 목록은 없어도 작업에 지장 없다 */ }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  async function openSheet(id: string) {
    setError(""); setMessage("");
    try {
      const res = await fetch(`/api/translator/sheet?id=${id}`);
      if (!res.ok) throw new Error("시트를 불러오지 못했습니다");
      const d = await res.json();
      setSheetId(d.sheet.id);
      setTitle(d.sheet.title);
      setRows(d.sheet.rows.length ? d.sheet.rows : [blank()]);
      setLastRun(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
    }
  }

  function applyPaste() {
    const text = pasteRef.current?.value ?? "";
    if (!text.trim()) return;
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const split = (l: string) => (l.includes("\t") ? l.split("\t") : l.split(","));
    const first = split(lines[0]).map((c) => c.trim());
    const header = first.some((c) => c.includes("이벤트") || c === "한글" || c === "영어" || c.includes("중국어") || c === "일본어");
    const parsed: Row[] = lines.slice(header ? 1 : 0).map((line) => {
      const c = split(line).map((x) => x.trim());
      return {
        id: Math.random().toString(36).slice(2, 10),
        name: c[0] ?? "",
        ko: c[1] ?? "",
        translations: {
          ...(c[2] ? { en: c[2] } : {}),
          ...(c[3] ? { cn: c[3] } : {}),
          ...(c[4] ? { ja: c[4] } : {}),
          ...(c[5] ? { tw: c[5] } : {}),
        },
      };
    });
    if (parsed.length === 0) return;
    setRows(parsed);
    setShowPaste(false);
    setMessage(`${parsed.length}행을 읽었습니다.${header ? " 첫 줄은 머리글로 보고 건너뛰었습니다." : ""}`);
  }

  async function run() {
    const target = rows.filter((r) => r.ko.trim());
    if (target.length === 0) { setError("한글 칸이 채워진 행이 없습니다."); return; }
    setRunning(true); setError(""); setMessage(""); setLastRun(null);
    try {
      const res = await fetch("/api/translator/sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, overwrite, title: title || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "번역 실패");
      setRows(d.rows);
      // Sonnet 4.6 기준 — 캐시 쓰기 1.25배, 캐시 읽기 0.1배 (pricing.ts 와 같은 계산)
      const usd = d.usage
        ? (d.usage.inputTokens / 1e6) * 3 + (d.usage.cacheWriteTokens / 1e6) * 3.75 +
          (d.usage.cacheReadTokens / 1e6) * 0.3 + (d.usage.outputTokens / 1e6) * 15
        : 0;
      const krw = Math.round(usd * 1400);
      setLastRun({ items: d.items, reused: d.reused, krw });
      setMessage(`${d.items}칸 번역했습니다.${d.reused > 0 ? ` 그중 ${d.reused}칸은 검수본을 재사용해 비용이 들지 않았습니다.` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "번역 실패");
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/translator/sheet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sheetId ?? undefined, title: title || "이름 없는 시트", rows }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "저장 실패");
      setSheetId(d.sheet.id);
      setTitle(d.sheet.title);
      setMessage("저장했습니다. 목록에서 다시 열 수 있습니다.");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const head = ["이벤트 명칭", "한글", ...LANG_COLS.map((c) => c.label)];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = rows.map((r) => [r.name, r.ko, ...LANG_COLS.map((c) => r.translations[c.id] ?? "")].map(esc).join(","));
    // BOM 을 붙여야 엑셀에서 한글이 깨지지 않는다
    const blob = new Blob(["﻿" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${title || "이벤트시트"}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function patch(i: number, p: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  }

  const filled = rows.filter((r) => r.ko.trim()).length;
  const th: React.CSSProperties = { fontSize: 11, letterSpacing: ".05em", color: "var(--dim)" };
  const cell: React.CSSProperties = {
    background: "transparent", border: "1px solid transparent", borderRadius: 5,
    color: "var(--txt)", fontSize: 13, padding: "6px 8px", outline: "none", width: "100%",
    resize: "vertical", minHeight: 32, lineHeight: 1.5,
  };

  return (
    <Shell
      right={
        <>
          <button onClick={() => setShowPaste((v) => !v)} style={btnGhost}>붙여넣기</button>
          <button onClick={exportCsv} style={btnGhost}>CSV 내보내기</button>
          <button onClick={save} disabled={saving} style={{ ...btnGhost, opacity: saving ? 0.4 : 1 }}>
            {saving ? "저장 중…" : "저장"}
          </button>
          <button onClick={run} disabled={running || filled === 0} style={{ ...btnPrimary, opacity: running || filled === 0 ? 0.35 : 1 }}>
            {running ? "번역 중…" : `실행 (${filled}행)`}
          </button>
        </>
      }
    >
      {/* 제목 · 저장된 시트 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="시트 이름 (예: 2026년 10월 이벤트)"
          style={{ ...inputStyle, width: 280, fontSize: 13 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}>
          <input id="ow" type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          이미 채워진 칸도 다시 번역
        </label>
        {saved.length > 0 && (
          <select
            id="saved"
            value={sheetId ?? ""}
            onChange={(e) => e.target.value && openSheet(e.target.value)}
            style={{ ...inputStyle, marginLeft: "auto" }}
          >
            <option value="">저장된 시트 열기…</option>
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.rowCount}행)
              </option>
            ))}
          </select>
        )}
      </div>

      {showPaste && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            엑셀에서 표를 복사해 그대로 붙여넣으세요. 열 순서는 <b style={{ color: "var(--txt)" }}>이벤트 명칭 · 한글 · 영어 · 중국어(간체) · 일본어 · 중국어(번체)</b> 입니다. 머리글 줄은 자동으로 건너뜁니다.
          </span>
          <textarea
            id="paste"
            ref={pasteRef}
            spellCheck={false}
            placeholder={"가을 리프팅 이벤트\t울쎄라 300샷 특가\n겨울 스킨부스터\t리쥬란 2회 패키지"}
            style={{ ...inputStyle, minHeight: 120, fontSize: 12.5, lineHeight: 1.6, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={applyPaste} style={btnPrimary}>표로 넣기</button>
            <button onClick={() => setShowPaste(false)} style={btnGhost}>닫기</button>
          </div>
        </div>
      )}

      {error && <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>}
      {message && <p style={{ color: "var(--accent)", fontSize: 13, margin: 0 }}>{message}</p>}
      {lastRun && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
          이번 실행 — 번역 {lastRun.items}칸 · 재사용 {lastRun.reused}칸 · 비용 약 {lastRun.krw.toLocaleString()}원
        </p>
      )}

      {/* 표 */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "10px 12px", background: "var(--surface2)", borderBottom: "1px solid var(--line)" }}>
          <span style={th} />
          <span style={th}>이벤트 명칭</span>
          <span style={th}>한글</span>
          {LANG_COLS.map((c) => (
            <span key={c.id} style={th}>{c.label}</span>
          ))}
          <span style={th} />
        </div>

        {rows.map((r, i) => (
          <div
            key={r.id}
            style={{
              display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "7px 12px",
              borderBottom: "1px solid var(--line)", alignItems: "start",
              background: r.error ? "rgba(226,101,95,.06)" : "transparent",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--dim)", fontVariantNumeric: "tabular-nums", paddingTop: 9 }}>
              {i + 1}
            </span>
            <textarea id={`n-${r.id}`} value={r.name} onChange={(e) => patch(i, { name: e.target.value })} rows={1} spellCheck={false} style={cell} />
            <textarea id={`k-${r.id}`} value={r.ko} onChange={(e) => patch(i, { ko: e.target.value })} rows={1} spellCheck={false} style={{ ...cell, border: "1px solid var(--line2)", background: "var(--surface2)" }} />
            {LANG_COLS.map((c) => {
              const m = langMeta(c.id);
              const reused = r.reused?.[c.id];
              return (
                <div key={c.id} style={{ position: "relative" }}>
                  <textarea
                    id={`${c.id}-${r.id}`}
                    lang={m.tag}
                    value={r.translations[c.id] ?? ""}
                    onChange={(e) => patch(i, { translations: { ...r.translations, [c.id]: e.target.value } })}
                    rows={1}
                    spellCheck={false}
                    style={{ ...cell, fontFamily: m.font }}
                  />
                  {reused && (
                    <span
                      title="검수본 재사용 — API 호출 없음"
                      style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: "var(--accent)" }}
                    >
                      검수본
                    </span>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}
              title="행 삭제"
              style={{ width: 26, height: 26, marginTop: 4, display: "grid", placeItems: "center", borderRadius: 5, border: "1px solid transparent", background: "transparent", color: "var(--dim)", cursor: "pointer" }}
            >
              <i className="ph ph-x" style={{ fontSize: 12 }} />
            </button>
          </div>
        ))}

        <div style={{ padding: "10px 12px" }}>
          <button onClick={() => setRows((rs) => [...rs, blank()])} style={{ ...btnGhost, fontSize: 12, padding: "5px 11px" }}>
            + 행 추가
          </button>
        </div>
      </div>

      {rows.every((r) => !r.ko.trim() && !r.name.trim()) && (
        <EmptyState
          icon="ph-rows"
          title="이벤트 명칭과 한글을 채우세요"
          body="엑셀에서 표를 복사해 「붙여넣기」로 한 번에 넣을 수도 있습니다. 실행을 누르면 나머지 4개 언어가 채워집니다."
        />
      )}
    </Shell>
  );
}
