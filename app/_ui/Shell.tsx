// 공통 껍데기 — 좌측 사이드바 212px + 상단 헤더.
// 시안(design/Tones Translation Console.dc.html)의 aside/header 를 그대로 옮겼다.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const NAV = [
  { href: "/", label: "대시보드", icon: "ph-gauge", title: "대시보드", sub: "오늘 사람 손이 필요한 것" },
  { href: "/translate", label: "번역", icon: "ph-translate", title: "번역", sub: "한국어 원고 → 4개 언어" },
  { href: "/sheet", label: "이벤트 시트", icon: "ph-rows", title: "이벤트 시트", sub: "이벤트 명칭 · 한글 → 4개 언어" },
  { href: "/excel", label: "엑셀 일괄", icon: "ph-table", title: "엑셀 일괄", sub: "톤즈 월간 가격표 포맷" },
  { href: "/review", label: "검수", icon: "ph-seal-check", title: "검수", sub: "원어민 검수자가 고치는 화면" },
  { href: "/glossary", label: "용어집", icon: "ph-book-open", title: "용어집", sub: "용어 고정과 분류" },
  { href: "/language", label: "언어 설정", icon: "ph-sliders-horizontal", title: "언어 설정", sub: "문체 규칙 · 금지표현 · 대조 예문" },
];

export function Shell({
  children,
  right,
}: {
  children: React.ReactNode;
  /** 헤더 우측에 끼워 넣을 것 (화면별 동작 버튼 등) */
  right?: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href))) ?? NAV[0];

  // 검수 대기 총합 — 사이드바 배지
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/translator/review?limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.stats) return;
        const total = Object.values(d.stats as Record<string, { pending: number }>)
          .reduce((a, s) => a + (s.pending || 0), 0);
        setPending(total);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [pathname]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "212px minmax(0,1fr)",
        minHeight: "100vh",
        minWidth: 1280,
        background: "var(--bg)",
      }}
    >
      <aside
        style={{
          borderRight: "1px solid var(--line)",
          background: "var(--surface2)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 0",
        }}
      >
        <div style={{ padding: "0 18px 22px", display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--accent)", display: "block" }} />
            <span style={{ fontWeight: 600, letterSpacing: "-.01em", fontSize: 14 }}>Tone&apos;s 번역</span>
          </div>
          <span style={{ color: "var(--dim)", fontSize: 11, letterSpacing: ".04em" }}>INTERNAL · v0.4</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 10px" }}>
          {NAV.map((n) => {
            const active = n.href === current.href;
            const badge = n.href === "/review" && pending ? String(pending) : "";
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  display: "grid",
                  gridTemplateColumns: "18px 1fr auto",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 13.5,
                  fontWeight: 500,
                  textDecoration: "none",
                  background: active ? "var(--accent-soft)" : "transparent",
                  color: active ? "var(--txt)" : "var(--muted)",
                }}
              >
                <i className={`ph ${n.icon}`} style={{ fontSize: 16, color: active ? "var(--accent)" : "var(--dim)" }} />
                <span>{n.label}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontVariantNumeric: "tabular-nums",
                    padding: badge ? "1px 6px" : 0,
                    borderRadius: 99,
                    background: badge ? "var(--raise)" : "transparent",
                    color: badge ? "var(--muted)" : "transparent",
                  }}
                >
                  {badge}
                </span>
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", padding: "16px 18px 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              paddingTop: 6,
              borderTop: "1px solid var(--line)",
            }}
          >
            <span
              style={{
                width: 22, height: 22, borderRadius: 99, background: "var(--raise)",
                display: "grid", placeItems: "center", fontSize: 10, color: "var(--muted)",
              }}
            >
              TC
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>톤즈의원 내부용</span>
          </div>
        </div>
      </aside>

      <main style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
            padding: "16px 26px", borderBottom: "1px solid var(--line)", background: "var(--surface2)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-.015em" }}>{current.title}</h1>
            <span style={{ fontSize: 12, color: "var(--dim)" }}>{current.sub}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{right}</div>
        </header>

        <div style={{ padding: "24px 26px 56px", display: "flex", flexDirection: "column", gap: 22 }}>
          {children}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 되풀이되는 조각들
// ---------------------------------------------------------------------------

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</h2>
      {hint && <span style={{ fontSize: 12, color: "var(--dim)" }}>{hint}</span>}
    </div>
  );
}

export function EmptyState({ icon, title, body, tone = "dim" }: {
  icon: string; title: string; body: string; tone?: "dim" | "ok";
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--line2)", borderRadius: 8, padding: "56px 20px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        background: "var(--surface2)", textAlign: "center",
      }}
    >
      <i className={`ph ${icon}`} style={{ fontSize: 28, color: tone === "ok" ? "var(--ok)" : "var(--dim)" }} />
      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{title}</span>
      <span style={{ fontSize: 12, color: "var(--dim)", maxWidth: 420 }}>{body}</span>
    </div>
  );
}

export function Tabs<T extends string>({ items, value, onChange }: {
  items: { value: T; label: string; badge?: number | string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "flex", gap: 4, background: "var(--surface2)", border: "1px solid var(--line)",
        borderRadius: 7, padding: 4, width: "fit-content",
      }}
    >
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            style={{
              display: "flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: 5,
              fontSize: 12.5, fontWeight: 500, cursor: "pointer", border: 0,
              background: on ? "var(--accent-soft)" : "transparent",
              color: on ? "var(--accent)" : "var(--muted)",
            }}
          >
            <span>{it.label}</span>
            {it.badge !== undefined && it.badge !== "" && (
              <span
                style={{
                  fontSize: 11, fontVariantNumeric: "tabular-nums", padding: "0 5px", borderRadius: 99,
                  background: on ? "rgba(0,0,0,.35)" : "var(--raise)",
                  color: on ? "var(--accent)" : "var(--dim)",
                }}
              >
                {it.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6, border: "1px solid var(--accent)",
  background: "var(--accent-soft)", color: "var(--accent)",
  fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};

export const btnGhost: React.CSSProperties = {
  padding: "7px 13px", borderRadius: 6, border: "1px solid var(--line2)",
  background: "transparent", color: "var(--txt)",
  fontSize: 12.5, fontWeight: 500, cursor: "pointer",
};

export const inputStyle: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--line2)", borderRadius: 6,
  color: "var(--txt)", fontSize: 12.5, padding: "6px 10px", outline: "none",
};
