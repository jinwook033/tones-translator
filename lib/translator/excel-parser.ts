/**
 * excel-parser.ts — Tones Clinic Excel format parser
 *
 * Handles the specific format used by Tones Clinic for monthly events:
 * - Sheet 1: Data (variable name like "월간 톤즈", "✧월간 톤즈", etc.)
 * - Sheet 2: _categoryList (114 fixed categories)
 * - Row 8: Column headers (B~M)
 * - Row 9: 중분류 category separator (G column has [CategoryName])
 * - Row 10+: Data rows (A="소분류")
 * - Columns F,G,H: Translation targets
 * - Columns J-M: Prices (preserve exactly)
 */

import * as XLSX from 'xlsx';
import type { ExcelRow, ParsedExcel, TargetLang, TranslatedExcelRow } from './types';
import { translateTag, translateVariant } from './glossary-engine';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// 2026-05-19 fix: XLSX bomb 방어 — buffer 사이즈 + 시트 row 수 상한.
const MAX_XLSX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_XLSX_ROWS = 50_000;

export function parseTonesExcel(buffer: ArrayBuffer, fileName: string): ParsedExcel {
  if (buffer.byteLength > MAX_XLSX_BUFFER_BYTES) {
    throw new Error(`Excel 파일이 너무 큽니다 (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB, 최대 10MB)`);
  }
  const workbook = XLSX.read(buffer, { type: 'array' });

  if (workbook.SheetNames.length < 1) {
    throw new Error('Excel file has no sheets');
  }

  // Sheet 1: main data (name varies)
  const dataSheetName = workbook.SheetNames[0];
  const dataSheet = workbook.Sheets[dataSheetName];

  // Sheet 2: _categoryList (optional)
  const categories: string[] = [];
  if (workbook.SheetNames.length >= 2) {
    const catSheet = workbook.Sheets[workbook.SheetNames[1]];
    const catData = XLSX.utils.sheet_to_json<Record<string, unknown>>(catSheet, { header: 1 });
    for (const row of catData) {
      const vals = Object.values(row);
      if (vals[0] && typeof vals[0] === 'string') {
        categories.push(vals[0]);
      }
    }
  }

  // Parse data sheet
  const range = XLSX.utils.decode_range(dataSheet['!ref'] ?? 'A1:M1');
  const rows: ExcelRow[] = [];
  let currentCategory = '';

  // 시술명 컬럼 위치 자동 감지 (월간 템플릿=G/6, 행사 템플릿=H/7 등 가변)
  // 컬럼 헤더는 데이터 시작(row 8) 바로 앞 row 7 (0-indexed = Excel row 8)에 위치
  const HEADER_ROW = 7;
  let COL_NAME = 6; // 기본값: G (월간 템플릿)
  for (let c = 5; c <= 10; c++) {
    const hdrCell = dataSheet[XLSX.utils.encode_cell({ r: HEADER_ROW, c })];
    if (String(hdrCell?.v ?? '').trim() === '시술명') { COL_NAME = c; break; }
  }
  const COL_DESC   = COL_NAME + 1;
  const COL_VAR    = COL_NAME + 2;
  const COL_MPRICE = COL_NAME + 3;
  const COL_RPRICE = COL_NAME + 4;
  const COL_DPRICE = COL_NAME + 5;
  const COL_DRATE  = COL_NAME + 6;

  // Start from row 9 (0-indexed: row 8).
  // 2026-05-19 fix: 공격자가 시트의 dimension(!ref)를 수백만 row로 선언해 OOM/CPU loop 유도하는 것 차단.
  const maxRow = Math.min(range.e.r, 8 + MAX_XLSX_ROWS);
  for (let r = 8; r <= maxRow; r++) {
    const getVal = (col: number): string => {
      const cell = dataSheet[XLSX.utils.encode_cell({ r, c: col })];
      if (!cell) return '';
      return String(cell.v ?? '').trim();
    };

    const getNum = (col: number): number | null => {
      const cell = dataSheet[XLSX.utils.encode_cell({ r, c: col })];
      if (!cell || cell.v === null || cell.v === undefined || cell.v === '') return null;
      const num = typeof cell.v === 'number' ? cell.v : parseFloat(String(cell.v));
      return isNaN(num) ? null : num;
    };

    const colA = getVal(0); // A

    // Category row (중분류)
    if (colA === '중분류') {
      const catName = getVal(COL_NAME); // 시술명 컬럼 위치와 동일
      if (catName) {
        currentCategory = catName;
      }
      continue;
    }

    // Data row (소분류)
    if (colA !== '소분류') continue;

    const procedureName = getVal(COL_NAME);
    if (!procedureName) continue;

    rows.push({
      rowNumber: r + 1, // 1-indexed for display
      category: currentCategory,
      subcategory: colA,
      multiValue: getVal(1),          // B
      tag1: getVal(2),                // C
      tag2: getVal(3),                // D
      tag3: getVal(4),                // E
      procedureInfo: getVal(5),       // F
      procedureName,                  // 시술명
      description: getVal(COL_DESC),  // 내용
      variant: getVal(COL_VAR),       // 횟수
      marketingPrice: getNum(COL_MPRICE),
      requiredPrice: getNum(COL_RPRICE),
      discountPrice: getNum(COL_DPRICE),
      discountRate: getVal(COL_DRATE),
    });
  }

  return {
    fileName,
    sheetName: dataSheetName,
    categories,
    rows,
    rawWorkbook: workbook,
  };
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Generate a translated Excel file preserving the original structure.
 * Only replaces cells F, G, H (and optionally C-E tags, I variant) with translations.
 */
export function writeTranslatedExcel(
  parsed: ParsedExcel,
  translatedRows: TranslatedExcelRow[],
  target: TargetLang,
): ArrayBuffer {
  // Clone the workbook by re-reading
  const wb = parsed.rawWorkbook as XLSX.WorkBook;
  const wsName = parsed.sheetName;
  const ws = wb.Sheets[wsName];

  if (!ws) throw new Error(`Sheet "${wsName}" not found`);

  // 시술명 컬럼 위치 자동 감지 (파서와 동일 로직 — row 7 = Excel row 8)
  let W_COL_NAME = 6;
  for (let c = 5; c <= 10; c++) {
    const hdrCell = ws[XLSX.utils.encode_cell({ r: 7, c })];
    if (String(hdrCell?.v ?? '').trim() === '시술명') { W_COL_NAME = c; break; }
  }
  const W_COL_DESC = W_COL_NAME + 1;
  const W_COL_VAR  = W_COL_NAME + 2;

  // Build a lookup by row number
  const rowMap = new Map<number, TranslatedExcelRow>();
  for (const tr of translatedRows) {
    rowMap.set(tr.rowNumber, tr);
  }

  // Update cells
  for (const [, tr] of rowMap) {
    const r = tr.rowNumber - 1; // 0-indexed

    const setCell = (col: number, value: string) => {
      if (!value) return;
      const addr = XLSX.utils.encode_cell({ r, c: col });
      if (!ws[addr]) {
        ws[addr] = { t: 's', v: value };
      } else {
        ws[addr].v = value;
      }
    };

    // Tags (C, D, E) — direct lookup
    if (tr.tag1_translated?.[target]) setCell(2, tr.tag1_translated[target]!);
    if (tr.tag2_translated?.[target]) setCell(3, tr.tag2_translated[target]!);
    if (tr.tag3_translated?.[target]) setCell(4, tr.tag3_translated[target]!);

    // Procedure info (F)
    if (tr.procedureInfo_translated?.[target]) setCell(5, tr.procedureInfo_translated[target]!);

    // Procedure name — 감지된 시술명 컬럼
    if (tr.procedureName_translated?.[target]) setCell(W_COL_NAME, tr.procedureName_translated[target]!);

    // Description — 시술명 + 1 (내용)
    if (tr.description_translated?.[target]) setCell(W_COL_DESC, tr.description_translated[target]!);

    // Variant — 시술명 + 2 (횟수)
    if (tr.variant_translated?.[target]) setCell(W_COL_VAR, tr.variant_translated[target]!);
  }

  // 중분류 헤더 번역
  const CATEGORY_TRANSLATIONS: Record<string, Record<string, string>> = {
    '[보톡스/윤곽주사/지방분해 데옥시콜산]': { en: '[Botox / Contour / Fat Dissolving Deoxycholic]', cn: '[肉毒素/轮廓针/溶脂]', sg: '[肉毒素/輪廓針/溶脂]', ja: '[ボトックス/輪郭注射/脂肪溶解]' },
    '[필러/실리프팅]': { en: '[Filler / Thread Lift]', cn: '[玻尿酸/线雕]', sg: '[玻尿酸/線雕]', ja: '[フィラー/糸リフト]' },
    '[리프팅]': { en: '[Lifting]', cn: '[提升]', sg: '[提升]', ja: '[リフティング]' },
    '[피부 관리/스킨부스터]': { en: '[Skincare / Skin Booster]', cn: '[皮肤管理/水光针]', sg: '[皮膚管理/水光針]', ja: '[スキンケア/スキンブースター]' },
    '[레이저]': { en: '[Laser]', cn: '[激光]', sg: '[激光]', ja: '[レーザー]' },
    '[톤즈 시그니처]': { en: "[Tone's SIGNATURE]", cn: "[Tone's SIGNATURE]", sg: "[Tone's SIGNATURE]", ja: "[Tone's SIGNATURE]" },
    '[제모]': { en: '[Hair Removal]', cn: '[脱毛]', sg: '[脫毛]', ja: '[脱毛]' },
    '[바디]': { en: '[Body]', cn: '[身体]', sg: '[身體]', ja: '[ボディ]' },
    '[수액/주사]': { en: '[IV Drip / Injection]', cn: '[输液/注射]', sg: '[輸液/注射]', ja: '[点滴/注射]' },
    '[다이어트]': { en: '[Body Slimming]', cn: '[瘦身]', sg: '[瘦身]', ja: '[ダイエット]' },
    '[점/문신제거]': { en: '[Mole / Tattoo Removal]', cn: '[祛痣/洗纹身]', sg: '[祛痣/洗紋身]', ja: '[ほくろ/タトゥー除去]' },
    '[모공/여드름/흉터]': { en: '[Pore / Acne / Scar]', cn: '[毛孔/痤疮/疤痕]', sg: '[毛孔/痤瘡/疤痕]', ja: '[毛穴/ニキビ/瘢痕]' },
    '[콜라겐 필러]': { en: '[Collagen Filler]', cn: '[胶原蛋白填充]', sg: '[膠原蛋白填充]', ja: '[コラーゲンフィラー]' },
    '[스킨부스터]': { en: '[Skin Booster]', cn: '[水光针]', sg: '[水光針]', ja: '[スキンブースター]' },
    '[다이어트/제모/건강주사]': { en: '[Body Slimming / Hair Removal / Health Injection]', cn: '[瘦身/脱毛/健康注射]', sg: '[瘦身/脫毛/健康注射]', ja: '[ダイエット/脱毛/健康注射]' },
    '[쥬베룩 아이 집중케어]': { en: '[Juvelook Eye Intensive Care]', cn: '[Juvelook 眼部集中护理]', sg: '[Juvelook 眼部集中護理]', ja: '[ジュベルック アイ 集中ケア]' },
  };

  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:M1');
  for (let r = 8; r <= range.e.r; r++) {
    const cellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cellA?.v === '중분류') {
      const catCell = ws[XLSX.utils.encode_cell({ r, c: W_COL_NAME })];
      if (catCell?.v) {
        const korean = String(catCell.v).trim();
        const trans = CATEGORY_TRANSLATIONS[korean]?.[target];
        if (trans) catCell.v = trans;
      }
    }
  }

  // 셀 너비 자동 맞춤
  const colWidths: number[] = [];
  for (let c = 0; c <= range.e.c; c++) {
    let maxLen = 8;
    for (let r = 0; r <= Math.min(range.e.r, 200); r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.v) {
        const len = String(cell.v).length;
        if (len > maxLen) maxLen = len;
      }
    }
    colWidths.push(Math.min(maxLen + 2, 60));
  }
  ws['!cols'] = colWidths.map(w => ({ wch: w }));

  // Write to buffer
  const output = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return output as ArrayBuffer;
}

