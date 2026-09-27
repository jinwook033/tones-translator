/**
 * /api/translator/sheet
 *
 * 이벤트 시트 — 이벤트 명칭 / 한글 / 영어 / 중국어(간체) / 일본어 / 중국어(번체)
 *
 *   GET             — 저장된 시트 목록 (?id= 면 그 시트 하나)
 *   POST            — 시트의 한글 칸을 번역해서 돌려준다 (저장하지 않음)
 *   PUT             — 시트 저장
 *   DELETE ?id=     — 시트 삭제
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkAuth } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { translate } from '@/lib/translator/translate';
import { getGlossary } from '@/lib/translator/glossary-data';
import { listSheets, getSheet, saveSheet, deleteSheet, SHEET_LANGS } from '@/lib/translator/sheet-store';
import { recordUsage } from '@/lib/translator/usage-log';
import { emptyUsage, addUsage } from '@/lib/translator/pricing';
import type { TargetLang, TranslationContext } from '@/lib/translator/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const sheet = getSheet(id);
    if (!sheet) return NextResponse.json({ error: '시트를 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ sheet });
  }
  return NextResponse.json({ sheets: listSheets() });
}

const RowSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().max(300).default(''),
  ko: z.string().max(5000).default(''),
  translations: z.record(z.string(), z.string()).optional(),
  reused: z.record(z.string(), z.boolean()).optional(),
});

const TranslateSchema = z.object({
  rows: z.array(RowSchema).min(1).max(200),
  /** 비워두면 4개 언어 전부 */
  langs: z.array(z.enum(['en', 'cn', 'tw', 'ja'])).optional(),
  /** 이미 채워진 칸을 다시 번역할지 */
  overwrite: z.boolean().default(false),
  title: z.string().max(200).optional(),
  /** 비워두면 행마다 길이를 보고 정한다 */
  context: z.enum(['treatment_name', 'description', 'category', 'general', 'legal']).optional(),
});

/**
 * 행마다 문맥을 고른다.
 *
 * 2026-09-17: 전부 treatment_name 으로 고정했더니 긴 문장에서 어순이 깨졌다 —
 * '톤즈의원 이동선 원장이 직접 진행하는…' 이 'Dr. Tone's CLINIC Lee Dong-seon' 이
 * 되어 원장이 사람이 아니라 병원에 붙었다. 시술명 문맥은 짧은 라벨 전용이다.
 */
function pickContext(ko: string): TranslationContext {
  const t = ko.trim();
  // 종결어미가 있거나 길면 문장이다
  if (/[.!?]$/.test(t) || /(습니다|입니다|합니다|하는|되는|드립니다)/.test(t)) return 'description';
  if (t.length > 25) return 'description';
  return 'treatment_name';
}

/** 시트의 한글 칸을 번역한다. 저장은 하지 않는다 — 사람이 보고 저장을 누른다. */
export async function POST(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const parsed = TranslateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다', detail: parsed.error.issues }, { status: 400 });
  }

  const langs = (parsed.data.langs ?? SHEET_LANGS) as TargetLang[];
  const tenantId = getTenantId(req);
  const glossary = await getGlossary(tenantId);

  let usage = emptyUsage();
  let items = 0;
  let reused = 0;

  const rows = [];
  for (const row of parsed.data.rows) {
    const ko = row.ko.trim();
    if (!ko) {
      rows.push({ ...row, translations: row.translations ?? {}, skipped: '한글 칸이 비었습니다' });
      continue;
    }

    // 이미 채워진 칸은 건드리지 않는다 — 사람이 고쳐둔 걸 덮어쓰면 안 된다.
    const need = parsed.data.overwrite
      ? langs
      : langs.filter((l) => !(row.translations?.[l] ?? '').trim());

    if (need.length === 0) {
      rows.push({ ...row, translations: row.translations ?? {} });
      continue;
    }

    try {
      const ctx = parsed.data.context ?? pickContext(ko);
      const res = await translate(ko, need, ctx, glossary);
      const out: Record<string, string> = { ...(row.translations ?? {}) };
      const usedMemory: Record<string, boolean> = { ...(row.reused ?? {}) };

      for (const l of need) {
        const u = res.translations[l];
        if (!u) continue;
        out[l] = u.text;
        usedMemory[l] = !!u.reviewed;
        items++;
        if (u.reviewed) reused++;
      }

      if (res.usage) usage = addUsage(usage, res.usage);
      rows.push({ ...row, translations: out, reused: usedMemory });
    } catch (e) {
      rows.push({
        ...row,
        translations: row.translations ?? {},
        error: e instanceof Error ? e.message : '번역 실패',
      });
    }
  }

  if (items > 0) {
    recordUsage({
      kind: 'sheet',
      label: parsed.data.title,
      langs,
      items,
      reused,
      usage,
    });
  }

  return NextResponse.json({ rows, usage, items, reused });
}

const SaveSchema = z.object({
  id: z.string().max(64).optional(),
  title: z.string().max(200),
  rows: z.array(RowSchema),
});

export async function PUT(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다' }, { status: 400 });
  }

  const sheet = saveSheet({
    id: parsed.data.id,
    title: parsed.data.title,
    rows: parsed.data.rows.map((r) => ({
      id: r.id,
      name: r.name,
      ko: r.ko,
      translations: (r.translations ?? {}) as Partial<Record<TargetLang, string>>,
      reused: r.reused as Partial<Record<TargetLang, boolean>> | undefined,
    })),
  });

  return NextResponse.json({ ok: true, sheet });
}

export async function DELETE(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 가 필요합니다' }, { status: 400 });
  if (!deleteSheet(id)) return NextResponse.json({ error: '시트를 찾을 수 없습니다' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
