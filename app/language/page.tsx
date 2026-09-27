// 6 · 언어 설정 — 문체 규칙 · 금지표현 · 대조 예문
"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell, Tabs, btnPrimary, btnGhost, inputStyle } from "../_ui/Shell";
import { LANGS, langMeta } from "../_ui/lang";
import type { TargetLang } from "@/lib/translator/types";

interface Example { source: string; bad: string; good: string; reason: string }

interface Profile {
  lang: TargetLang;
  label: string;
  region: string;
  rules: string;
  antiPatterns: string[];
  examples: Example[];
  updatedAt?: string;
  updatedBy?: string;
  customized?: boolean;
}

export default function LanguagePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [lang, setLang] = useState<TargetLang>("ja");
  const [draft, setDraft] = useState<Profile | null>(null);
  const [newBanned, setNewBanned] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/translator/language");
      if (!res.ok) throw new Error("설정을 불러오지 못했습니다");
      const d = await res.json();
      setProfiles(d.profiles || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const p = profiles.find((x) => x.lang === lang);
    if (p) setDraft(JSON.parse(JSON.stringify(p)));
  }, [lang, profiles]);

  const orig = profiles.find((x) => x.lang === lang);
  const dirty = !!orig && !!draft &&
    JSON.stringify([orig.rules, orig.antiPatterns, orig.examples, orig.updatedBy ?? ""]) !==
    JSON.stringify([draft.rules, draft.antiPatterns, draft.examples, draft.updatedBy ?? ""]);

  function patch(p: Partial<Profile>) { setDraft((d) => (d ? { ...d, ...p } : d)); }

  async function save() {
    if (!draft) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/translator/language", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lang: draft.lang, label: draft.label, region: draft.region, rules: draft.rules,
          antiPatterns: draft.antiPatterns, examples: draft.examples, updatedBy: draft.updatedBy || "",
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "저장 실패");
      const dropped = (d.dropped?.examples || 0) + (d.dropped?.antiPatterns || 0);
      setMessage(dropped > 0 ? `저장했습니다. 빈 항목 ${dropped}개는 제외했습니다.` : "저장했습니다. 다음 번역부터 반영됩니다.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!draft) return;
    if (!confirm(`${langMeta(draft.lang).name} 설정을 코드 기본값으로 되돌립니다. 화면에서 고친 내용은 사라집니다.`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const res = await fetch(`/api/translator/language?lang=${draft.lang}`, { method: "DELETE" });
      if (!res.ok) throw new Error("되돌리기 실패");
      setMessage("기본값으로 되돌렸습니다.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "되돌리기 실패");
    } finally {
      setSaving(false);
    }
  }

  const m = langMeta(lang);
  const textarea: React.CSSProperties = {
    resize: "vertical", background: "var(--surface2)", border: "1px solid var(--line2)",
    borderRadius: 6, color: "var(--txt)", padding: 12, outline: "none",
  };

  return (
    <Shell
      right={
        <>
          {draft?.customized && (
            <button onClick={reset} disabled={saving} style={btnGhost}>기본값으로</button>
          )}
          <button onClick={save} disabled={saving || !dirty} style={{ ...btnPrimary, opacity: saving || !dirty ? 0.3 : 1 }}>
            {saving ? "저장 중…" : dirty ? "저장" : "변경 없음"}
          </button>
        </>
      }
    >
      <Tabs
        value={lang}
        onChange={(v) => setLang(v as TargetLang)}
        items={LANGS.map((l) => {
          const p = profiles.find((x) => x.lang === l.id);
          return { value: l.id, label: l.name, badge: p?.customized ? "수정됨" : "" };
        })}
      />

      {error && <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>}
      {message && <p style={{ color: "var(--accent)", fontSize: 13, margin: 0 }}>{message}</p>}
      {loading && <p style={{ color: "var(--dim)", fontSize: 13, margin: 0 }}>불러오는 중…</p>}

      {draft && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 960 }}>
          {/* 문체 규칙 */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>문체·표기 규칙</span>
              <span style={{ fontSize: 11.5, color: "var(--dim)" }}>{draft.label} 프롬프트에 그대로 들어갑니다</span>
            </div>
            <textarea
              id="rules"
              value={draft.rules}
              onChange={(e) => patch({ rules: e.target.value })}
              spellCheck={false}
              style={{ ...textarea, minHeight: 160, fontSize: 14, lineHeight: 1.7 }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,340px) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
            {/* 금지 표현 */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>절대 나오면 안 되는 표현</span>
                <span style={{ fontSize: 11.5, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
                  {draft.antiPatterns.length}개
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {draft.antiPatterns.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderTop: "1px solid var(--line)" }}>
                    <input
                      id={`ap-${i}`}
                      lang={m.tag}
                      value={a}
                      spellCheck={false}
                      onChange={(e) => {
                        const next = [...draft.antiPatterns]; next[i] = e.target.value; patch({ antiPatterns: next });
                      }}
                      style={{ flex: 1, background: "transparent", border: 0, color: "var(--txt)", fontSize: 13, fontFamily: m.font, outline: "none", minWidth: 0 }}
                    />
                    <button
                      onClick={() => patch({ antiPatterns: draft.antiPatterns.filter((_, j) => j !== i) })}
                      style={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 4, border: 0, background: "transparent", color: "var(--dim)", cursor: "pointer" }}
                    >
                      <i className="ph ph-x" style={{ fontSize: 12 }} />
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, paddingTop: 4 }}>
                <input
                  id="new-ap"
                  value={newBanned}
                  onChange={(e) => setNewBanned(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newBanned.trim()) {
                      patch({ antiPatterns: [...draft.antiPatterns, newBanned.trim()] }); setNewBanned("");
                    }
                  }}
                  placeholder="표현 추가"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={() => { if (newBanned.trim()) { patch({ antiPatterns: [...draft.antiPatterns, newBanned.trim()] }); setNewBanned(""); } }}
                  style={btnGhost}
                >
                  추가
                </button>
              </div>
            </div>

            {/* 대조 예문 */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>대조 예문</span>
                <span style={{ fontSize: 11.5, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
                  {draft.examples.length}개
                </span>
              </div>
              {draft.examples.map((ex, i) => (
                <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 7, padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => patch({ examples: draft.examples.filter((_, j) => j !== i) })}
                      style={{ fontSize: 11, color: "var(--dim)", background: "transparent", border: 0, cursor: "pointer" }}
                    >
                      삭제
                    </button>
                  </div>
                  {([
                    ["source", draft.lang === "ko" ? "원문 (영어)" : "원문 (한국어)", "var(--dim)", false],
                    ["bad", "이렇게 나오면 안 됨", "var(--bad)", true],
                    ["good", "이렇게 나와야 함", "var(--ok)", true],
                    ["reason", "이유", "var(--dim)", false],
                  ] as [keyof Example, string, string, boolean][]).map(([field, label, color, target]) => (
                    <div key={field} style={{ display: "grid", gridTemplateColumns: "118px minmax(0,1fr)", gap: 10, alignItems: "baseline" }}>
                      <span style={{ fontSize: 11.5, color }}>{label}</span>
                      <textarea
                        id={`ex-${i}-${field}`}
                        lang={target ? m.tag : "ko"}
                        value={ex[field]}
                        rows={field === "reason" ? 2 : 1}
                        spellCheck={false}
                        onChange={(e) => {
                          const next = [...draft.examples];
                          next[i] = { ...next[i], [field]: e.target.value };
                          patch({ examples: next });
                        }}
                        style={{ ...textarea, padding: "7px 9px", fontSize: 13, fontFamily: target ? m.font : "var(--fnt)" }}
                      />
                    </div>
                  ))}
                </div>
              ))}
              <button
                onClick={() => patch({ examples: [...draft.examples, { source: "", bad: "", good: "", reason: "" }] })}
                style={{ padding: 8, borderRadius: 6, border: "1px dashed var(--line2)", background: "transparent", color: "var(--muted)", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
              >
                예문 추가
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              id="by"
              value={draft.updatedBy || ""}
              onChange={(e) => patch({ updatedBy: e.target.value })}
              placeholder="검수자 (예: 일본어 검수 사토)"
              style={{ ...inputStyle, width: 260 }}
            />
            {draft.updatedAt && (
              <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
                마지막 수정 {new Date(draft.updatedAt).toLocaleString("ko-KR")}
              </span>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
