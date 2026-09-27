// 3 · 엑셀 일괄 — 파일 단위 번역과 다운로드
"use client";

import { useCallback, useRef, useState } from "react";
import { Shell, EmptyState, btnPrimary, btnGhost } from "../_ui/Shell";
import { LANGS } from "../_ui/lang";

type Phase = "idle" | "checking" | "warn" | "running" | "done" | "error";

interface Tokens {
  input: number; cacheWrite: number; cacheRead: number; output: number;
  cost: number; costKRW: number;
}

interface FileOut { lang: string; fileName: string; base64: string }

export default function ExcelPage() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [files, setFiles] = useState<FileOut[]>([]);
  const [error, setError] = useState("");
  const [savedTerms, setSavedTerms] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const targets = LANGS.map((l) => l.id).join(",");

  const run = useCallback(async (checkOnly: boolean) => {
    if (!file) return;
    setPhase(checkOnly ? "checking" : "running");
    setError(""); setFiles([]); setCurrent(0); setTotal(0); setTokens(null);
    if (!checkOnly) setUnknown([]);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("targets", targets);
    if (checkOnly) fd.append("checkOnly", "true");

    try {
      const res = await fetch("/api/translator/translate-excel-stream", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "요청 실패");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          switch (ev.type) {
            case "status":
              setStatus(String(ev.message ?? ""));
              break;
            case "unregistered":
              setUnknown((ev.terms as string[]) ?? []);
              setPhase("warn");
              break;
            case "progress":
              setCurrent(Number(ev.current ?? 0));
              setTotal(Number(ev.total ?? 0));
              setStatus(String(ev.message ?? ""));
              if (ev.tokens) setTokens(ev.tokens as Tokens);
              break;
            case "complete":
              setFiles((ev.files as FileOut[]) ?? []);
              setPhase("done");
              break;
            case "error":
              setError(String(ev.message ?? "번역 실패"));
              setPhase("error");
              break;
          }
        }
      }
      setPhase((p) => (p === "running" || p === "checking" ? (checkOnly ? "idle" : "done") : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 실패");
      setPhase("error");
    }
  }, [file, targets]);

  async function saveTerm(term: string) {
    try {
      const res = await fetch("/api/translator/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // I열 variant 감지는 제품·기기 규격 대상이라 product 로 넣는다. 용어집에서 바꿀 수 있다.
        body: JSON.stringify({ korean: term, category: "product", en: "", cn: "", tw: "", ja: "" }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "저장 실패");
      }
      setSavedTerms((s) => ({ ...s, [term]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    }
  }

  function download(f: FileOut) {
    const bin = atob(f.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
    const a = document.createElement("a");
    a.href = url; a.download = f.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pct = total > 0 ? Math.round((current / total) * 1000) / 10 : 0;
  const busy = phase === "running" || phase === "checking";

  return (
    <Shell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
        {/* 파일 받기 */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f && f.name.endsWith(".xlsx")) { setFile(f); setPhase("idle"); }
          }}
          style={{
            border: "1px dashed var(--line2)", borderRadius: 8, background: "var(--surface2)",
            padding: 34, display: "flex", flexDirection: "column", alignItems: "center", gap: 9,
          }}
        >
          <i className="ph ph-file-xls" style={{ fontSize: 28, color: "var(--accent)" }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            {file ? file.name : "엑셀 파일을 여기에 놓으세요"}
          </span>
          <span style={{ fontSize: 12, color: "var(--dim)" }}>
            .xlsx · 톤즈 월간 포맷 (F·G·H열 번역, J~M열 가격 보존)
          </span>
          <input
            ref={inputRef}
            id="xlsx"
            type="file"
            accept=".xlsx"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setPhase("idle"); } }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => inputRef.current?.click()} style={{ ...btnPrimary, background: "transparent" }}>
              파일 선택
            </button>
            {file && (
              <>
                <button onClick={() => run(true)} disabled={busy} style={{ ...btnGhost, opacity: busy ? 0.4 : 1 }}>
                  미등록 용어만 점검
                </button>
                <button onClick={() => run(false)} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.4 : 1 }}>
                  {busy ? "처리 중…" : "번역 실행"}
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: "rgba(226,101,95,.10)", border: "1px solid rgba(226,101,95,.35)", borderRadius: 8, padding: 14, fontSize: 13, color: "var(--bad)" }}>
            {error}
          </div>
        )}

        {/* 진행 중 */}
        {busy && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                {total > 0 ? `${current} / ${total} 번역 완료` : status || "준비 중…"}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{file?.name}</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: "var(--raise)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 99, transition: "width .3s" }} />
            </div>
            {tokens && (
              <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
                <Metric label="누적 토큰" value={(tokens.input + tokens.cacheWrite + tokens.cacheRead + tokens.output).toLocaleString()} />
                <Metric label="비용" value={`₩ ${tokens.costKRW.toLocaleString()}`} />
                <Metric label="캐시 적중" value={tokens.cacheRead.toLocaleString()} />
              </div>
            )}
          </div>
        )}

        {/* 미등록 용어 */}
        {unknown.length > 0 && (
          <div
            style={{
              background: "var(--surface)", border: "1px solid rgba(226,162,71,.35)",
              borderLeft: "2px solid var(--warn)", borderRadius: 8, padding: 16,
              display: "flex", flexDirection: "column", gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ph ph-warning" style={{ fontSize: 15, color: "var(--warn)" }} />
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                용어집에 없는 단어 {unknown.length}개를 찾았습니다
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {unknown.map((t) => (
                <div
                  key={t}
                  style={{
                    display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px auto", gap: 12,
                    alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)",
                  }}
                >
                  <span style={{ fontSize: 13.5 }}>{t}</span>
                  <span style={{ fontSize: 11.5, color: "var(--dim)" }}>product 후보</span>
                  <button
                    onClick={() => saveTerm(t)}
                    disabled={savedTerms[t]}
                    style={{ ...btnGhost, padding: "4px 10px", fontSize: 12, opacity: savedTerms[t] ? 0.4 : 1 }}
                  >
                    {savedTerms[t] ? "저장됨" : "용어집에 저장"}
                  </button>
                </div>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--dim)" }}>
              저장한 뒤 용어집 화면에서 번역값을 채워야 실제로 고정됩니다.
            </p>
          </div>
        )}

        {/* 완료 */}
        {phase === "done" && files.length > 0 && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ph ph-check-circle" style={{ fontSize: 15, color: "var(--ok)" }} />
              <span style={{ fontSize: 13.5, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                {total} / {total} 번역 완료 · 검수 대기로 이동됨
              </span>
            </div>
            {tokens && (
              <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
                <Metric label="누적 토큰" value={(tokens.input + tokens.cacheWrite + tokens.cacheRead + tokens.output).toLocaleString()} />
                <Metric label="비용" value={`₩ ${tokens.costKRW.toLocaleString()}`} />
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 9 }}>
              {files.map((f) => (
                <button
                  key={f.lang}
                  onClick={() => download(f)}
                  style={{ ...btnGhost, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 9 }}
                >
                  <i className="ph ph-download-simple" style={{ fontSize: 14 }} />
                  {LANGS.find((l) => l.id === f.lang)?.name ?? f.lang} .xlsx
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "idle" && !file && (
          <EmptyState
            icon="ph-table"
            title="아직 올린 파일이 없습니다"
            body="엑셀을 올리면 진행 상황과 비용이 여기에 표시됩니다."
          />
        )}
      </div>
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10.5, color: "var(--dim)", letterSpacing: ".04em" }}>{label}</span>
      <span style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
