// 1 · 대시보드 — 오늘 사람 손이 필요한 것
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shell, SectionTitle, EmptyState } from "../_ui/Shell";
import { langMeta, LANGS } from "../_ui/lang";

interface Overview {
  review: Record<string, { pending: number; approved: number; corrected: number }>;
  blocked: { id: string; lang: string; source: string; machine: string; code: string; message: string }[];
  blockedTotal: number;
  glossary: { total: number; categories: number; pinned: number };
  language: { antiPatterns: number; examples: number; languages: number; customized: number };
  rules: { total: number; block: number; warning: number };
  usage: {
    month: string; items: number; reused: number;
    totalKRW: number; savedKRW: number; cacheHitRate: number;
    recent: { at: string; kind: string; label?: string; items: number; reused: number }[];
  };
}

export function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/translator/overview");
      if (!res.ok) throw new Error("집계를 불러오지 못했습니다");
      setData(await res.json());
      setSyncedAt(new Date().toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = data
    ? [
        {
          label: "용어집",
          big: String(data.glossary.total),
          unit: "건",
          sub: `${data.glossary.categories}개 분류 · 고정 용어 ${data.glossary.pinned}건`,
          href: "/glossary",
        },
        {
          label: "언어 설정",
          big: String(data.language.antiPatterns),
          unit: "개 금지표현",
          sub: `대조 예문 ${data.language.examples}개 · ${data.language.languages}개 언어`,
          href: "/language",
        },
        {
          label: "검증 규칙",
          big: String(data.rules.total),
          unit: "개",
          sub: `차단 ${data.rules.block} / 경고 ${data.rules.warning}`,
          href: "/review",
        },
        {
          label: `이번 달 비용 (${data.usage.month})`,
          big: data.usage.totalKRW.toLocaleString(),
          unit: "원",
          sub:
            data.usage.items === 0
              ? "아직 번역 기록이 없습니다"
              : `번역 ${data.usage.items}칸 · 재사용 ${data.usage.reused}칸으로 약 ${data.usage.savedKRW.toLocaleString()}원 절약`,
          href: "/translate",
        },
      ]
    : [];

  return (
    <Shell
      right={
        <span style={{ fontSize: 12, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
          {syncedAt ? `마지막 동기화 ${syncedAt}` : "불러오는 중…"}
        </span>
      }
    >
      {error && <p style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p>}

      {/* 검수 대기 현황 */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionTitle title="검수 대기 현황" hint="사람 손이 필요한 유일한 지점" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
          {LANGS.map((l) => {
            const s = data?.review[l.id] ?? { pending: 0, approved: 0, corrected: 0 };
            return (
              <Link
                key={l.id}
                href={`/review?lang=${l.id}`}
                style={{
                  background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8,
                  padding: "15px 16px", display: "flex", flexDirection: "column", gap: 13,
                  boxShadow: "0 1px 0 rgba(0,0,0,.3)", textDecoration: "none", color: "var(--txt)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{l.name}</span>
                  <span style={{ fontSize: 11, letterSpacing: ".06em", color: "var(--dim)" }}>{l.code}</span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 5 }}>
                  <span
                    style={{
                      fontSize: 34, lineHeight: 1, fontWeight: 500, fontVariantNumeric: "tabular-nums",
                      color: s.pending > 9 ? "var(--accent)" : "var(--txt)",
                    }}
                  >
                    {s.pending}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)", paddingBottom: 4 }}>대기</span>
                </div>
                <div style={{ display: "flex", gap: 16, paddingTop: 11, borderTop: "1px solid var(--line)" }}>
                  <Stat label="수정됨" value={s.corrected} />
                  <Stat label="승인" value={s.approved} muted />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 18, alignItems: "start" }}>
        {/* 바로 손봐야 할 것 */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionTitle
            title="바로 손봐야 할 것"
            hint={data ? `검증기가 차단한 항목 ${data.blockedTotal}건` : undefined}
          />
          {data && data.blocked.length === 0 ? (
            <EmptyState
              icon="ph-check-circle"
              tone="ok"
              title="차단된 항목이 없습니다"
              body="검증기를 통과하지 못한 번역이 생기면 여기에 쌓입니다."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(data?.blocked ?? []).map((b) => {
                const m = langMeta(b.lang);
                return (
                  <Link
                    key={b.id}
                    href={`/review?lang=${b.lang}`}
                    style={{
                      display: "grid", gridTemplateColumns: "96px minmax(0,1fr)", gap: 14, alignItems: "start",
                      background: "var(--surface)", border: "1px solid var(--line)",
                      borderLeft: "2px solid var(--bad)", borderRadius: 8, padding: "13px 15px",
                      textDecoration: "none", color: "var(--txt)",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{m.name}</span>
                      <span
                        style={{
                          fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", color: "var(--bad)",
                          background: "rgba(226,101,95,.13)", padding: "2px 6px", borderRadius: 4, width: "fit-content",
                        }}
                      >
                        차단
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5 }}>{b.source}</span>
                      <span lang={m.tag} style={{ fontSize: 13.5, color: "var(--warn)", fontFamily: m.font }}>
                        {b.machine}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--dim)" }}>
                        <span style={{ color: "var(--muted)" }}>{b.code}</span> · {b.message}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* 상태 블록 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {stats.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              style={{
                background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8,
                padding: "14px 16px", display: "flex", flexDirection: "column", gap: 7,
                textDecoration: "none", color: "var(--txt)",
              }}
            >
              <span style={{ fontSize: 11.5, letterSpacing: ".05em", color: "var(--dim)" }}>{s.label}</span>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 5 }}>
                <span style={{ fontSize: 26, lineHeight: 1, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                  {s.big}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)", paddingBottom: 3 }}>{s.unit}</span>
              </div>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{s.sub}</span>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 10.5, color: "var(--dim)", letterSpacing: ".04em" }}>{label}</span>
      <span
        style={{
          fontSize: 15, fontVariantNumeric: "tabular-nums",
          color: muted ? "var(--muted)" : "var(--txt)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
