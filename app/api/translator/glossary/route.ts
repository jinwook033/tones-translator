/**
 * /api/translator/glossary
 *
 * CRUD API for the translation glossary.
 *
 *   GET    — list all entries (optional ?category= filter)
 *   POST   — add a new entry
 *   PUT    — update an existing entry (matched by korean field)
 *   DELETE — remove an entry by korean field
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGlossary, addGlossaryEntry, removeGlossaryEntry } from '@/lib/translator/glossary-data';
import { CATEGORY_META } from '@/lib/translator/types';
import type { GlossaryCategory, GlossaryEntry } from '@/lib/translator/types';
import { getTenantId } from '@/lib/tenant';
import { checkAuth } from "@/lib/auth";

export const runtime = 'nodejs';
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// CATEGORY_META 에서 파생한다. 분류를 추가·변경해도 여기가 자동으로 따라온다.
// 2026-09-16: 손으로 적어둔 목록이 재분류 때 갱신되지 않아 새 분류가 전부 400 이 나던 버그.
const CATEGORY_CODES = Object.keys(CATEGORY_META) as [GlossaryCategory, ...GlossaryCategory[]];
const CategoryEnum = z.enum(CATEGORY_CODES);

const GlossaryEntrySchema = z.object({
  korean: z.string().min(1).max(200),
  category: CategoryEnum,
  en: z.string().nullable().default(null),
  cn: z.string().nullable().default(null),
  tw: z.string().nullable().default(null),
  ja: z.string().nullable().default(null),
  note: z.string().nullable().optional(),
  locked: z.boolean().default(false),
});

const DeleteSchema = z.object({
  korean: z.string().min(1),
});

// ---------------------------------------------------------------------------
// GET — list glossary entries
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;

    const tenantId = getTenantId(req);
    const { searchParams } = req.nextUrl;
    const category = searchParams.get('category');

    let entries = await getGlossary(tenantId);

    // Optional category filter
    if (category) {
      const catParsed = CategoryEnum.safeParse(category);
      if (!catParsed.success) {
        return NextResponse.json(
          { error: 'Invalid category', valid: CategoryEnum.options },
          { status: 400 },
        );
      }
      entries = entries.filter((e) => e.category === catParsed.data);
    }

    return NextResponse.json({
      count: entries.length,
      entries,
    });
  } catch (error) {
    console.error('[translator/glossary] GET error:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — add new entry
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;

    const tenantId = getTenantId(req);
    const body = await req.json();
    const parsed = GlossaryEntrySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const entry: GlossaryEntry = {
      ...parsed.data,
      category: parsed.data.category as GlossaryCategory,
    };

    const glossary = await getGlossary(tenantId);
    const existing = glossary.find((e) => e.korean === entry.korean);
    if (existing) {
      return NextResponse.json(
        { error: 'Entry already exists', korean: entry.korean, hint: 'Use PUT to update' },
        { status: 409 },
      );
    }

    await addGlossaryEntry(tenantId, entry);

    return NextResponse.json({ success: true, entry }, { status: 201 });
  } catch (error) {
    console.error('[translator/glossary] POST error:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — update existing entry
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;

    const tenantId = getTenantId(req);
    const body = await req.json();
    const parsed = GlossaryEntrySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const entry: GlossaryEntry = {
      ...parsed.data,
      category: parsed.data.category as GlossaryCategory,
    };

    const glossary = await getGlossary(tenantId);
    const existing = glossary.find((e) => e.korean === entry.korean);
    if (!existing) {
      return NextResponse.json(
        { error: 'Entry not found', korean: entry.korean },
        { status: 404 },
      );
    }

    await addGlossaryEntry(tenantId, entry);

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    console.error('[translator/glossary] PUT error:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove entry by korean field
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;

    const tenantId = getTenantId(req);
    const body = await req.json();
    const parsed = DeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const removed = await removeGlossaryEntry(tenantId, parsed.data.korean);

    if (!removed) {
      return NextResponse.json(
        { error: 'Entry not found', korean: parsed.data.korean },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, removed: parsed.data.korean });
  } catch (error) {
    console.error('[translator/glossary] DELETE error:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다' },
      { status: 500 },
    );
  }
}
