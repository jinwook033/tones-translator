/**
 * POST /api/translator/resolve
 *
 * Ambiguity resolution API — when a translation returns multiple
 * ambiguous options, the user selects one. This endpoint records
 * that choice and optionally saves it to the glossary for future use.
 *
 * Body:
 *   korean              — the original Korean text
 *   selectedTranslation — the translation the user picked
 *   targetLang          — which language ("en" | "cn" | "tw" | "ja")
 *   addToGlossary       — whether to persist the choice in the glossary
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addGlossaryEntry } from '@/lib/translator/glossary-data';
import type { GlossaryEntry } from '@/lib/translator/types';
import { getTenantId } from '@/lib/tenant';
import { checkAuth } from "@/lib/auth";

export const runtime = 'nodejs';
export const maxDuration = 120;

const ResolveSchema = z.object({
  korean: z.string().min(1).max(200),
  selectedTranslation: z.string().min(1).max(2000),
  targetLang: z.enum(['en', 'cn', 'tw', 'ja']),
  addToGlossary: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;

    const tenantId = getTenantId(req);
    const body = await req.json();
    const parsed = ResolveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { korean, selectedTranslation, targetLang, addToGlossary: shouldAdd } = parsed.data;

    if (shouldAdd) {
      // Build a glossary entry with only the resolved language filled in.
      // Other languages remain null so they don't override existing translations.
      const entry: GlossaryEntry = {
        korean,
        category: 'general', // default; user can reclassify later
        en: targetLang === 'en' ? selectedTranslation : null,
        cn: targetLang === 'cn' ? selectedTranslation : null,
        tw: targetLang === 'tw' ? selectedTranslation : null,
        ja: targetLang === 'ja' ? selectedTranslation : null,
        note: `Auto-resolved from ambiguity (${targetLang})`,
        locked: false,
      };

      await addGlossaryEntry(tenantId, entry);

      return NextResponse.json({
        success: true,
        resolved: { korean, [targetLang]: selectedTranslation },
        addedToGlossary: true,
      });
    }

    // User chose not to persist — just acknowledge the resolution
    return NextResponse.json({
      success: true,
      resolved: { korean, [targetLang]: selectedTranslation },
      addedToGlossary: false,
    });
  } catch (error) {
    console.error('[translator/resolve] Error:', error);
    return NextResponse.json(
      { error: 'Resolution failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
