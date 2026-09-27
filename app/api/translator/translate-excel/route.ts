/**
 * POST /api/translator/translate-excel
 *
 * Excel translation API — accepts a Tones Clinic .xlsx file via
 * multipart/form-data, translates procedure names and descriptions
 * for each target language, and returns base64-encoded .xlsx files.
 *
 * Form fields:
 *   file    — .xlsx file (required)
 *   targets — comma-separated target languages, e.g. "en,ja" (required)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { translate } from '@/lib/translator/translate';
import { getGlossary } from '@/lib/translator/glossary-data';
import { parseTonesExcel, writeTranslatedExcel, prepareTranslatedRows } from '@/lib/translator/excel-parser';
import type { TargetLang, TranslationContext } from '@/lib/translator/types';
import { getTenantId } from '@/lib/tenant';
import { checkAuth } from "@/lib/auth";

export const runtime = 'nodejs';
export const maxDuration = 120;

const TargetsSchema = z
  .string()
  .min(1)
  .transform((s) => s.split(',').map((t) => t.trim()))
  .pipe(z.array(z.enum(['en', 'cn', 'tw', 'ja'])).min(1).max(4));

export async function POST(req: NextRequest) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;

    const tenantId = getTenantId(req);
    const formData = await req.formData();

    // --- Validate file ---
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Missing file field (must be .xlsx)' },
        { status: 400 },
      );
    }

    if (!file.name.endsWith('.xlsx')) {
      return NextResponse.json(
        { error: 'Only .xlsx files are supported' },
        { status: 400 },
      );
    }

    // --- Validate targets ---
    const rawTargets = formData.get('targets');
    if (!rawTargets || typeof rawTargets !== 'string') {
      return NextResponse.json(
        { error: 'Missing targets field (comma-separated: en,cn,tw,ja)' },
        { status: 400 },
      );
    }

    const targetsParsed = TargetsSchema.safeParse(rawTargets);
    if (!targetsParsed.success) {
      return NextResponse.json(
        { error: 'Invalid targets', details: targetsParsed.error.flatten() },
        { status: 400 },
      );
    }

    const targets = targetsParsed.data as TargetLang[];

    // --- Parse Excel ---
    const buffer = await file.arrayBuffer();

    // 파일 크기 제한 (10MB)
    if (buffer.byteLength > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: '파일 크기가 10MB를 초과합니다' },
        { status: 400 },
      );
    }

    const parsed = parseTonesExcel(buffer, file.name);

    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { error: 'No translatable rows found in Excel file' },
        { status: 400 },
      );
    }

    // --- Deduplicate texts to translate ---
    // Same procedureName or description across rows = one API call
    const uniqueTexts = new Map<string, { text: string; context: TranslationContext }>();

    for (const row of parsed.rows) {
      if (row.procedureName) {
        const key = `name:${row.procedureName}`;
        if (!uniqueTexts.has(key)) {
          uniqueTexts.set(key, { text: row.procedureName, context: 'treatment_name' });
        }
      }
      if (row.description) {
        const key = `desc:${row.description}`;
        if (!uniqueTexts.has(key)) {
          uniqueTexts.set(key, { text: row.description, context: 'description' });
        }
      }
      if (row.procedureInfo) {
        const key = `info:${row.procedureInfo}`;
        if (!uniqueTexts.has(key)) {
          uniqueTexts.set(key, { text: row.procedureInfo, context: 'general' });
        }
      }
    }

    // --- Translate unique texts (with concurrency limit) ---
    const glossary = await getGlossary(tenantId);
    const translationMap = new Map<string, Partial<Record<TargetLang, string>>>();
    const concurrency = 3;
    const entries = Array.from(uniqueTexts.entries());

    for (let i = 0; i < entries.length; i += concurrency) {
      const chunk = entries.slice(i, i + concurrency);
      const results = await Promise.all(
        chunk.map(async ([key, { text, context }]) => {
          const res = await translate(text, targets, context, glossary);
          const mapped: Partial<Record<TargetLang, string>> = {};
          for (const t of targets) {
            mapped[t] = res.translations[t]?.text ?? '';
          }
          return { key, mapped };
        }),
      );
      for (const { key, mapped } of results) {
        translationMap.set(key, mapped);
      }
    }

    // --- Build per-row translation lookup keyed by rowNumber ---
    // prepareTranslatedRows expects Map keyed by "name:{rowNumber}", etc.
    const claudeTranslations = new Map<string, Partial<Record<TargetLang, string>>>();

    for (const row of parsed.rows) {
      if (row.procedureName) {
        const srcKey = `name:${row.procedureName}`;
        claudeTranslations.set(`name:${row.rowNumber}`, translationMap.get(srcKey) ?? {});
      }
      if (row.description) {
        const srcKey = `desc:${row.description}`;
        claudeTranslations.set(`desc:${row.rowNumber}`, translationMap.get(srcKey) ?? {});
      }
      if (row.procedureInfo) {
        const srcKey = `info:${row.procedureInfo}`;
        claudeTranslations.set(`info:${row.rowNumber}`, translationMap.get(srcKey) ?? {});
      }
    }

    // --- Generate translated rows ---
    const translatedRows = prepareTranslatedRows(parsed.rows, targets, claudeTranslations);

    // --- Generate one .xlsx per target language ---
    const files: Array<{ lang: TargetLang; fileName: string; base64: string }> = [];

    for (const target of targets) {
      const xlsxBuffer = writeTranslatedExcel(parsed, translatedRows, target);
      const base64 = Buffer.from(xlsxBuffer).toString('base64');
      const baseName = file.name.replace(/\.xlsx$/i, '');
      files.push({
        lang: target,
        fileName: `${baseName}_${target}.xlsx`,
        base64,
      });
    }

    return NextResponse.json({
      success: true,
      originalFile: file.name,
      rowCount: parsed.rows.length,
      uniqueTexts: uniqueTexts.size,
      targets,
      files,
    });
  } catch (error) {
    console.error('[translator/translate-excel] Error:', error);
    return NextResponse.json(
      { error: 'Excel translation failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
