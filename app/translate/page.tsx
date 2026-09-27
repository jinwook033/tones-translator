// 2 · 번역 — 한국어 원고 → 4개 언어
"use client";

import { useState } from "react";
import { Shell, Panel, EmptyState, btnPrimary, inputStyle } from "../_ui/Shell";
import { LANGS, CONTEXTS, langMeta } from "../_ui/lang";
import type { TargetLang } from "@/lib/translator/types";

interface Unit {
  text: string;
  confidence: number;
  validation?: { passed: boolean; issues: { severity: string; code: string; message: string }[] };
  reviewed?: "approved" | "corrected";
}

interface Result {
  translations: Partial<Record<TargetLang, Unit>>;
  glossaryApplied: string[];
  usage?: { inputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; outputTokens: number };
}

export default function TranslatePage() {
  const [text, setText] = useState("");
  const [targets, setTargets] = useState<Record<string, boolean>>({ ja: true, cn: true, tw: true, en: true });
  const [context, setContext] = useState<string>("treatment_name");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const chosen = LANGS.filter((l) => targets[l.id]);

  async function run() {
    if (!text.trim() || chosen.length === 0) return;
    setLoading(true); setError(""); setResult(null); setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    try {
      const res = await fetch("/api/translator/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targets: chosen.map((l) => l.id), context }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "번역 실패");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "번역 실패");
    } finally {
      clearInterval(tick);
      setLoading(false);
    }
  }

  return (
    <Shell>
      {/* 설정 줄 */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
          background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "11px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: "var(--dim)" }}>대상 언어</span>
          <div style={{ display: "flex", gap: 5 }}>
            {LANGS.map((l) => {
              const on = targets[l.id];
              return (
                <button
                  key={l.id}
                  onClick={() => setTargets((t) => ({ ...t, [l.id]: !t[l.id] }))}
                  style={{
                    padding: "5px 11px", borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: "pointer",
                    background: on ? "var(--accent-soft)" : "transparent",
                    border: `1px solid ${on ? "var(--accent)" : "var(--line2)"}`,
                    color: on ? "var(--accent)" : "var(--muted)",
                  }}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: "var(--dim)" }}>문맥</span>
          <select
            id="ctx"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            style={{ ...inputStyle, padding: "5px 8px" }}
          >
            {CONTEXTS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,420px) minmax(0,1fr)", gap: 18, alignItems: "start" }}>
        {/* 입력 */}
        <Panel style={{ padding: 14, gap: 10 }}>
          <span style={{ fontSize: 11.5, letterSpacing: ".05em", color: "var(--dim)" }}>한국어 원고</span>
          <textarea
            id="src"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="번역할 원고를 넣으세요"
            style={{
              minHeight: 160, resize: "vertical", background: "var(--surface2)",
              border: "1px solid var(--line2)", borderRadius: 6, color: "var(--txt)",
              fontSize: 15, lineHeight: 1.6, padding: "11px 12px", outline: "none",
            }}
          />
          {result && result.glossaryApplied.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11.5, color: "var(--dim)" }}>고정된 용어</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {result.glossaryApplied.map((g) => (
                  <span
                    key={g}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, fontSize: 12, padding: "3px 9px",
                      borderRadius: 99, background: "var(--accent-soft)",
                      border: "1px solid rgba(196,242,77,.28)", color: "var(--txt)",
                    }}
                  >
                    <i className="ph ph-push-pin" style={{ fontSize: 11, color: "var(--accent)" }} />
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={run}
            disabled={loading || !text.trim() || chosen.length === 0}
            style={{ ...btnPrimary, padding: 9, fontSize: 13, opacity: loading || !text.trim() ? 0.4 : 1 }}
          >
            {loading ? `번역 중… ${elapsed}초` : "번역 실행"}
          </button>
          {error && <p style={{ color: "var(--bad)", fontSize: 12.5, margin: 0 }}>{error}</p>}
          {result?.usage && (
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
              입력 {result.usage.inputTokens} · 캐시 {result.usage.cacheReadTokens || result.usage.cacheWriteTokens} · 출력 {result.usage.outputTokens}
            </p>
          )}
        </Panel>

        {/* 결과 */}
        {!result ? (
          <EmptyState
            icon="ph-translate"
            title="번역 결과가 아직 없습니다"
            body="왼쪽에 원고를 넣고 번역을 실행하세요."
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
            {chosen.map((l) => {
              const u = result.translations[l.id];
              if (!u) return null;
              const blocked = u.validation && !u.validation.passed;
              const warned = u.validation?.issues.length ? !blocked : false;
              const m = langMeta(l.id);
              const conf = u.confidence;
              return (
                <div
                  key={l.id}
                  style={{
                    background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8,
                    padding: 15, display: "flex", flexDirection: "column", gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{l.name}</span>
                    <div style={{ display: "flex", gap: 5 }}>
                      {u.reviewed && (
                        <Badge label={u.reviewed === "corrected" ? "검수본" : "승인본"} color="var(--accent)" bg="var(--accent-soft)" />
                      )}
                      <Badge
                        label={blocked ? "차단" : warned ? "경고" : "통과"}
                        color={blocked ? "var(--bad)" : warned ? "var(--warn)" : "var(--ok)"}
                        bg={blocked ? "rgba(226,101,95,.14)" : warned ? "rgba(226,162,71,.14)" : "rgba(87,201,139,.14)"}
                      />
                    </div>
                  </div>

                  <p
                    lang={m.tag}
                    style={{ margin: 0, fontSize: 17, lineHeight: 1.5, fontFamily: m.font, textWrap: "pretty" }}
                  >
                    {u.text}
                  </p>

                  {u.validation?.issues.map((i, k) => (
                    <div
                      key={k}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        background: i.severity === "block" ? "rgba(226,101,95,.10)" : "rgba(226,162,71,.10)",
                        borderRadius: 6, padding: "7px 9px",
                      }}
                    >
                      <i
                        className="ph ph-warning-circle"
                        style={{ fontSize: 13, marginTop: 2, color: i.severity === "block" ? "var(--bad)" : "var(--warn)" }}
                      />
                      <span style={{ fontSize: 12, color: "var(--txt)" }}>
                        <span style={{ color: "var(--muted)" }}>{i.code}</span> · {i.message}
                      </span>
                    </div>
                  ))}

                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: "auto" }}>
                    <div style={{ flex: 1, height: 4, borderRadius: 99, background: "var(--raise)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%", borderRadius: 99, width: `${Math.round(conf * 100)}%`,
                          background: conf >= 0.9 ? "var(--ok)" : conf >= 0.8 ? "var(--warn)" : "var(--bad)",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
                      {conf.toFixed(2)}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(u.text);
                        setCopied(l.id);
                        setTimeout(() => setCopied(null), 1200);
                      }}
                      title="복사"
                      style={{
                        width: 26, height: 26, display: "grid", placeItems: "center", borderRadius: 5,
                        border: "1px solid var(--line2)", background: "transparent",
                        color: copied === l.id ? "var(--accent)" : "var(--muted)", cursor: "pointer",
                      }}
                    >
                      <i className={`ph ${copied === l.id ? "ph-check" : "ph-copy"}`} style={{ fontSize: 13 }} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span
      style={{
        fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em",
        padding: "2px 7px", borderRadius: 4, background: bg, color,
      }}
    >
      {label}
    </span>
  );
}