/**
 * Prepare translated rows from parsed data.
 * Tags and variants use direct glossary lookup (no API call).
 * Procedure names and descriptions are translated by Claude.
 */
export function prepareTranslatedRows(
  rows: ExcelRow[],
  targets: TargetLang[],
  claudeTranslations: Map<string, Partial<Record<TargetLang, string>>>,
  glossaryEntries?: import('./types').GlossaryEntry[],
): TranslatedExcelRow[] {
  return rows.map((row) => {
    const result: TranslatedExcelRow = {
      ...row,
      procedureName_translated: {},
      description_translated: {},
      procedureInfo_translated: {},
      tag1_translated: {},
      tag2_translated: {},
      tag3_translated: {},
      variant_translated: {},
    };

    for (const target of targets) {
      // Tags — direct lookup, zero API calls
      result.tag1_translated[target] = translateTag(row.tag1, target);
      result.tag2_translated[target] = translateTag(row.tag2, target);
      result.tag3_translated[target] = translateTag(row.tag3, target);

      // Variant — direct lookup + glossary fallback
      result.variant_translated[target] = translateVariant(row.variant, target, glossaryEntries);

      // Procedure name — from Claude
      const nameKey = `name:${row.rowNumber}`;
      result.procedureName_translated[target] = claudeTranslations.get(nameKey)?.[target] ?? '';

      // Description — from Claude
      const descKey = `desc:${row.rowNumber}`;
      result.description_translated[target] = claudeTranslations.get(descKey)?.[target] ?? '';

      // Procedure info — from Claude or glossary
      const infoKey = `info:${row.rowNumber}`;
      result.procedureInfo_translated[target] = claudeTranslations.get(infoKey)?.[target] ?? '';
    }

    return result;
  });
}
