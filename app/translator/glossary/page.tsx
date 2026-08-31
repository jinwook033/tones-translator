// 용어집 관리 페이지
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface GlossaryEntry {
  id?: number;
  korean: string;
  en: string;
  cn: string;
  sg: string;
  ja: string;
  category: string;
  locked?: boolean;
}

export default function GlossaryManagePage() {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [form, setForm] = useState<GlossaryEntry>({ korean: "", en: "", cn: "", sg: "", ja: "", category: "medical" });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/translator/glossary");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (e) { setError(e instanceof Error ? e.message : "용어집 로드 실패"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = entries.filter((e) =>
    !search || e.korean?.includes(search) || e.en?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async (entry: GlossaryEntry, idx?: number) => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/translator/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: idx !== undefined ? "update" : "add", entry }),
      });
      if (res.ok) { await load(); setEditingIdx(null); setShowAdd(false); }
      else { setError(`저장 실패 (${res.status})`); }
    } catch (e) { setError(e instanceof Error ? e.message : "저장 실패"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (korean: string) => {
    if (!confirm(`"${korean}" 용어를 삭제하시겠습니까?`)) return;
    setError("");
    try {
      const res = await fetch("/api/translator/glossary", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ korean }),
      });
      if (!res.ok) { setError(`삭제 실패 (${res.status})`); return; }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "삭제 실패"); }
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#eee]">용어집 관리</h1>
            <p className="text-xs text-[#666] mt-1">{entries.length}개 의료 전문용어</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowAdd(!showAdd); setForm({ korean: "", en: "", cn: "", sg: "", ja: "", category: "medical" }); }}
              className="px-4 py-2 rounded-lg bg-[#D8F213] text-black text-xs font-bold hover:bg-[#c5dd10] cursor-pointer">
              + 용어 추가
            </button>
            <Link href="/translator" className="px-4 py-2 rounded-lg bg-[#2A2A2A] text-[#888] text-xs hover:text-white">← 번역기</Link>
          </div>
        </div>

        {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

        {/* 추가 폼 */}
        {showAdd && (
          <div className="bg-[#1A1A1A] rounded-xl border border-[#333] p-4 mb-4">
            <div className="grid grid-cols-6 gap-2 mb-3">
              <input placeholder="한국어" value={form.korean} onChange={(e) => setForm({ ...form, korean: e.target.value })}
                className="px-2 py-1.5 rounded bg-[#0D0D0D] border border-[#333] text-sm text-[#ddd] focus:outline-none focus:border-[#D8F213]" />
              <input placeholder="English" value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })}
                className="px-2 py-1.5 rounded bg-[#0D0D0D] border border-[#333] text-sm text-[#ddd] focus:outline-none" />
              <input placeholder="简体中文" value={form.cn} onChange={(e) => setForm({ ...form, cn: e.target.value })}
                className="px-2 py-1.5 rounded bg-[#0D0D0D] border border-[#333] text-sm text-[#ddd] focus:outline-none" />
              <input placeholder="繁體中文" value={form.sg} onChange={(e) => setForm({ ...form, sg: e.target.value })}
                className="px-2 py-1.5 rounded bg-[#0D0D0D] border border-[#333] text-sm text-[#ddd] focus:outline-none" />
              <input placeholder="日本語" value={form.ja} onChange={(e) => setForm({ ...form, ja: e.target.value })}
                className="px-2 py-1.5 rounded bg-[#0D0D0D] border border-[#333] text-sm text-[#ddd] focus:outline-none" />
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="px-2 py-1.5 rounded bg-[#0D0D0D] border border-[#333] text-sm text-[#ddd] focus:outline-none">
                <option value="medical">medical</option>
                <option value="brand">brand</option>
                <option value="equipment">equipment</option>
                <option value="general">general</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleSave(form)} disabled={saving || !form.korean}
                className="px-4 py-1.5 rounded bg-[#D8F213] text-black text-xs font-bold cursor-pointer disabled:opacity-40">
                {saving ? "저장 중..." : "추가"}
              </button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 rounded bg-[#2A2A2A] text-[#888] text-xs cursor-pointer">취소</button>
            </div>
          </div>
        )}

        {/* 검색 */}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="용어 검색..."
          className="w-full px-3 py-2 rounded-lg bg-[#1A1A1A] border border-[#333] text-sm text-[#ccc] mb-4 focus:outline-none focus:border-[#D8F213] placeholder-[#555]" />

        {/* 테이블 */}
        {loading ? (
          <div className="text-center py-8 text-[#555]">로딩 중...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#1A1A1A] border-b border-[#333] text-[#888]">
                  <th className="px-3 py-2 text-left font-medium">한국어</th>
                  <th className="px-3 py-2 text-left font-medium">EN</th>
                  <th className="px-3 py-2 text-left font-medium">CN</th>
                  <th className="px-3 py-2 text-left font-medium">SG</th>
                  <th className="px-3 py-2 text-left font-medium">JA</th>
                  <th className="px-3 py-2 text-left font-medium">분류</th>
                  <th className="px-3 py-2 text-center font-medium w-20">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222]">
                {filtered.map((e, i) => (
                  <tr key={i} className={`${i % 2 ? "bg-[#161616]" : ""} hover:bg-[#1E1E1E]`}>
                    <td className="px-3 py-1.5 text-[#ddd] font-medium">{e.korean}</td>
                    <td className="px-3 py-1.5 text-[#aaa]">{e.en}</td>
                    <td className="px-3 py-1.5 text-[#aaa]">{e.cn}</td>
                    <td className="px-3 py-1.5 text-[#aaa]">{e.sg}</td>
                    <td className="px-3 py-1.5 text-[#aaa]">{e.ja}</td>
                    <td className="px-3 py-1.5">
                      <span className="bg-[#2A2A2A] text-[#888] px-2 py-0.5 rounded text-[10px]">{e.category}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button onClick={() => handleDelete(e.korean)} className="text-[10px] text-[#666] hover:text-red-400 cursor-pointer">삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-center py-2 text-[#555] text-[10px]">{filtered.length}개 용어</div>
          </div>
        )}
      </div>
    </div>
  );
}
