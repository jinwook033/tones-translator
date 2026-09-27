// 4 · 검수 — 원어민 검수자가 항목별로 고치는 화면
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shell, EmptyState, Tabs, btnGhost, btnPrimary, inputStyle } from "../_ui/Shell";
import { LANGS, langMeta, contextLabel } from "../_ui/lang";
import type { TargetLang } from "@/lib/translator/types";

type Status = "pending" | "approved" | "corrected";

interface Issue { severity: "block" | "warning"; code: string; message: string; suggestion?: string }

interface Item {
  id: string; lang: TargetLang; context: string; source: string; machine: string;
  corrected?: string; status: Status; confidence: number; issues: Issue[];
  reviewedBy?: string; reviewedAt?: string;
}

const STATUS_KO: Record<Status, string> = { pending: "검수 대기", approved: "승인", corrected: "수정됨" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<Shell><p style={{ color: "var(--dim)", fontSize: 13 }}>불러오는 중…</p></Shell>}>
      <ReviewScreen />
    </Suspense>
  );
}

function ReviewScreen() {
  const params = useSearchParams();
  const initial = (params.get("lang") as TargetLang) || "ja";

  const [lang, setLang] = useState<TargetLang>(initial);
  const [status, setStatus] = useState<Status | "">("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [query, setQuery] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Record<string, { pending: number; approved: number; corrected: number }>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ lang });
      if (status) p.set("status", status);
      if (onlyFlagged) p.set("issuesOnly", "true");
      if (query) p.set("search", query);
      const res = await fetch(`/api/translator/review?${p}`);
      if (!res.ok) throw new Error("목록을 불러오지 못했습니다");
      const d = await res.json();
      setItems(d.items || []);
      setStats(d.stats || {});
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, [lang, status, onlyFlagged, query]);

  useEffect(() => { load(); }, [load]);

  async function act(item: Item, action: "correct" | "approve" | "reopen") {
    setBusy(item.id); setError(""); setMessage("");
    try {
      const res = await fetch("/api/translator/review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          action,
          corrected: action === "correct" ? (drafts[item.id] ?? item.corrected ?? item.machine) : undefined,
          reviewedBy: reviewer || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "처리 실패");
      setMessage(
        action === "approve" ? "승인했습니다. 다음부터 이 번역을 그대로 씁니다."
        : action === "reopen" ? "검수 대기로 되돌렸습니다."
        : d.item.status === "corrected" ? "저장했습니다. 다음부터 고친 번역을 씁니다."
        : "모델 번역과 같아서 승인으로 처리했습니다.",
      );
      setDrafts((x) => { const n = { ...x }; delete n[item.id]; return n; });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy(null);
    }
  }

  async function promote(item: Item) {
    const reason = prompt("왜 이렇게 고쳐야 하는지 한 줄로 적어주세요.\n이 설명이 앞으로 모든 번역의 기준이 됩니다.", "");
    if (reason === null) return;
    setBusy(item.id); setError(""); setMessage("");
    try {
      const res = await fetch("/api/translator/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, reason, reviewedBy: reviewer || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "예문 등록 실패");
      setMessage(`대조 예문으로 올렸습니다 (총 ${d.exampleCount}개). 비슷한 문장에도 반영됩니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "예문 등록 실패");
    } finally {
      setBusy(null);
    }
  }

  const m = langMeta(lang);

  return (
    <Shell
      right={
        <input
          id="reviewer"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          placeholder="검수자 이름"
          style={{ ...inputStyle, width: 150 }}
        />
      }
    >
      {/* 필터 */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Tabs
          value={lang}
          onChange={(v) => setLang(v as TargetLang)}
          items={LANGS.map((l) => ({ value: l.id, label: l.name, badge: stats[l.id]?.pending ?? 0 }))}
        />
        <select
          id="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | "")}
          style={{ ...inputStyle, padding: "6px 8px" }}
        >
          <option value="">상태 전체</option>
          <option value="pending">검수 대기</option>
          <option value="corrected">수정됨</option>
          <option value="approved">승인</option>
        </select>
        <button
          onClick={() => setOnlyFlagged((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 6,
            fontSize: 12.5, fontWeight: 500, cursor: "pointer",
            background: onlyFlagged ? "var(--accent-soft)" : "transparent",
            border: `1px solid ${onlyFlagged ? "var(--accent)" : "var(--line2)"}`,
            color: onlyFlagged ? "var(--accent)" : "var(--muted)",
          }}
        >
          <i className="ph ph-funnel" style={{ fontSize: 13 }} />
          <span>검증기가 잡은 것만</span>
        </button>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 180,
            background: "var(--surface2)", border: "1px solid var(--line2)", borderRadius: 6, padding: "6px 10px",
          }}
        >
          <i className="ph ph-magnifying-glass" style={{ fontSize: 13, color: "var(--dim)" }} />
          <input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="원문·번역 검색"
            style={{ flex: 1, background: "transparent", border: 0, color: "var(--txt)", fontSize: 12.5, outline: "none" }}
          />
        </div>
      </div>

      {error && <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>}
      {message && <p style={{ color: "var(--accent)", fontSize: 13, margin: 0 }}>{message}</p>}
      {loading && <p style={{ color: "var(--dim)", fontSize: 13, margin: 0 }}>불러오는 중…</p>}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon="ph-seal-check"
          tone="ok"
          title="검수할 게 없습니다"
          body="이 언어의 대기 건을 모두 처리했습니다. 새 번역이 들어오면 여기에 쌓입니다."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 11, maxWidth: 1000 }}>
          {items.map((c) => {
            const blocked = c.issues.some((i) => i.severity === "block");
            const warned = !blocked && c.issues.length > 0;
            const strip = blocked ? "var(--bad)" : warned ? "var(--warn)" : "var(--ok)";
            const draft = drafts[c.id] ?? c.corrected ?? c.machine;
            const changed = draft.trim() !== (c.corrected ?? c.machine).trim();
            return (
              <div
                key={c.id}
                style={{
                  display: "grid", gridTemplateColumns: "3px minmax(0,1fr)",
                  background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden",
                }}
              >
                <div style={{ background: strip }} />
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em", padding: "2px 7px", borderRadius: 4,
                        background: blocked ? "rgba(226,101,95,.14)" : warned ? "rgba(226,162,71,.14)" : "rgba(87,201,139,.14)",
                        color: strip,
                      }}
                    >
                      {blocked ? "차단" : warned ? "경고" : "정상"}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{contextLabel(c.context)}</span>
                    <span style={{ fontSize: 12, color: "var(--dim)" }}>·</span>
                    <span
                      style={{
                        fontSize: 12,
                        color: c.status === "approved" ? "var(--ok)" : c.status === "corrected" ? "var(--accent)" : "var(--muted)",
                      }}
                    >
                      {STATUS_KO[c.status]}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--dim)" }}>·</span>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                      신뢰도 {c.confidence.toFixed(2)}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
                      {c.id.slice(0, 8)}
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr)", gap: "5px 12px", alignItems: "baseline" }}>
                    <span style={{ fontSize: 11.5, color: "var(--dim)" }}>원문</span>
                    <span style={{ fontSize: 14.5 }}>{c.source}</span>
                    <span style={{ fontSize: 11.5, color: "var(--dim)" }}>모델 번역</span>
                    <span lang={m.tag} style={{ fontSize: 14, color: "var(--muted)", fontFamily: m.font }}>{c.machine}</span>
                  </div>

                  {c.issues.map((i, k) => (
                    <div
                      key={k}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 8, borderRadius: 6, padding: "8px 10px",
                        background: i.severity === "block" ? "rgba(226,101,95,.10)" : "rgba(226,162,71,.10)",
                      }}
                    >
                      <i
                        className="ph ph-warning-circle"
                        style={{ fontSize: 14, marginTop: 2, color: i.severity === "block" ? "var(--bad)" : "var(--warn)" }}
                      />
                      <span style={{ fontSize: 12.5, color: "var(--txt)" }}>
                        <span style={{ color: "var(--muted)", letterSpacing: ".02em" }}>{i.code}</span> · {i.message}
                        {i.suggestion && <span style={{ color: "var(--dim)" }}> → {i.suggestion}</span>}
                      </span>
                    </div>
                  ))}

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: "var(--dim)" }}>고치기</span>
                    <textarea
                      id={`d-${c.id}`}
                      lang={m.tag}
                      value={draft}
                      spellCheck={false}
                      onChange={(e) => setDrafts((x) => ({ ...x, [c.id]: e.target.value }))}
                      style={{
                        minHeight: 96, resize: "vertical", background: "var(--surface2)",
                        border: `1px solid ${blocked ? "rgba(226,101,95,.45)" : "var(--line2)"}`,
                        borderRadius: 6, color: "var(--txt)", fontSize: 16, lineHeight: 1.6,
                        padding: "11px 12px", fontFamily: m.font, outline: "none",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      onClick={() => act(c, "correct")}
                      disabled={busy === c.id || !changed}
                      style={{ ...btnPrimary, opacity: busy === c.id || !changed ? 0.3 : 1 }}
                    >
                      {busy === c.id ? "처리 중…" : "수정 저장"}
                    </button>
                    {c.status === "pending" ? (
                      <button onClick={() => act(c, "approve")} disabled={busy === c.id} style={btnGhost}>
                        이대로 승인
                      </button>
                    ) : (
                      <button onClick={() => act(c, "reopen")} disabled={busy === c.id} style={{ ...btnGhost, color: "var(--muted)" }}>
                        검수 취소
                      </button>
                    )}
                    {c.status === "corrected" && (
                      <button
                        onClick={() => promote(c)}
                        disabled={busy === c.id}
                        style={{
                          marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
                          padding: "7px 13px", borderRadius: 6, border: "1px dashed var(--line2)",
                          background: "transparent", color: "var(--muted)", fontSize: 12.5, fontWeight: 500, cursor: "pointer",
                        }}
                      >
                        <i className="ph ph-bookmark-simple" style={{ fontSize: 13 }} />
                        이 수정을 예문으로
                      </button>
                    )}
                    {c.reviewedBy && (
                      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--dim)" }}>
                        {c.reviewedBy}
                        {c.reviewedAt ? ` · ${new Date(c.reviewedAt).toLocaleDateString("ko-KR")}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
