// 번역기 페이지 — Apple-style dark minimal 디자인
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTenantConfig } from "@/lib/use-tenant";
import Link from "next/link";

type TargetLang = "en" | "cn" | "sg" | "ja" | "ko";
type TranslationContext = "treatment_name" | "description" | "category" | "general" | "legal";

interface TranslationUnit {
  text: string;
  confidence: number;
  ambiguities?: { text: string; explanation: string; recommended: boolean }[];
}

interface TranslateResponse {
  translations: Partial<Record<TargetLang, TranslationUnit>>;
  glossaryApplied: string[];
  cached: boolean;
  unregisteredTerms?: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

const LANGS: Record<string, { label: string; flag: string; short: string; color: string }> = {
  en: { label: "English", flag: "🇺🇸", short: "EN", color: "#0A84FF" },
  cn: { label: "简体中文", flag: "🇨🇳", short: "CN", color: "#FF453A" },
  sg: { label: "繁體中文", flag: "🇹🇼", short: "TW", color: "#30D158" },
  ja: { label: "日本語", flag: "🇯🇵", short: "JA", color: "#BF5AF2" },
  ko: { label: "한국어", flag: "🇰🇷", short: "KO", color: "#FF9F0A" },
};

export default function TranslatorPage() {
  const { config: tenantConfig } = useTenantConfig();
  const [text, setText] = useState("");
  const context: TranslationContext = "general";
  const [targets, setTargets] = useState<Set<TargetLang>>(new Set(["en", "cn", "sg", "ja"]));
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);
  const [error, setError] = useState("");
  const [copyLang, setCopyLang] = useState<string | null>(null);
  const [copyAll, setCopyAll] = useState(false);
  const loadingTimer = useRef<NodeJS.Timeout | null>(null);
  const translateAbort = useRef<AbortController | null>(null);
  const [excelFiles, setExcelFiles] = useState<File[]>([]);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelProgress, setExcelProgress] = useState("");
  const [excelCurrent, setExcelCurrent] = useState(0);
  const [excelTotal, setExcelTotal] = useState(0);
  const [excelResults, setExcelResults] = useState<{ lang: string; fileName: string; base64: string }[]>([]);
  const [excelTokens, setExcelTokens] = useState<{ input: number; output: number; cost: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"text" | "excel" | "glossary">("text");
  const model = "sonnet";
  const [unknownTerms, setUnknownTerms] = useState<string[]>([]);
  const [showUnknownModal, setShowUnknownModal] = useState(false);
  // New UX features
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<{ text: string; time: string }[]>([]);
  const [realtimeOn, setRealtimeOn] = useState(false);
  const [showRealtimeModal, setShowRealtimeModal] = useState(false);
  const [reversed, setReversed] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load history from localStorage
  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem("translateHistory") || "[]")); } catch { /* */ }
  }, []);

  const saveHistory = (t: string) => {
    const h = [{ text: t.slice(0, 50), time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) }, ...history].slice(0, 20);
    setHistory(h);
    localStorage.setItem("translateHistory", JSON.stringify(h));
  };

  const toggleTarget = (lang: TargetLang) => {
    setTargets((prev) => { const next = new Set(prev); if (next.has(lang)) next.delete(lang); else next.add(lang); return next; });
  };

  // ─── Text Translate ───
  const handleTranslate = useCallback(async () => {
    if (!text.trim() || targets.size === 0) return;
    translateAbort.current?.abort();
    translateAbort.current = new AbortController();
    setLoading(true); setError(""); setResult(null); setLoadingTime(0);
    loadingTimer.current = setInterval(() => setLoadingTime(t => t + 1), 1000);
    try {
      const res = await fetch("/api/translator/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), targets: activeTargets, context, model }),
        signal: translateAbort.current.signal,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
      saveHistory(text.trim());
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "번역 실패");
    }
    finally { setLoading(false); if (loadingTimer.current) clearInterval(loadingTimer.current); }
    // 2026-05-19 fix: reversed가 deps에 빠져 방향 토글 후 첫 호출이 stale activeTargets 사용하던 버그
  }, [text, targets, reversed]);

  // Realtime debounce
  useEffect(() => {
    if (!realtimeOn || !text.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleTranslate(), 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [text, realtimeOn]);

  // ─── Excel Check ───
  const handleExcelCheck = useCallback(async () => {
    if (excelFiles.length === 0 || targets.size === 0) return;
    setExcelLoading(true); setExcelProgress("파싱 및 미등록 용어 확인 중..."); setExcelResults([]);
    setExcelCurrent(0); setExcelTotal(0); setExcelTokens(null); setUnknownTerms([]);
    try {
      const formData = new FormData();
      formData.append("file", excelFiles[0]);
      formData.append("targets", [...targets].join(","));
      formData.append("model", model);
      formData.append("checkOnly", "true");
      const res = await fetch("/api/translator/translate-excel-stream", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const reader = res.body?.getReader();
      if (!reader) throw new Error("스트림 읽기 실패");
      const decoder = new TextDecoder();
      let buf = "";
      let hasUnknown = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const match = line.match(/^data: (.+)$/m);
          if (!match) continue;
          try {
            const evt = JSON.parse(match[1]);
            if (evt.type === "unregistered" && evt.terms?.length > 0) {
              setUnknownTerms(evt.terms); setShowUnknownModal(true); hasUnknown = true;
            } else if (evt.type === "status") { setExcelProgress(evt.message); }
          } catch { /* */ }
        }
      }
      if (!hasUnknown) await runExcelTranslate();
      else { setExcelProgress("미등록 용어를 확인해주세요."); setExcelLoading(false); }
    } catch (e) { setExcelProgress(`오류: ${e instanceof Error ? e.message : "실패"}`); setExcelLoading(false); }
  }, [excelFiles, targets, model]);

  // ─── Excel Translate ───
  const runExcelTranslate = useCallback(async () => {
    setExcelLoading(true); setExcelProgress("번역 시작..."); setExcelCurrent(0); setExcelTotal(0); setExcelTokens(null);
    try {
      const allResults: { lang: string; fileName: string; base64: string }[] = [];
      for (let i = 0; i < excelFiles.length; i++) {
        setExcelProgress(`${excelFiles[i].name} 번역 중... (${i + 1}/${excelFiles.length})`);
        const formData = new FormData();
        formData.append("file", excelFiles[i]);
        formData.append("targets", [...targets].join(","));
        formData.append("model", model);
        const res = await fetch("/api/translator/translate-excel-stream", { method: "POST", body: formData });
        if (!res.ok) throw new Error(`${excelFiles[i].name}: ${await res.text()}`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error("스트림 읽기 실패");
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            const match = line.match(/^data: (.+)$/m);
            if (!match) continue;
            try {
              const evt = JSON.parse(match[1]);
              if (evt.type === "progress") { setExcelCurrent(evt.current); setExcelTotal(evt.total); setExcelProgress(evt.message); if (evt.tokens) setExcelTokens(evt.tokens); }
              else if (evt.type === "status") { setExcelProgress(evt.message); }
              else if (evt.type === "complete") { allResults.push(...(evt.files || [])); }
              else if (evt.type === "error") { throw new Error(evt.message); }
            } catch { /* */ }
          }
        }
      }
      setExcelResults(allResults);
      setExcelProgress(`완료! ${allResults.length}개 파일 생성됨`);
    } catch (e) { setExcelProgress(`오류: ${e instanceof Error ? e.message : "실패"}`); }
    finally { setExcelLoading(false); }
  }, [excelFiles, targets, model]);

  const downloadFile = (b64: string, fileName: string) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
  };

  const handleSwap = () => {
    const firstResult = result?.translations?.en?.text || result?.translations?.cn?.text || result?.translations?.sg?.text || result?.translations?.ja?.text || result?.translations?.ko?.text;
    if (firstResult && text) {
      setText(firstResult);
    }
    setReversed(!reversed);
    setResult(null);
  };

  // 현재 번역 대상 언어 (reversed면 ko, 아니면 선택된 외국어)
  const activeTargets = reversed ? ["ko" as TargetLang] : [...targets];

  // ─── RENDER ───
  const s = { // style tokens
    bg: "#0D0D0D", card: "#1A1A1A", card2: "#252525", border: "rgba(255,255,255,0.08)",
    t1: "#f5f5f7", t2: "#888", t3: "#595959", t4: "#3a3a3a",
    accent: "#D8F213", accentBg: "rgba(216,242,19,0.1)",
  };

  return (
    <div className="min-h-screen" style={{ background: s.bg }}>
      {/* ─── Nav ─── */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: "rgba(13,13,13,0.8)", backdropFilter: "saturate(180%) blur(20px)", borderColor: s.border }}>
        <div className="max-w-[980px] mx-auto px-5 h-[52px] flex items-center justify-between">
          <span className="text-[21px] font-semibold tracking-tight" style={{ color: s.t1 }}>Translator</span>
          <div className="flex gap-8">
            {(["text", "excel", "glossary"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`text-[14px] font-medium py-4 relative transition-colors cursor-pointer ${tab === t ? "" : "hover:opacity-80"}`}
                style={{ color: tab === t ? s.t1 : s.t3 }}>
                {t === "text" ? "Text" : t === "excel" ? "Excel" : "Glossary"}
                {tab === t && <span className="absolute bottom-0 left-0 right-0 h-[1.5px]" style={{ background: s.t1 }} />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs" style={{ color: s.t3 }}>Sonnet</span>
            <button onClick={() => setShowHistory(!showHistory)}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer"
              style={{ color: showHistory ? s.accent : s.t2 }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </button>
            <Link href="/" className="text-xs transition-colors hover:opacity-80" style={{ color: s.t3 }}>← 대시보드</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-[980px] mx-auto px-5 pt-7 pb-16 flex gap-0">
        <div className="flex-1 min-w-0">

          {/* ═══ TEXT TAB ═══ */}
          {tab === "text" && (
            <>
              {/* Language header with swap */}
              <div className="flex items-center gap-3 mb-3">
                <span className="flex-1 text-[14px] font-medium" style={{ color: s.t2 }}>{reversed ? "Foreign Language" : "Korean"}</span>
                <button onClick={handleSwap} className="w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer" style={{ background: s.card, border: `1px solid ${s.border}`, color: s.t2 }}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/></svg>
                </button>
                <span className="flex-1 text-[14px] font-medium text-right" style={{ color: s.t2 }}>{reversed ? "Korean" : "Translation"}</span>
              </div>

              {/* Two-panel workspace */}
              <div className="grid grid-cols-1 sm:grid-cols-2 overflow-hidden" style={{ borderRadius: 18, border: `0.5px solid ${s.border}`, background: s.border }}>
                {/* Input panel */}
                <div style={{ background: s.card }}>
                  <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `0.5px solid ${s.border}` }}>
                    <span className="text-[13px] font-medium" style={{ color: s.t2 }}>입력</span>
                    <span className="text-[12px] tabular-nums" style={{ color: s.t3 }}>{text.length}자</span>
                  </div>
                  <textarea value={text} onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleTranslate(); } }}
                    placeholder="번역할 텍스트를 입력하세요"
                    className="w-full min-h-[240px] px-6 py-5 bg-transparent border-none outline-none resize-none text-[17px] leading-relaxed placeholder:opacity-30"
                    style={{ color: s.t1, fontFamily: "inherit" }} />
                  {/* Language pills */}
                  <div className="px-6 py-3 flex gap-2" style={{ borderTop: `0.5px solid ${s.border}` }}>
                    {(Object.keys(LANGS) as TargetLang[]).map(lang => (
                      <button key={lang} onClick={() => toggleTarget(lang)}
                        className="px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer"
                        style={targets.has(lang) ? { background: s.t1, color: s.bg, border: `1px solid ${s.t1}` } : { background: "transparent", color: s.t2, border: `1px solid ${s.t4}` }}>
                        {LANGS[lang].short}
                      </button>
                    ))}
                  </div>
                  {/* Realtime + Translate */}
                  <div className="px-6 py-3 flex items-center justify-between" style={{ borderTop: `0.5px solid ${s.border}`, background: "rgba(0,0,0,0.2)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-[5px] h-[5px] rounded-full transition-all" style={{ background: realtimeOn ? s.accent : s.t4, boxShadow: realtimeOn ? `0 0 6px ${s.accent}` : "none" }} />
                      <span className="text-[12px]" style={{ color: s.t3 }}>Live</span>
                      <button onClick={() => realtimeOn ? setRealtimeOn(false) : setShowRealtimeModal(true)}
                        className="w-9 h-[22px] rounded-full relative cursor-pointer transition-colors"
                        style={{ background: realtimeOn ? s.accent : s.t4 }}>
                        <span className="absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform" style={{ transform: realtimeOn ? "translateX(14px)" : "translateX(0)" }} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] flex items-center gap-1" style={{ color: s.t3 }}>
                        <kbd className="px-1 py-px text-[10px] rounded" style={{ background: s.card2, border: `0.5px solid ${s.border}`, color: s.t2 }}>⌘</kbd>
                        <kbd className="px-1 py-px text-[10px] rounded" style={{ background: s.card2, border: `0.5px solid ${s.border}`, color: s.t2 }}>↵</kbd>
                      </span>
                      <button onClick={handleTranslate} disabled={loading || !text.trim() || targets.size === 0}
                        className="px-6 py-2 rounded-full text-[14px] font-semibold transition-opacity cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ background: s.accent, color: s.bg }}>
                        {loading ? "번역 중..." : "Translate"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Result panel */}
                <div style={{ background: s.card }}>
                  <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `0.5px solid ${s.border}` }}>
                    <span className="text-[13px] font-medium" style={{ color: s.t2 }}>결과</span>
                    {result && <span className="text-[11px]" style={{ color: s.t4 }}>4 languages</span>}
                  </div>
                  <div className="min-h-[240px] flex flex-col">
                    {/* Warning banner */}
                    {(() => { const u = result?.unregisteredTerms ?? []; if (!u.length) return null;
                      return (
                        <div className="mx-6 mt-4 p-3 rounded-[10px]" style={{ background: "rgba(255,159,10,0.06)", border: "0.5px solid rgba(255,159,10,0.15)" }}>
                          <div className="text-[13px] font-semibold mb-1.5" style={{ color: "#FF9F0A" }}>⚠ 미등록 용어 {u.length}개</div>
                          <div className="flex flex-wrap gap-1 mb-2">{u.map(t => <span key={t} className="text-[11px] px-2 py-0.5 rounded" style={{ background: "rgba(255,159,10,0.12)", color: "#FF9F0A" }}>{t}</span>)}</div>
                          <Link href="/translator/glossary" className="text-[12px] underline" style={{ color: s.accent }}>용어집에 추가 →</Link>
                        </div>);
                    })()}

                    {error && <div className="mx-6 mt-4 p-3 rounded-[10px] text-xs" style={{ background: "rgba(255,69,58,0.08)", color: "#FF453A" }}>{error}</div>}

                    {!result && !loading && !error && (
                      <div className="flex-1 flex items-center justify-center text-[15px]" style={{ color: s.t4 }}>번역 결과가 여기에 표시됩니다</div>
                    )}

                    {loading && (
                      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10">
                        <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: s.t4, borderTopColor: s.t1 }} />
                        <span className="text-[13px]" style={{ color: s.t3 }}>번역 중... {loadingTime}초</span>
                      </div>
                    )}

                    {result && (Object.keys(LANGS) as TargetLang[]).map(lang => {
                      const unit = result.translations[lang];
                      if (!unit) return null;
                      const info = LANGS[lang];
                      return (
                        <div key={lang} className="px-6 py-5 transition-colors cursor-pointer group" style={{ borderBottom: `0.5px solid ${s.border}` }}
                          onClick={() => { navigator.clipboard.writeText(unit.text); setCopyLang(lang); setTimeout(() => setCopyLang(null), 1200); }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[12px] font-semibold flex items-center gap-2" style={{ color: s.t2 }}>
                              <span className="w-[3px] h-[12px] rounded-sm" style={{ background: info.color }} />
                              {info.flag} {info.label}
                              <span className="text-[11px] font-medium tabular-nums" style={{ color: s.t3 }}>{Math.round(unit.confidence * 100)}%</span>
                            </span>
                            <button className="text-[11px] px-2.5 py-0.5 rounded transition-all opacity-0 group-hover:opacity-100"
                              style={copyLang === lang ? { background: "#30D158", color: "white" } : { border: `0.5px solid ${s.border}`, color: s.t3 }}>
                              {copyLang === lang ? "✓" : "Copy"}
                            </button>
                          </div>
                          <div className="text-[17px] leading-relaxed" style={{ color: s.t1 }}>{unit.text}</div>
                          {unit.ambiguities && unit.ambiguities.length > 0 && (
                            <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: "rgba(255,159,10,0.06)" }}>
                              <div className="font-semibold mb-1" style={{ color: "#FF9F0A" }}>대안 번역</div>
                              {unit.ambiguities.map((a, i) => (
                                <div key={i} className="mb-1">
                                  <span style={{ color: a.recommended ? s.accent : s.t2, fontWeight: a.recommended ? 600 : 400 }}>{a.recommended ? "⭐ " : "• "}{a.text}</span>
                                  <span className="ml-2" style={{ color: s.t4 }}>— {a.explanation}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {result && Object.keys(result.translations).length > 0 && (
                      <div className="px-6 py-3 flex gap-2" style={{ borderTop: `0.5px solid ${s.border}` }}>
                        <button onClick={() => {
                          const lines = Object.entries(result.translations).map(([l, u]) => u ? `[${LANGS[l as TargetLang]?.label || l}] ${u.text}` : "").filter(Boolean);
                          navigator.clipboard.writeText(lines.join("\n"));
                          setCopyAll(true); setTimeout(() => setCopyAll(false), 1500);
                        }} className="flex-1 py-2 rounded-md text-[12px] font-medium transition-colors cursor-pointer" style={{ border: `0.5px solid ${s.border}`, color: copyAll ? "#30D158" : s.t3 }}>
                          {copyAll ? "✓ Copied" : "Copy All"}
                        </button>
                        <button onClick={() => {
                          const rows = [["언어", "번역", "신뢰도"]];
                          for (const [l, u] of Object.entries(result.translations)) { if (u) rows.push([LANGS[l as TargetLang]?.label || l, u.text, Math.round(u.confidence * 100) + "%"]); }
                          const csv = rows.map(r => r.join("\t")).join("\n");
                          const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
                          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `번역_${text.slice(0, 20)}.csv`; a.click();
                        }} className="flex-1 py-2 rounded-md text-[12px] font-medium transition-colors cursor-pointer" style={{ border: `0.5px solid ${s.border}`, color: s.t3 }}>
                          CSV
                        </button>
                      </div>
                    )}

                    {result && result.glossaryApplied.length > 0 && (
                      <div className="px-6 py-2.5" style={{ borderTop: `0.5px solid ${s.border}` }}>
                        <div className="text-[11px] mb-1" style={{ color: s.t4 }}>적용된 용어</div>
                        <div className="flex flex-wrap gap-1">{result.glossaryApplied.map((g, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded" style={{ background: s.accentBg, color: s.accent }}>{g}</span>)}</div>
                      </div>
                    )}

                    {result?.usage && (
                      <div className="px-6 py-2.5 flex items-center gap-4" style={{ borderTop: `0.5px solid ${s.border}` }}>
                        <span className="text-[10px]" style={{ color: s.t4 }}>입력: {result.usage.inputTokens.toLocaleString()} 토큰</span>
                        <span className="text-[10px]" style={{ color: s.t4 }}>출력: {result.usage.outputTokens.toLocaleString()} 토큰</span>
                        <span className="text-[10px] font-semibold" style={{ color: "#FF9F0A" }}>
                          ${((result.usage.inputTokens * 3 + result.usage.outputTokens * 15) / 1000000).toFixed(4)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ EXCEL TAB ═══ */}
          {tab === "excel" && (
            <div className="overflow-hidden" style={{ borderRadius: 18, border: `0.5px solid ${s.border}`, background: s.card }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `0.5px solid ${s.border}` }}>
                <span className="text-[13px] font-medium" style={{ color: s.t2 }}>엑셀 번역</span>
              </div>
              {/* Dropzone */}
              <div onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = s.accent; e.currentTarget.style.background = s.accentBg; }}
                onDragLeave={(e) => { e.currentTarget.style.borderColor = s.t4; e.currentTarget.style.background = "transparent"; }}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = s.t4; e.currentTarget.style.background = "transparent"; const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith(".xlsx")); if (files.length > 0) setExcelFiles(prev => [...prev, ...files]); }}
                className="m-6 p-14 text-center cursor-pointer transition-all" style={{ border: `1.5px dashed ${s.t4}`, borderRadius: 14 }}>
                <div className="text-[32px] mb-3 opacity-30">↕</div>
                <div className="text-[15px]" style={{ color: s.t2 }}>엑셀 파일을 드래그하세요</div>
                <div className="text-[12px] mt-1" style={{ color: s.t4 }}>또는 클릭하여 선택 (.xlsx)</div>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length > 0) setExcelFiles(prev => [...prev, ...files]); }} />
              {excelFiles.length > 0 && excelFiles.map((f, i) => (
                <div key={i} className="mx-6 mb-2 px-4 py-3 rounded-[10px] flex items-center justify-between" style={{ background: s.card2 }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📊</span>
                    <div><div className="text-[13px] font-medium" style={{ color: s.t1 }}>{f.name}</div><div className="text-[11px]" style={{ color: s.t3 }}>{(f.size / 1024).toFixed(1)} KB</div></div>
                  </div>
                  <button onClick={() => setExcelFiles(prev => prev.filter((_, j) => j !== i))} className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] cursor-pointer" style={{ background: s.t4, color: s.t2 }}>✕</button>
                </div>
              ))}
              <div className="px-6 py-3 flex gap-2" style={{ borderTop: `0.5px solid ${s.border}` }}>
                {(Object.keys(LANGS) as TargetLang[]).map(lang => (
                  <button key={lang} onClick={() => toggleTarget(lang)} className="px-3 py-1.5 rounded-full text-[13px] font-medium transition-all cursor-pointer"
                    style={targets.has(lang) ? { background: s.t1, color: s.bg, border: `1px solid ${s.t1}` } : { background: "transparent", color: s.t2, border: `1px solid ${s.t4}` }}>
                    {LANGS[lang].short}
                  </button>
                ))}
              </div>
              <div className="px-6 py-3 flex justify-end" style={{ borderTop: `0.5px solid ${s.border}`, background: "rgba(0,0,0,0.2)" }}>
                <button onClick={handleExcelCheck} disabled={excelLoading || excelFiles.length === 0 || targets.size === 0}
                  className="px-6 py-2 rounded-full text-[14px] font-semibold transition-opacity cursor-pointer disabled:opacity-30"
                  style={{ background: s.accent, color: s.bg }}>{excelLoading ? "번역 중..." : "Start Translation"}</button>
              </div>
              {excelProgress && (
                <div className="mx-6 my-4 p-3 rounded-[10px] text-xs" style={{ background: "rgba(48,209,88,0.06)", color: "#30D158" }}>
                  <div className="flex justify-between mb-1"><span>{excelProgress}</span>{excelTotal > 0 && <span>{Math.round((excelCurrent / excelTotal) * 100)}%</span>}</div>
                  {excelTotal > 0 && <div className="w-full rounded-full h-1.5 mt-1" style={{ background: s.t4 }}><div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.round((excelCurrent / excelTotal) * 100)}%`, background: "#30D158" }} /></div>}
                  {excelTokens && <div className="flex gap-3 mt-2 text-[10px]" style={{ color: s.t3 }}><span>입력: {excelTokens.input.toLocaleString()}</span><span>출력: {excelTokens.output.toLocaleString()}</span><span style={{ color: "#FF9F0A", fontWeight: 600 }}>${excelTokens.cost}</span></div>}
                </div>
              )}
              {excelResults.length > 0 && (
                <div className="px-6 pb-4 grid grid-cols-2 gap-2">
                  {excelResults.map((r, i) => (
                    <button key={i} onClick={() => downloadFile(r.base64, r.fileName)} className="flex items-center gap-2 p-3 rounded-[10px] cursor-pointer text-left transition-colors" style={{ background: s.card2, border: `0.5px solid ${s.border}` }}>
                      <span>⬇️</span>
                      <div><div className="text-xs font-medium" style={{ color: s.t1 }}>{LANGS[r.lang as TargetLang]?.flag} {r.fileName}</div><div className="text-[10px]" style={{ color: s.t4 }}>다운로드</div></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ GLOSSARY TAB ═══ */}
          {tab === "glossary" && (
            <div className="overflow-hidden" style={{ borderRadius: 18, border: `0.5px solid ${s.border}`, background: s.card }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `0.5px solid ${s.border}` }}>
                <span className="text-[13px] font-medium" style={{ color: s.t2 }}>용어집</span>
                <Link href="/translator/glossary" className="px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer" style={{ background: s.accent, color: s.bg }}>관리 →</Link>
              </div>
              <GlossaryPreview s={s} />
            </div>
          )}
        </div>

        {/* ═══ History Sidebar ═══ */}
        {showHistory && (
          <div className="w-[260px] flex-shrink-0 ml-[-0.5px]" style={{ borderLeft: `0.5px solid ${s.border}`, background: s.card, borderRadius: "0 18px 18px 0" }}>
            <div className="px-5 py-4 flex items-center justify-between sticky top-0" style={{ borderBottom: `0.5px solid ${s.border}`, background: s.card }}>
              <span className="text-[13px] font-medium" style={{ color: s.t2 }}>History</span>
              <button onClick={() => { setHistory([]); localStorage.removeItem("translateHistory"); }} className="text-[11px] cursor-pointer" style={{ color: s.t3 }}>Clear</button>
            </div>
            {history.length === 0 ? <div className="p-10 text-center text-[13px]" style={{ color: s.t4 }}>기록 없음</div> :
              history.map((h, i) => (
                <div key={i} onClick={() => { setText(h.text); }} className="px-5 py-3 cursor-pointer transition-colors hover:opacity-80" style={{ borderBottom: `0.5px solid ${s.border}` }}>
                  <div className="text-[13px] truncate" style={{ color: s.t1 }}>{h.text}</div>
                  <div className="text-[11px]" style={{ color: s.t4 }}>{h.time}</div>
                </div>
              ))
            }
          </div>
        )}
      </div>

      {/* ═══ Realtime Confirm Modal ═══ */}
      {showRealtimeModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(12px)" }}>
          <div className="overflow-hidden w-[340px]" style={{ background: s.card, borderRadius: 14 }}>
            <div className="p-7 text-center">
              <div className="text-4xl mb-3">⚡</div>
              <div className="text-[17px] font-semibold mb-2">실시간 번역 활성화</div>
              <div className="text-[13px] leading-relaxed" style={{ color: s.t2 }}>텍스트 수정 시마다 API를 호출합니다.<br /><strong style={{ color: "#FF453A" }}>비용이 10배 이상 증가</strong>할 수 있습니다.</div>
            </div>
            <div className="flex" style={{ borderTop: `0.5px solid ${s.border}` }}>
              <button onClick={() => setShowRealtimeModal(false)} className="flex-1 py-3.5 text-[15px] cursor-pointer transition-colors" style={{ color: s.accent, borderRight: `0.5px solid ${s.border}` }}>취소</button>
              <button onClick={() => { setRealtimeOn(true); setShowRealtimeModal(false); }} className="flex-1 py-3.5 text-[15px] font-semibold cursor-pointer transition-colors" style={{ color: "#FF453A" }}>활성화</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Unknown Term Modal ═══ */}
      {showUnknownModal && unknownTerms.length > 0 && (
        <UnknownTermModal terms={unknownTerms} s={s} onClose={() => { setShowUnknownModal(false); setUnknownTerms([]); runExcelTranslate(); }} />
      )}
    </div>
  );
}

function UnknownTermModal({ terms, s, onClose }: { terms: string[]; s: Record<string, string>; onClose: () => void }) {
  const [termData, setTermData] = useState<Record<string, { en: string; cn: string; sg: string; ja: string; saved?: boolean }>>({});
  const [searching, setSearching] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Record<string, { en: string; cn: string; sg: string; ja: string; source: string; confidence: number }[]>>({});
  const [bulkSearching, setBulkSearching] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  const handleSearch = async (term: string) => {
    setSearching(term);
    try { const res = await fetch("/api/translator/search-term", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term }) }); const data = await res.json(); setSearchResults(prev => ({ ...prev, [term]: data.candidates || [] }));
      // 자동으로 첫 번째 결과 선택
      if (data.candidates?.length > 0) {
        const best = data.candidates[0];
        setTermData(prev => ({ ...prev, [term]: { en: best.en, cn: best.cn, sg: best.sg, ja: best.ja, saved: false } }));
      }
    } catch { /* */ } finally { setSearching(null); }
  };

  const handleBulkSearch = async () => {
    setBulkSearching(true); setBulkProgress(0);
    const unsearched = terms.filter(t => !searchResults[t]);
    for (let i = 0; i < unsearched.length; i++) {
      const term = unsearched[i];
      try {
        const res = await fetch("/api/translator/search-term", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term }) });
        const data = await res.json();
        if (data.candidates?.length > 0) {
          setSearchResults(prev => ({ ...prev, [term]: data.candidates }));
          const best = data.candidates[0];
          setTermData(prev => ({ ...prev, [term]: { en: best.en, cn: best.cn, sg: best.sg, ja: best.ja, saved: false } }));
        }
      } catch { /* */ }
      setBulkProgress(i + 1);
    }
    setBulkSearching(false);
  };

  const handleSave = async (term: string) => {
    const d = termData[term]; if (!d?.en) return;
    try { await fetch("/api/translator/glossary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", entry: { korean: term, en: d.en, cn: d.cn, sg: d.sg, ja: d.ja, category: "treatment" } }) }); setTermData(prev => ({ ...prev, [term]: { ...d, saved: true } })); }
    catch { /* */ }
  };

  const handleBulkSave = async () => {
    const unsaved = terms.filter(t => termData[t]?.en && !termData[t]?.saved);
    for (const term of unsaved) {
      await handleSave(term);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }} />
      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 overflow-hidden flex flex-col" style={{ background: s.bg, borderRadius: 18, border: `0.5px solid ${s.border}` }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex justify-between items-center" style={{ borderBottom: `0.5px solid ${s.border}`, background: s.card }}>
          <div>
            <span className="text-sm font-semibold" style={{ color: s.accent }}>미등록 용어 {terms.length}개</span>
            <span className="text-xs ml-2" style={{ color: s.t3 }}>직접 입력하거나 AI 검색으로 번역을 추가하세요</span>
          </div>
          <div className="flex gap-2">
            <button onClick={handleBulkSearch} disabled={bulkSearching}
              className="px-3 py-1 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-40"
              style={{ background: bulkSearching ? s.card2 : s.accent, color: bulkSearching ? s.t2 : s.bg }}>
              {bulkSearching ? `AI 검색 중... (${bulkProgress}/${terms.filter(t => !searchResults[t]).length + bulkProgress})` : `전체 AI 검색 (${terms.filter(t => !searchResults[t]).length}개)`}
            </button>
            {terms.some(t => termData[t]?.en && !termData[t]?.saved) && (
              <button onClick={handleBulkSave} className="px-3 py-1 rounded-full text-xs font-semibold cursor-pointer" style={{ background: "#30D158", color: "#fff" }}>
                전체 저장 ({terms.filter(t => termData[t]?.en && !termData[t]?.saved).length}개)
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1 rounded-full text-xs font-semibold cursor-pointer" style={{ background: s.card2, color: s.accent }}>처리 완료 → 번역 시작</button>
            <button onClick={onClose} className="px-3 py-1 rounded-full text-xs cursor-pointer" style={{ background: s.card2, color: s.t2 }}>건너뛰기</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {terms.map((term, i) => {
            const d = termData[term]; const results = searchResults[term];
            return (
              <div key={term} className="p-4 rounded-xl" style={{ background: s.card, border: `0.5px solid ${s.border}` }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold" style={{ color: s.t1 }}>{i + 1}. {term}</span>
                  <div className="flex gap-2">
                    <button onClick={() => handleSearch(term)} disabled={searching === term} className="px-3 py-1 rounded-full text-xs cursor-pointer disabled:opacity-40" style={{ background: s.card2, color: s.accent }}>
                      {searching === term ? "검색 중..." : "AI 검색"}
                    </button>
                    {d && !d.saved && <button onClick={() => handleSave(term)} className="px-3 py-1 rounded-full text-xs font-semibold cursor-pointer" style={{ background: s.accent, color: s.bg }}>저장</button>}
                    {d?.saved && <span className="text-xs" style={{ color: "#30D158" }}>✓ 저장됨</span>}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {(["en", "cn", "sg", "ja"] as const).map(lang => (
                    <input key={lang} placeholder={lang.toUpperCase()} value={d?.[lang] || ""}
                      onChange={e => setTermData(prev => ({ ...prev, [term]: { ...(prev[term] || { en: "", cn: "", sg: "", ja: "" }), [lang]: e.target.value } }))}
                      className="px-2 py-1.5 rounded text-xs outline-none" style={{ background: s.bg, border: `0.5px solid ${s.border}`, color: s.t1 }} />
                  ))}
                </div>
                {results && results.length > 0 && (
                  <div className="space-y-1 mt-2">{results.map((c, j) => (
                    <button key={j} onClick={() => setTermData(prev => ({ ...prev, [term]: { ...c, saved: false } }))}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors" style={{ background: s.bg, border: `0.5px solid ${s.border}` }}>
                      <div className="flex justify-between"><span style={{ color: s.t1 }}>{c.en}</span><span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: c.confidence >= 0.9 ? "rgba(48,209,88,0.15)" : "rgba(255,159,10,0.15)", color: c.confidence >= 0.9 ? "#30D158" : "#FF9F0A" }}>{Math.round(c.confidence * 100)}%</span></div>
                      <div className="mt-0.5" style={{ color: s.t3 }}>{c.cn} | {c.sg} | {c.ja}</div>
                    </button>
                  ))}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GlossaryPreview({ s }: { s: Record<string, string> }) {
  const [entries, setEntries] = useState<Record<string, string>[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // 2026-05-19 fix: useState 초기화 자리에 부수효과 fetch가 있던 미사용 패턴 → useEffect + AbortController로 변경.
  // StrictMode에서 double-fire 차단, unmount 시 cleanup.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/translator/glossary", { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setEntries(d.entries || []); setLoading(false); })
      .catch((e) => { if (e?.name !== "AbortError") setLoading(false); });
    return () => ctrl.abort();
  }, []);

  const filtered = entries.filter(e => !search || e.korean?.includes(search) || e.en?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="검색..."
        className="mx-6 my-4 px-3.5 py-2.5 rounded-lg text-[14px] outline-none" style={{ width: "calc(100% - 48px)", background: s.card2, border: `0.5px solid ${s.border}`, color: s.t1 }} />
      {loading ? <div className="p-10 text-center text-sm" style={{ color: s.t3 }}>로딩 중...</div> : (
        <div className="overflow-x-auto" style={{ maxHeight: 420 }}>
          <table className="w-full text-xs">
            <thead><tr style={{ background: s.card2 }}>
              {["한국어", "EN", "CN", "TW", "JA", "분류"].map(h => <th key={h} className="px-3 py-2 text-left font-medium text-[10px] uppercase tracking-wider" style={{ color: s.t3, borderBottom: `0.5px solid ${s.border}` }}>{h}</th>)}
            </tr></thead>
            <tbody>{filtered.map((e, i) => (
              <tr key={i}><td className="px-3 py-1.5 font-medium" style={{ color: s.t1, borderBottom: `0.5px solid ${s.border}` }}>{e.korean}</td>
                {["en", "cn", "sg", "ja"].map(l => <td key={l} className="px-3 py-1.5" style={{ color: s.t2, borderBottom: `0.5px solid ${s.border}` }}>{e[l]}</td>)}
                <td className="px-3 py-1.5" style={{ borderBottom: `0.5px solid ${s.border}` }}><span className="px-2 py-0.5 rounded text-[10px]" style={{ background: s.card2, color: s.t3 }}>{e.category}</span></td>
              </tr>
            ))}</tbody>
          </table>
          <div className="text-center py-2 text-[10px]" style={{ color: s.t4 }}>{filtered.length}개 용어</div>
        </div>
      )}
    </div>
  );
}
