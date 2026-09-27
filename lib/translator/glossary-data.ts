/**
 * glossary-data.ts — Glossary data access layer
 *
 * 두 겹 저장: GLOSSARY_SEED(코드로 관리하는 검증된 용어) + data/glossary.json(화면에서 추가한 용어).
 * - SEED: 개발자가 코드로 관리하는 검증된 용어 (배포 시 반영)
 * - 파일: 웹 UI에서 추가·수정한 용어 (서버 재시작 후에도 유지)
 */

import type { GlossaryEntry } from './types';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// In-memory glossary store (SEED + DB runtime entries merged, per-tenant)
// 2026-05-19 fix: 멀티 테넌트 격리. 캐시·DB 모두 tenantId 분리.
// ---------------------------------------------------------------------------

const glossaryCache = new Map<number, GlossaryEntry[]>();
const dbLoadAttempted = new Set<number>();

/**
 * Get all glossary entries for a tenant. First call merges SEED + DB runtime entries.
 */
export async function getGlossary(tenantId: number): Promise<GlossaryEntry[]> {
  const cached = glossaryCache.get(tenantId);
  if (cached) return cached;
  const dbEntries = await loadRuntimeEntriesFromDB(tenantId);
  // DB 엔트리가 SEED와 겹치면 DB 우선 (사용자가 수정한 것)
  const seedMap = new Map(GLOSSARY_SEED.map(e => [e.korean, e]));
  for (const dbe of dbEntries) {
    seedMap.set(dbe.korean, { ...seedMap.get(dbe.korean), ...dbe });
  }
  const entries = [...seedMap.values()];
  glossaryCache.set(tenantId, entries);
  return entries;
}

/**
 * Add a new glossary entry at runtime. Saves to both memory + DB (per tenant).
 */
export async function addGlossaryEntry(tenantId: number, entry: GlossaryEntry): Promise<void> {
  const glossary = await getGlossary(tenantId);
  const existing = glossary.findIndex((e) => e.korean === entry.korean);
  if (existing >= 0) {
    glossary[existing] = { ...glossary[existing], ...entry, updated_at: new Date().toISOString() };
  } else {
    glossary.push({ ...entry, created_at: new Date().toISOString() });
  }
  await saveGlossaryEntryToDB(tenantId, entry);
}

/**
 * Remove a glossary entry. Removes from memory + DB (per tenant).
 */
export async function removeGlossaryEntry(tenantId: number, korean: string): Promise<boolean> {
  const glossary = await getGlossary(tenantId);
  const idx = glossary.findIndex((e) => e.korean === korean);
  if (idx >= 0) {
    glossary.splice(idx, 1);
    await removeGlossaryEntryFromDB(tenantId, korean);
    return true;
  }
  return false;
}

/**
 * Reset glossary to seed data. Clears DB runtime entries (per tenant).
 */
export async function resetGlossary(tenantId: number): Promise<void> {
  glossaryCache.set(tenantId, [...GLOSSARY_SEED]);
  await clearRuntimeEntriesFromDB(tenantId);
}

// ---------------------------------------------------------------------------
// 저장소 — 런타임에 추가한 용어를 data/glossary.json 에 둔다.
// 원본(blog-rank-multi)은 Supabase 를 썼지만, 이 앱은 단독으로 도는 도구라
// 파일 한 개로 충분하다. 서버를 껐다 켜도 남는다.
// ---------------------------------------------------------------------------

const FILE = () => path.join(process.cwd(), "data", "glossary.json");

function 읽기(): GlossaryEntry[] {
  try { return JSON.parse(fs.readFileSync(FILE(), "utf8")) as GlossaryEntry[]; } catch { return []; }
}
function 쓰기(list: GlossaryEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(list, null, 2));
  } catch (e) {
    console.error("[Glossary] 저장 실패:", e instanceof Error ? e.message : e);
  }
}

async function loadRuntimeEntriesFromDB(_tenantId: number): Promise<GlossaryEntry[]> {
  return 읽기();
}

async function saveGlossaryEntryToDB(_tenantId: number, entry: GlossaryEntry): Promise<void> {
  const list = 읽기();
  const i = list.findIndex((e) => e.korean === entry.korean);
  if (i >= 0) list[i] = { ...list[i], ...entry, updated_at: new Date().toISOString() };
  else list.push({ ...entry, created_at: new Date().toISOString() });
  쓰기(list);
}

async function removeGlossaryEntryFromDB(_tenantId: number, korean: string): Promise<void> {
  쓰기(읽기().filter((e) => e.korean !== korean));
}

async function clearRuntimeEntriesFromDB(_tenantId: number): Promise<void> {
  쓰기([]);
}

// ---------------------------------------------------------------------------
// SEED DATA — 213 entries from translation audit
// Device names will be updated with manufacturer-verified names
// ---------------------------------------------------------------------------

const GLOSSARY_SEED: GlossaryEntry[] = [
  // ═══════════════════════════════════════
  // BRAND (브랜드명 — 절대 번역 금지)
  // ═══════════════════════════════════════
  { korean: '톤즈의원', category: 'brand', en: "Tone's CLINIC", cn: "Tone's CLINIC", tw: "Tone's CLINIC", ja: 'トンズ医院', locked: true, note: 'NEVER translate as politician/議員/议员. NEVER use Chinese 通斯' },
  { korean: '톤즈클리닉', category: 'brand', en: "Tone's CLINIC", cn: "Tone's CLINIC", tw: "Tone's CLINIC", ja: 'トンズクリニック', locked: true },
  { korean: '톤즈', category: 'brand', en: "Tone's", cn: "Tone's", tw: "Tone's", ja: "Tone's", locked: true, note: 'Clinic brand name. NEVER Tonz/TONZ/通斯' },
  { korean: "TONE's CLINIC", category: 'brand', en: "Tone's CLINIC", cn: "Tone's CLINIC", tw: "Tone's CLINIC", ja: "Tone's CLINIC", locked: true },

  // ═══════════════════════════════════════
  // MEDICAL TERMS (의료 용어 — 동음이의어 해소)
  // ═══════════════════════════════════════
  { korean: '시술', category: 'general', en: 'treatment', cn: '疗程', tw: '療程', ja: '施術', locked: true, note: 'NEVER 手術/surgery' },
  { korean: '원장', category: 'general', en: 'Dr.', cn: '院长', tw: '院長', ja: '院長', locked: true, note: 'NEVER 元帳/ledger. Use Dr. in English' },
  { korean: '대표원장', category: 'general', en: 'Head Doctor', cn: '代表院长', tw: '代表院長', ja: '代表院長', locked: true },
  { korean: '의원', category: 'general', en: 'clinic', cn: '诊所', tw: '診所', ja: '医院', locked: true, note: 'NEVER 議員/politician' },
  { korean: '비급여', category: 'general', en: 'Non-insured treatment', cn: '自费项目', tw: '自費項目', ja: '自由診療', locked: true },
  { korean: '비급여진료비', category: 'menu', en: 'Non-insured Treatment Price List', cn: '自费项目价格表', tw: '自費項目價格表', ja: '自由診療料金表', locked: true },
  { korean: '수면마취', category: 'procedure', en: 'IV sedation', cn: '静脉麻醉', tw: '靜脈麻醉', ja: '静脈麻酔', locked: true },
  { korean: '재생관리', category: 'procedure', en: 'regeneration care', cn: '再生护理', tw: '再生護理', ja: '再生ケア', locked: false },
  { korean: '진정팩', category: 'procedure', en: 'calming mask', cn: '镇静面膜', tw: '鎮靜面膜', ja: '鎮静パック', locked: false },
  { korean: '시트팩', category: 'procedure', en: 'sheet mask', cn: '面膜贴', tw: '面膜貼', ja: 'シートマスク', locked: false },
  { korean: '모델링', category: 'procedure', en: 'modeling mask', cn: '软膜', tw: '軟膜', ja: 'モデリングマスク', locked: false },
  { korean: '압출', category: 'procedure', en: 'extraction', cn: '清痘', tw: '清痘', ja: '圧出', locked: false },
  { korean: '애교살', category: 'anatomy', en: 'aegyo-sal (under-eye fat pad)', cn: '卧蚕', tw: '臥蠶', ja: '涙袋', locked: true, substitute: true, note: 'NEVER leave as Korean 애교살 or transliterate as エギョサル' },
  { korean: '물톡스', category: 'procedure', en: 'Water Tox', cn: '水光注射', tw: '水光注射', ja: 'ウォータートックス', locked: true, note: 'Meso-botox/skin botox. NEVER 水毒素 (water toxin)' },
  { korean: '스케일링', category: 'procedure', en: 'Scaling', cn: '去角质', tw: '去角質', ja: 'スケーリング', locked: true, note: 'Skin exfoliation in clinic context. NEVER 洗牙 (dental scaling)' },
  { korean: '비타민', category: 'procedure', en: 'Vitamin', cn: '维生素', tw: '維生素', ja: 'ビタミン', locked: false, note: 'JA: ビタミン NOT ビッタミン' },
  { korean: '토닝팩', category: 'procedure', en: 'Toning Pack', cn: '净肤面膜', tw: '淨膚面膜', ja: 'トーニングパック', locked: true, note: 'NEVER 音调/音調 (musical tone)' },
  { korean: '톤즈존팩', category: 'procedure', en: "Tone's Zone Pack", cn: "Tone's Zone面膜", tw: "Tone's Zone面膜", ja: "Tone'sゾーンパック", locked: true, note: 'NEVER 音调一号/音調一號' },

  // ═══════════════════════════════════════
  // TREATMENT CATEGORIES (시술 카테고리)
  // ═══════════════════════════════════════
  { korean: '리프팅', category: 'category', en: 'Lifting', cn: '面部提升', tw: '拉提', ja: 'リフティング', locked: true, note: 'NEVER 举重/舉重/weightlifting/持ち上がる' },
  { korean: '보톡스', category: 'category', en: 'Botox', cn: '肉毒素', tw: '肉毒桿菌', ja: 'ボトックス', locked: true },
  { korean: '필러', category: 'category', en: 'Filler', cn: '填充剂', tw: '填充劑', ja: 'フィラー', locked: true },
  { korean: '실리프팅', category: 'category', en: 'Thread Lifting', cn: '线雕提升', tw: '線雕拉提', ja: '糸リフティング', locked: false },
  { korean: '제모', category: 'category', en: 'Hair Removal', cn: '脱毛', tw: '脫毛', ja: '脱毛', locked: true, substitute: false },
  { korean: '기미', category: 'condition', en: 'Melasma', cn: '黄褐斑', tw: '黃褐斑', ja: '肝斑', locked: true, note: 'NOT 雀斑(freckles)' },
  { korean: '여드름', category: 'condition', en: 'Acne', cn: '痤疮', tw: '痤瘡', ja: 'ニキビ', locked: true },
  { korean: '모공', category: 'condition', en: 'Pore', cn: '毛孔', tw: '毛孔', ja: '毛穴', locked: true },
  { korean: '토닝', category: 'category', en: 'Toning', cn: '净肤', tw: '淨膚', ja: 'トーニング', locked: true, note: 'NEVER 調子' },
  { korean: '스킨부스터', category: 'category', en: 'Skin Booster', cn: '皮肤补水', tw: '皮膚補水', ja: 'スキンブースター', locked: false },
  { korean: '윤곽주사', category: 'category', en: 'Contouring Injection', cn: '轮廓针', tw: '輪廓針', ja: '輪郭注射', locked: false },
  { korean: '지방분해', category: 'category', en: 'Lipolysis', cn: '脂肪溶解', tw: '脂肪溶解', ja: '脂肪溶解', locked: false },
  { korean: '데옥시콜산', category: 'category', en: 'Deoxycholic acid', cn: '脱氧胆酸', tw: '脫氧膽酸', ja: 'デオキシコール酸', locked: false },
  { korean: '수액', category: 'category', en: 'IV Drip', cn: '营养点滴', tw: '營養點滴', ja: '点滴', locked: true, note: 'NEVER 水疗(spa/hydrotherapy)' },
  { korean: '다이어트', category: 'category', en: 'Body Slimming', cn: '瘦身', tw: '瘦身', ja: 'ダイエット', locked: false },
  { korean: '점제거', category: 'category', en: 'Mole Removal', cn: '祛痣', tw: '祛痣', ja: 'ほくろ除去', locked: false, substitute: false },
  { korean: '문신제거', category: 'category', en: 'Tattoo Removal', cn: '纹身去除', tw: '紋身去除', ja: 'タトゥー除去', locked: false, substitute: false },
  { korean: '흉터', category: 'condition', en: 'Scar', cn: '疤痕', tw: '疤痕', ja: '瘢痕', locked: false },
  { korean: '홍조', category: 'condition', en: 'Facial Redness', cn: '泛红', tw: '泛紅', ja: '赤ら顔', locked: false, note: 'Broad category covering all redness conditions. NOT just Rosacea (specific diagnosis)' },
  { korean: '사마귀', category: 'condition', en: 'Wart', cn: '疣', tw: '疣', ja: 'いぼ', locked: false },
  { korean: '쥐젖', category: 'condition', en: 'Skin Tag', cn: '皮赘', tw: '皮贅', ja: 'スキンタグ', locked: false },

  // ═══════════════════════════════════════
  // DEVICES (의료기기 — 제조사 공식 홈페이지 확인 완료 2026-04-08)
  // ═══════════════════════════════════════
  { korean: '울쎄라', category: 'device', en: 'Ultherapy', cn: 'Ultherapy', tw: 'Ultherapy', ja: 'ウルセラ', locked: true, note: 'Merz Aesthetics (ultherapy.com). NEVER 美版超声刀' },
  { korean: '울쎄라피 프라임', category: 'device', en: 'Ultherapy PRIME', cn: 'Ultherapy PRIME', tw: 'Ultherapy PRIME', ja: 'ウルセラピープライム', locked: true, note: 'Merz Aesthetics. PRIME is all-caps per official branding' },
  { korean: '써마지', category: 'device', en: 'Thermage FLX', cn: '热玛吉 FLX', tw: '熱瑪吉 FLX', ja: 'サーマクールFLX', locked: true, note: 'Solta Medical/Bausch Health (thermage.com). CN=热玛吉, JA=サーマクール. NEVER 热魔法/熱魔法' },
  { korean: '인모드', category: 'device', en: 'InMode', cn: 'InMode', tw: 'InMode', ja: 'インモード', locked: true, note: 'InMode Ltd, Israel (inmodemd.com). Capital I + Capital M. NEVER "Inmode"' },
  { korean: '슈링크유니버스', category: 'device', en: 'Shurink Universe', cn: 'Shurink Universe', tw: 'Shurink Universe', ja: 'シュリンクユニバース', locked: true, note: 'Classys (classys.com). Use Shurink Universe consistently. NOT Shrink, NOT ULTRAFORMER MPT' },
  { korean: '슈링크 유니버스', category: 'device', en: 'Shurink Universe', cn: 'Shurink Universe', tw: 'Shurink Universe', ja: 'シュリンクユニバース', locked: true, note: 'Space variant of 슈링크유니버스' },
  { korean: '슈링크', category: 'device', en: 'Shurink', cn: 'Shurink', tw: 'Shurink', ja: 'シュリンク', locked: true, note: 'Classys. Coined brand name — NOT "Shrink"' },
  { korean: '올리지오', category: 'device', en: 'Oligio', cn: 'Oligio', tw: 'Oligio', ja: 'オリジオ', locked: true, note: 'WONTECH (wtlaser-en.com). RF device. NOT Oligo/Oligeo. Manufacturer is WONTECH not Shenb' },
  { korean: '볼뉴머', category: 'device', en: 'VOLNEWMER', cn: 'VOLNEWMER', tw: 'VOLNEWMER', ja: 'ボルニューマー', locked: true, note: 'Classys (classys.com). 6.78MHz monopolar RF. NOT Volnumer. US name=Everesse (Cartessa)' },
  { korean: '포텐자', category: 'device', en: 'Potenza', cn: 'Potenza', tw: 'Potenza', ja: 'ポテンツァ', locked: true, note: 'Jeisys Medical (jeisys-inc.com), distributed by Cynosure globally' },
  { korean: '온다', category: 'device', en: 'Onda', cn: 'Onda', tw: 'Onda', ja: 'オンダ', locked: true, note: 'DEKA M.E.L.A., Italy (dekalaser.com). JA=カタカナ統一' },
  { korean: '리프테라', category: 'device', en: 'Liftera', cn: 'Liftera', tw: 'Liftera', ja: 'リフテラ', locked: true, note: 'ASTERASYS (asterasys.com). TDT HIFU. NOT Classys (different HIFU system)' },
  { korean: '피코슈어', category: 'device', en: 'PicoSure', cn: 'PicoSure', tw: 'PicoSure', ja: 'ピコシュア', locked: true, note: 'Cynosure (cynosure.com)' },
  { korean: '피코플러스', category: 'device', en: 'PICOPLUS', cn: 'PICOPLUS', tw: 'PICOPLUS', ja: 'ピコプラス', locked: true, note: 'Lutronic/Cynosure Lutronic (cynosurelutronicemea.com)' },
  { korean: '프락셀', category: 'device', en: 'Fraxel', cn: 'Fraxel', tw: 'Fraxel', ja: 'フラクセル', locked: true, note: 'Solta Medical (fraxel.com). Latest=Fraxel FTX. NEVER Refractional' },
  { korean: '더마브이', category: 'device', en: 'DermaV', cn: 'DermaV', tw: 'DermaV', ja: 'ダーマV', locked: true, note: 'Lutronic/Cynosure Lutronic (cynosure.com). 532nm KTP + 1064nm Nd:YAG vascular laser' },
  { korean: '아쿠아필', category: 'device', en: 'Aquapeel', cn: 'Aquapeel', tw: 'Aquapeel', ja: 'アクアピール', locked: true, note: 'Generic hydradermabrasion term. Classys branded device=AQUAPURE. NEVER 水光針(different procedure)' },
  { korean: '젠틀', category: 'device', en: 'GentleMax Pro', cn: 'GentleMax Pro', tw: 'GentleMax Pro', ja: 'ジェントルマックスプロ', locked: true, note: 'Candela (candelamedical.com). Laser hair removal' },
  { korean: '헬제네시스', category: 'device', en: 'Laser Genesis', cn: 'Laser Genesis', tw: 'Laser Genesis', ja: 'レーザージェネシス', locked: true, note: 'Cutera (cutera.com). 1064nm Nd:YAG. KR name=헬제네시스, official=Laser Genesis' },
  { korean: '노블쉐이프', category: 'device', en: 'Noble Shape', cn: 'Noble Shape', tw: 'Noble Shape', ja: 'ノーブルシェイプ', locked: true, note: 'Eunsung Global (esglobal.co.kr). Body contouring (LLL+AMF+RF)' },
  { korean: '티타늄', category: 'device', en: 'Soprano Titanium', cn: 'Soprano Titanium', tw: 'Soprano Titanium', ja: 'ソプラノチタニウム', locked: true, note: 'Alma Lasers (alma-soprano.com). Tri-wavelength diode. KR=티타늄, official=Soprano Titanium' },
  { korean: '콜라겐리프팅', category: 'category', en: 'Collagen Lifting', cn: '胶原蛋白提升', tw: '膠原蛋白拉提', ja: 'コラーゲンリフティング', locked: false, note: 'Generic treatment category, not a specific device' },
  { korean: '라라필', category: 'device', en: 'LHALA Peel', cn: 'LHALA Peel', tw: 'LHALA Peel', ja: 'LHALA Peel', locked: true, note: 'H2MEDI/LHALALA brand (lhala.com). 4th-gen LHA chemical peel. NOT "LHA LALA Peel"' },
  { korean: '인모드FX', category: 'device', en: 'InMode FX', cn: 'InMode FX', tw: 'InMode FX', ja: 'インモードFX', locked: true, note: 'InMode fractional RF handpiece' },
  { korean: '인모드 포마', category: 'device', en: 'InMode Forma', cn: 'InMode Forma', tw: 'InMode Forma', ja: 'インモード フォルマ', locked: true, note: 'InMode non-invasive RF handpiece' },

  // ═══════════════════════════════════════
  // PRODUCTS (필러/주사/스킨부스터 제품)
  // ═══════════════════════════════════════
  { korean: '쥬베룩', category: 'product', en: 'Juvelook', cn: 'Juvelook', tw: 'Juvelook', ja: 'ジュベルック', locked: true, note: 'VAIM Co., Ltd. (NOT Caregen). NEVER Juvéderm (Allergan competitor)' },
  { korean: '쥬베룩 볼륨', category: 'product', en: 'Juvelook Volume', cn: 'Juvelook Volume', tw: 'Juvelook Volume', ja: 'ジュベルックボリューム', locked: true },
  { korean: '리쥬란', category: 'product', en: 'Rejuran', cn: 'Rejuran', tw: 'Rejuran', ja: 'リジュラン', locked: true, note: 'Pharmaresearch. PDRN based' },
  { korean: '리쥬란 힐러', category: 'product', en: 'Rejuran Healer', cn: 'Rejuran Healer', tw: 'Rejuran Healer', ja: 'リジュランヒーラー', locked: true, note: 'NEVER 修复针/修復針. Always use "Rejuran Healer" in CN/SG' },
  { korean: '리쥬란힐러', category: 'product', en: 'Rejuran Healer', cn: 'Rejuran Healer', tw: 'Rejuran Healer', ja: 'リジュランヒーラー', locked: true, note: 'No-space variant' },
  { korean: '리쥬란 아이힐러', category: 'product', en: 'Rejuran i (Eye Healer)', cn: 'Rejuran i', tw: 'Rejuran i', ja: 'リジュランアイ', locked: true },
  { korean: '스컬트라', category: 'product', en: 'Sculptra', cn: '塑妍萃 Sculptra', tw: 'Sculptra', ja: 'スカルプトラ', locked: true, note: 'Galderma. PDLLA. CN NMPA name=塑妍萃' },
  { korean: '레스틸렌', category: 'product', en: 'Restylane', cn: 'Restylane', tw: 'Restylane', ja: 'レスチレン', locked: true, note: 'Galderma. Use English-only in all languages (consistent with ATIERE, Belotero)' },
  { korean: '벨로테로', category: 'product', en: 'Belotero', cn: 'Belotero', tw: 'Belotero', ja: 'ベロテロ', locked: true, note: 'Merz Aesthetics (belotero.com)' },
  { korean: '필로르가', category: 'product', en: 'Filorga', cn: '菲洛嘉 Filorga', tw: 'Filorga', ja: 'フィロルガ', locked: true, note: 'Laboratoires Filorga/Colgate-Palmolive. CN=菲洛嘉. NCTF mesotherapy' },
  { korean: '레디어스', category: 'product', en: 'Radiesse', cn: 'Radiesse', tw: 'Radiesse', ja: 'レディエッセ', locked: true, note: 'Merz Aesthetics. CaHA biostimulator filler' },
  { korean: '리쥬란 HB', category: 'product', en: 'Rejuran HB', cn: 'Rejuran HB', tw: 'Rejuran HB', ja: 'リジュランHB', locked: true, note: 'PharmaResearch. HA + PDRN blend' },
  { korean: '코어톡스', category: 'product', en: 'Coretox', cn: 'Coretox', tw: 'Coretox', ja: 'コアトックス', locked: true, note: 'Medytox botulinum toxin. NEVER 纯毒素/純毒素 (literal translation)' },
  { korean: '순수톡신', category: 'product', en: 'Coretox', cn: 'Coretox', tw: 'Coretox', ja: 'コアトックス', locked: true, note: 'Korean name for Coretox. NEVER translate literally as pure toxin/纯毒素' },
  { korean: '리바이브', category: 'product', en: 'Belotero Revive', cn: 'Belotero Revive', tw: 'Belotero Revive', ja: 'ベロテロリバイブ', locked: true, note: 'Merz Aesthetics. Full name: Belotero Revive' },
  { korean: '엑소좀', category: 'product', en: 'Exosome', cn: '外泌体', tw: '外泌體', ja: 'エクソソーム', locked: false },
  { korean: '줄기세포', category: 'product', en: 'Stem Cell', cn: '干细胞', tw: '幹細胞', ja: '幹細胞', locked: false },
  { korean: '물광주사', category: 'product', en: 'Skin Booster Injection', cn: '水光针', tw: '水光針', ja: '水光注射', locked: false },
  { korean: '바디핏', category: 'product', en: 'BodyFit', cn: 'BodyFit', tw: 'BodyFit', ja: 'ボディフィット', locked: false },
  { korean: '슬림라인', category: 'product', en: 'SlimLine', cn: 'SlimLine', tw: 'SlimLine', ja: 'スリムライン', locked: false },
  { korean: '하이쿡스', category: 'product', en: 'HYCOOX', cn: 'HYCOOX', tw: 'HYCOOX', ja: 'ハイクックス', locked: true, note: 'NOBAMEDI. Official: HYCOOX (NOT HiCox)' },

  // ═══════════════════════════════════════
  // TREATMENT-SPECIFIC TERMS
  // ═══════════════════════════════════════
  { korean: '주름 보톡스', category: 'procedure', en: 'Wrinkle Botox', cn: '除皱肉毒素', tw: '除皺肉毒桿菌', ja: 'しわボトックス', locked: false },
  { korean: '사각턱보톡스', category: 'procedure', en: 'Jaw Botox', cn: '咬肌瘦脸针', tw: '咬肌瘦臉針', ja: 'エラボトックス', locked: false },
  { korean: '침샘보톡스', category: 'procedure', en: 'Salivary Gland Botox', cn: '腮腺肉毒素', tw: '腮腺肉毒桿菌', ja: '唾液腺ボトックス', locked: false },
  { korean: '스킨보톡스', category: 'procedure', en: 'Skin Botox', cn: '皮肤肉毒素', tw: '皮膚肉毒桿菌', ja: 'スキンボトックス', locked: false },
  { korean: '승모근', category: 'anatomy', en: 'Trapezius', cn: '斜方肌', tw: '斜方肌', ja: '僧帽筋', locked: false },
  { korean: '종아리', category: 'anatomy', en: 'Calf', cn: '小腿', tw: '小腿', ja: 'ふくらはぎ', locked: false },
  { korean: '턱끝필러', category: 'procedure', en: 'Chin Filler', cn: '下巴填充', tw: '下巴填充', ja: '顎先フィラー', locked: false },
  { korean: '입술필러', category: 'procedure', en: 'Lip Filler', cn: '丰唇', tw: '豐唇', ja: '唇フィラー', locked: false },
  { korean: '코필러', category: 'procedure', en: 'Nose Filler', cn: '鼻部填充', tw: '鼻部填充', ja: '鼻フィラー', locked: false },
  { korean: '이마필러', category: 'procedure', en: 'Forehead Filler', cn: '丰额', tw: '豐額', ja: '額フィラー', locked: false },
  { korean: '애교필러', category: 'procedure', en: 'Aegyo-sal (Under-eye) Filler', cn: '卧蚕填充', tw: '臥蠶填充', ja: '涙袋フィラー', locked: false },
  { korean: '팔자', category: 'anatomy', en: 'Nasolabial fold', cn: '法令纹', tw: '法令紋', ja: 'ほうれい線', locked: false, substitute: true },
  { korean: '민트실', category: 'procedure', en: 'Mint Thread', cn: '薄荷线', tw: '薄荷線', ja: 'ミントスレッド', locked: false },
  { korean: '볼륨실', category: 'procedure', en: 'Volume Thread', cn: '提升线', tw: '提升線', ja: 'ボリュームスレッド', locked: false },
  { korean: '서브시전', category: 'procedure', en: 'Subcision', cn: '皮下切割', tw: '皮下切割', ja: 'サブシジョン', locked: false },
  { korean: '피코 프락셀', category: 'procedure', en: 'Pico Fraxel', cn: '皮秒点阵', tw: '皮秒點陣', ja: 'ピコフラクセル', locked: true },
  { korean: '피코 바디토닝', category: 'procedure', en: 'Pico Body Toning', cn: '皮秒身体净肤', tw: '皮秒身體淨膚', ja: 'ピコボディトーニング', locked: false },

  // ═══════════════════════════════════════
  // BODY PARTS (부위)
  // ═══════════════════════════════════════
  { korean: '이마', category: 'anatomy', en: 'forehead', cn: '额头', tw: '額頭', ja: 'おでこ', locked: false },
  { korean: '미간', category: 'anatomy', en: 'glabella', cn: '眉间', tw: '眉間', ja: '眉間', locked: false },
  { korean: '콧등', category: 'anatomy', en: 'nose bridge', cn: '鼻梁', tw: '鼻樑', ja: '鼻筋', locked: false },
  { korean: '눈가', category: 'anatomy', en: "crow's feet area", cn: '鱼尾纹区', tw: '魚尾紋區', ja: '目尻', locked: false, substitute: true },
  { korean: '눈밑', category: 'anatomy', en: 'under-eye', cn: '眼下', tw: '眼下', ja: '目の下', locked: false },
  { korean: '자갈턱', category: 'anatomy', en: 'dimpled chin', cn: '橘皮下巴', tw: '橘皮下巴', ja: '梅干しアゴ', locked: true, substitute: true, note: 'Mentalis muscle overactivity causing pebbly chin. NOT jawline (that is 턱라인). Treat with botox' },
  { korean: '사각턱', category: 'anatomy', en: 'square jaw', cn: '咬肌', tw: '咬肌', ja: 'エラ', locked: false },
  { korean: '풀페이스', category: 'anatomy', en: 'full face', cn: '全脸', tw: '全臉', ja: 'フルフェイス', locked: false },
  { korean: '나비존', category: 'anatomy', en: 'butterfly zone', cn: '蝶形区', tw: '蝶形區', ja: 'バタフライゾーン', locked: false, substitute: true },
  { korean: '턱라인', category: 'anatomy', en: 'jawline', cn: '下颌线', tw: '下顎線', ja: '顎ライン', locked: false },

  // ═══════════════════════════════════════
  // LOCATION (지점/역명 — 공식 영문명)
  // ═══════════════════════════════════════
  { korean: '강남', category: 'location', en: 'Gangnam', cn: '江南', tw: '江南', ja: '江南', locked: true },
  { korean: '명동', category: 'location', en: 'Myeongdong', cn: '明洞', tw: '明洞', ja: '明洞', locked: true },
  { korean: '건대입구역', category: 'location', en: 'Konkuk Univ. Station', cn: '建大入口站', tw: '建大入口站', ja: '建大入口駅', locked: true, note: 'NOT 建国大学分校' },
  { korean: '건대', category: 'location', en: 'Geondae', cn: '建大', tw: '建大', ja: '建大', locked: true },
  { korean: '부산서면', category: 'location', en: 'Busan Seomyeon', cn: '釜山西面', tw: '釜山西面', ja: '釜山西面', locked: true },
  { korean: '인천부평', category: 'location', en: 'Incheon Bupyeong', cn: '仁川富平', tw: '仁川富平', ja: '仁川富平', locked: true },
  { korean: '홍대입구역', category: 'location', en: 'Hongik Univ. Station', cn: '弘大入口站', tw: '弘大入口站', ja: '弘大入口駅', locked: true },
  { korean: '일산', category: 'location', en: 'Ilsan', cn: '一山', tw: '一山', ja: '一山', locked: true, note: 'NEVER 日产/日產 (Nissan car brand)' },
  { korean: '분당', category: 'location', en: 'Bundang', cn: '盆唐', tw: '盆唐', ja: '盆唐', locked: true },
  { korean: '잠실', category: 'location', en: 'Jamsil', cn: '蚕室', tw: '蠶室', ja: '蚕室', locked: true },
  { korean: '의정부', category: 'location', en: 'Uijeongbu', cn: '议政府', tw: '議政府', ja: '議政府', locked: true },
  { korean: '안양범계', category: 'location', en: 'Anyang Beomgye', cn: '安养范溪', tw: '安養範溪', ja: '安養範渓', locked: true, note: 'NOT 凡溪' },
  { korean: '수원광교', category: 'location', en: 'Suwon Gwanggyo', cn: '水原光教', tw: '水原光教', ja: '水原光教', locked: true },
  { korean: '동탄', category: 'location', en: 'Dongtan', cn: '东滩', tw: '東灘', ja: '東灘', locked: true },
  { korean: '하남', category: 'location', en: 'Hanam', cn: '河南', tw: '河南', ja: '河南', locked: true },
  { korean: '광명', category: 'location', en: 'Gwangmyeong', cn: '光明', tw: '光明', ja: '光明', locked: true },
  { korean: '평택', category: 'location', en: 'Pyeongtaek', cn: '平泽', tw: '平澤', ja: '平沢', locked: true },
  { korean: '용인', category: 'location', en: 'Yongin', cn: '龙仁', tw: '龍仁', ja: '龍仁', locked: true },
  { korean: '부천', category: 'location', en: 'Bucheon', cn: '富川', tw: '富川', ja: '富川', locked: true },
  { korean: '대전둔산', category: 'location', en: 'Daejeon Dunsan', cn: '大田屯山', tw: '大田屯山', ja: '大田屯山', locked: true },
  { korean: '인천검단', category: 'location', en: 'Incheon Geomdan', cn: '仁川黔丹', tw: '仁川黔丹', ja: '仁川黔丹', locked: true },

  // ═══════════════════════════════════════
  // TAGS (UI 태그 — 직접 매핑, API 불필요)
  // ═══════════════════════════════════════
  { korean: '가성비', category: 'tag', en: 'Cost-effective', cn: '高性价比', tw: '高性價比', ja: 'コスパ◎', locked: true },
  { korean: '20/30대 추천', category: 'tag', en: 'For 20s-30s', cn: '推荐20-30岁', tw: '推薦20-30歲', ja: '20-30代おすすめ', locked: true },
  { korean: '40/50대 추천', category: 'tag', en: 'For 40s-50s', cn: '推荐40-50岁', tw: '推薦40-50歲', ja: '40-50代おすすめ', locked: true },
  { korean: '원장 픽', category: 'tag', en: "Director's Pick", cn: '院长推荐', tw: '院長推薦', ja: '院長のおすすめ', locked: true },

  // ═══════════════════════════════════════
  // UI/NAVIGATION TERMS
  // ═══════════════════════════════════════
  { korean: '이벤트', category: 'general', en: 'Promotions', cn: '优惠活动', tw: '優惠活動', ja: 'キャンペーン', locked: true, note: 'In clinic context = promotions, NOT "event"' },
  { korean: '이용약관', category: 'menu', en: 'Terms of Service', cn: '使用条款', tw: '使用條款', ja: '利用規約', locked: true },
  { korean: '개인정보처리방침', category: 'menu', en: 'Privacy Policy', cn: '个人信息处理方针', tw: '個人資訊處理方針', ja: '個人情報取扱方針', locked: true },
  { korean: '사랑나눔', category: 'menu', en: 'Community Giving', cn: '公益分享', tw: '愛心分享', ja: '愛の分かち合い', locked: false },
  { korean: '전국 지점', category: 'menu', en: 'Nationwide Branches', cn: '全国分院', tw: '全國分院', ja: '全国支院', locked: false },
  { korean: '의료진 소개', category: 'menu', en: 'Our Doctors', cn: '医疗团队', tw: '醫療團隊', ja: '医療チーム紹介', locked: false },
  { korean: '시술 예약', category: 'menu', en: 'Book Treatment', cn: '预约疗程', tw: '預約療程', ja: '施術予約', locked: true, note: 'NEVER 预约手术/手術を予約' },

  // ═══════════════════════════════════════
  // PERSON NAMES (의사 이름 — 음역 매핑)
  // These should be populated per-clinic. Below are known names from audit.
  // ═══════════════════════════════════════
  { korean: '이동선', category: 'person', en: 'Lee Dong-seon', cn: '李东善', tw: '李東善', ja: 'イ・ドンソン', locked: true, note: 'NEVER "Moving line"/移动线/移動線' },
  { korean: '황아름', category: 'person', en: 'Hwang A-reum', cn: '黄雅凛', tw: '黃雅凜', ja: 'ファン・アルム', locked: true, note: 'Standardize: one Hanja set only' },
  { korean: '양재영', category: 'person', en: 'Yang Jae-young', cn: '梁宰荣', tw: '梁宰榮', ja: 'ヤン・ジェヨン', locked: true },
  { korean: '박해든', category: 'person', en: 'Park Hae-deun', cn: '朴海登', tw: '朴海登', ja: 'パク・ヘドゥン', locked: true },
  { korean: '권대율', category: 'person', en: 'Kwon Dae-yul', cn: '权大律', tw: '權大律', ja: 'クォン・デユル', locked: true },
  { korean: '박지원', category: 'person', en: 'Park Ji-won', cn: '朴智媛', tw: '朴智媛', ja: 'パク・ジウォン', locked: true },
  { korean: '문대곤', category: 'person', en: 'Moon Dae-gon', cn: '文大根', tw: '文大根', ja: 'ムン・デゴン', locked: true },
  { korean: '이승준', category: 'person', en: 'Lee Seung-jun', cn: '李承俊', tw: '李承俊', ja: 'イ・スンジュン', locked: true },
  { korean: '이성원', category: 'person', en: 'Lee Seong-won', cn: '李成元', tw: '李成元', ja: 'イ・ソンウォン', locked: true },
  { korean: '박지호', category: 'person', en: 'Park Ji-ho', cn: '朴智浩', tw: '朴智浩', ja: 'パク・ジホ', locked: true },
  { korean: '최나래', category: 'person', en: 'Choi Na-rae', cn: '崔娜莱', tw: '崔娜萊', ja: 'チェ・ナレ', locked: true },
  { korean: '김보미', category: 'person', en: 'Kim Bo-mi', cn: '金宝美', tw: '金寶美', ja: 'キム・ボミ', locked: true },
  { korean: '이혜영', category: 'person', en: 'Lee Hye-young', cn: '李慧英', tw: '李慧英', ja: 'イ・ヘヨン', locked: true },

  // ═══════════════════════════════════════
  // EQUIPMENT (장비 59종)
  // ═══════════════════════════════════════
  { korean: '울쎄라 피프라임', category: 'equipment', en: 'Ultherapy Prime', cn: 'Ultherapy Prime', tw: 'Ultherapy Prime', ja: 'ウルセラ プライム', locked: true, note: 'Merz Aesthetics. NOT "P-Prime". Official: Ultherapy PRIME' },
  { korean: '에어젯2.0', category: 'equipment', en: 'AirJet2', cn: 'AirJet2', tw: 'AirJet2', ja: 'エアジェット2', locked: false, note: 'Union Medical. NOT "AirJet 2.0"' },
  { korean: '코레지2.0', category: 'equipment', en: 'Corage 2.0', cn: 'Corage 2.0', tw: 'Corage 2.0', ja: 'コラージュ2.0', locked: false },
  { korean: 'LDM', category: 'equipment', en: 'LDM', cn: 'LDM', tw: 'LDM', ja: 'LDM', locked: false },
  { korean: '인텐스울트라', category: 'equipment', en: 'Intense Ultra', cn: 'Intense Ultra', tw: 'Intense Ultra', ja: 'インテンスウルトラ', locked: false },
  { korean: '리프테라2', category: 'equipment', en: 'Liftera2', cn: 'Liftera2', tw: 'Liftera2', ja: 'リフテラ2', locked: true, note: 'ASTERASYS. NOT Liftera-V (different model)' },
  { korean: '텐써마', category: 'equipment', en: '10THERMA', cn: '10THERMA', tw: '10THERMA', ja: 'テンサーマ', locked: false },
  { korean: '파셀라', category: 'equipment', en: 'FASCELLA', cn: 'FASCELLA', tw: 'FASCELLA', ja: 'ファセラ', locked: false },
  { korean: '리니어지', category: 'equipment', en: 'LinearZ', cn: 'LinearZ', tw: 'LinearZ', ja: 'リニアZ', locked: false },
  { korean: '텐쎄라', category: 'equipment', en: '10THERA', cn: '10THERA', tw: '10THERA', ja: 'テンセラ', locked: false },
  { korean: '튠', category: 'equipment', en: 'TUNE Face', cn: 'TUNE Face', tw: 'TUNE Face', ja: 'チューン', locked: false },
  { korean: '리브이', category: 'equipment', en: 'Re:V', cn: 'Re:V', tw: 'Re:V', ja: 'リブイ', locked: true, note: 'Suction-shot RF. NOT "LiV"' },
  { korean: '플루엣', category: 'equipment', en: 'Fluet', cn: 'Fluet', tw: 'Fluet', ja: 'フルエット', locked: true, note: 'Jeisys Medical. Fractional microneedle RF device' },
  { korean: '버츄RF', category: 'equipment', en: 'VirtueRF', cn: 'VirtueRF', tw: 'VirtueRF', ja: 'バーチュRF', locked: false },
  { korean: '브이로 어드밴스', category: 'equipment', en: 'V-RO Advance', cn: 'V-RO Advance', tw: 'V-RO Advance', ja: 'ブイロ アドバンス', locked: false },
  { korean: '클라리티', category: 'equipment', en: 'Clarity II', cn: 'Clarity II', tw: 'Clarity II', ja: 'クラリティ', locked: false },
  { korean: '코피지', category: 'equipment', en: 'Copige', cn: 'Copige', tw: 'Copige', ja: 'コピジ', locked: true, note: 'Comedone extraction device/method. Brand name = Copige' },
  { korean: '아그네스', category: 'equipment', en: 'Agnes RF', cn: 'Agnes RF', tw: 'Agnes RF', ja: 'アグネス', locked: false },
  { korean: 'V 레이저', category: 'equipment', en: 'Vbeam Laser', cn: 'Vbeam Laser', tw: 'Vbeam Laser', ja: 'Vビームレーザー', locked: true, note: 'Candela. Official: Vbeam (no hyphen, lowercase b)' },
  { korean: '피코케이', category: 'equipment', en: 'PICO-K', cn: 'PICO-K', tw: 'PICO-K', ja: 'ピコK', locked: true, note: 'Speclipse. Official with hyphen: PICO-K' },
  { korean: '피코케어', category: 'equipment', en: 'PICOCARE', cn: 'PICOCARE', tw: 'PICOCARE', ja: 'ピコケア', locked: true, note: 'WONTECH. Official all-caps: PICOCARE' },
  { korean: 'IPL (토닝)', category: 'equipment', en: 'IPL Toning', cn: 'IPL Toning', tw: 'IPL Toning', ja: 'IPLトーニング', locked: false },
  { korean: 'IPL (셀렉)', category: 'equipment', en: 'IPL Cellec', cn: 'IPL Cellec', tw: 'IPL Cellec', ja: 'IPLセレック', locked: false },
  { korean: '루카스 (토닝)', category: 'equipment', en: 'LUCAS Toning', cn: 'LUCAS Toning', tw: 'LUCAS Toning', ja: 'ルカス トーニング', locked: false },
  { korean: '피콜로 피코레이저', category: 'equipment', en: 'PicoLO', cn: 'PicoLO', tw: 'PicoLO', ja: 'ピコロ', locked: true, note: 'LASEROPTEK (picololaser.com). NOT "Piccolo". Pico+LO(Laseroptek)' },
  { korean: '스타워커', category: 'equipment', en: 'StarWalker', cn: 'StarWalker', tw: 'StarWalker', ja: 'スターウォーカー', locked: false },
  { korean: '맥슈어', category: 'equipment', en: 'MaxSure', cn: 'MaxSure', tw: 'MaxSure', ja: 'マックスシュア', locked: false },
  { korean: '네오빔', category: 'equipment', en: 'NEOBEAM', cn: 'NEOBEAM', tw: 'NEOBEAM', ja: 'ネオビーム', locked: true, note: 'Union Medical. Official all-caps' },
  { korean: '엑셀브이', category: 'equipment', en: 'excel V', cn: 'excel V', tw: 'excel V', ja: 'エクセルV', locked: true, note: 'Cutera. Official lowercase e: excel V' },
  { korean: '에코2', category: 'equipment', en: 'eCO2 Plus', cn: 'eCO2 Plus', tw: 'eCO2 Plus', ja: 'eCO2プラス', locked: false },
  { korean: '시크릿', category: 'equipment', en: 'Secret RF', cn: 'Secret RF', tw: 'Secret RF', ja: 'シークレットRF', locked: true, note: 'Cutera/Ilooda. Keep English brand name in CN/SG (not 电波飞针)' },
  { korean: '아큐토닝', category: 'equipment', en: 'ACCUTONING', cn: 'ACCUTONING', tw: 'ACCUTONING', ja: 'アキュトーニング', locked: true, note: 'K.L Global. Official: ACCUTONING' },
  { korean: '젠틀맥스프로', category: 'equipment', en: 'GentleMax Pro', cn: 'GentleMax Pro', tw: 'GentleMax Pro', ja: 'ジェントルマックスプロ', locked: false },
  { korean: '젠틀맥스프로 플러스', category: 'equipment', en: 'GentleMax Pro Plus', cn: 'GentleMax Pro Plus', tw: 'GentleMax Pro Plus', ja: 'ジェントルマックスプロ プラス', locked: false },
  { korean: '아포지플러스', category: 'equipment', en: 'Apogee+', cn: 'Apogee+', tw: 'Apogee+', ja: 'アポジープラス', locked: false },
  { korean: '아포지 엘리트 플러스', category: 'equipment', en: 'Apogee Elite+', cn: 'Apogee Elite+', tw: 'Apogee Elite+', ja: 'アポジー エリートプラス', locked: false },
  { korean: '아리온', category: 'equipment', en: 'Arion', cn: 'Arion', tw: 'Arion', ja: 'アリオン', locked: false },
  { korean: '헬리오스', category: 'equipment', en: 'Helios III', cn: 'Helios III', tw: 'Helios III', ja: 'ヘリオスIII', locked: false },
  { korean: 'CO2', category: 'equipment', en: 'CO2 Laser', cn: 'CO2 Laser', tw: 'CO2 Laser', ja: 'CO2レーザー', locked: false },
  { korean: '어븀야그', category: 'equipment', en: 'Er:YAG Laser', cn: 'Er:YAG Laser', tw: 'Er:YAG Laser', ja: 'エルビウムYAGレーザー', locked: false },
  { korean: '아비오', category: 'equipment', en: 'AVVIO', cn: 'AVVIO', tw: 'AVVIO', ja: 'アビオ', locked: true, note: 'WONTECH. Official: AVVIO (double V)' },
  { korean: '루트로닉', category: 'equipment', en: 'Lutronic', cn: 'Lutronic', tw: 'Lutronic', ja: 'ルートロニック', locked: false },
  { korean: '애플토닝', category: 'equipment', en: 'Apple Toning', cn: 'Apple Toning', tw: 'Apple Toning', ja: 'アップルトーニング', locked: false },
  { korean: '리팟', category: 'equipment', en: 'REEPOT', cn: 'REEPOT', tw: 'REEPOT', ja: 'リポット', locked: true, note: 'Classys/Ilooda (classys.com/product/reepot). NOT "LiPot"' },
  { korean: '라비앙', category: 'equipment', en: 'Lavieen', cn: 'Lavieen', tw: 'Lavieen', ja: 'ラビアン', locked: true, note: 'WONTECH (wtlaser-en.com/lavieen). NOT "Lavian"' },
  { korean: '이온자임', category: 'equipment', en: 'Ionzyme', cn: 'Ionzyme', tw: 'Ionzyme', ja: 'イオンザイム', locked: false },
  { korean: '오투덤', category: 'equipment', en: 'O2toDerm', cn: 'O2toDerm', tw: 'O2toDerm', ja: 'O2トゥダーム', locked: true, note: 'TRISYS (o2toderm.co.kr). Lowercase t' },
  { korean: '이온토손', category: 'equipment', en: 'Iontoson', cn: 'Iontoson', tw: 'Iontoson', ja: 'イオントソン', locked: false },
  { korean: '크라이오셀', category: 'equipment', en: 'CryoCell', cn: 'CryoCell', tw: 'CryoCell', ja: 'クライオセル', locked: false },
  { korean: '오메가라이트', category: 'equipment', en: 'Omega Light', cn: 'Omega Light', tw: 'Omega Light', ja: 'オメガライト', locked: false },
  { korean: '스킨블리', category: 'equipment', en: 'SkinBly', cn: 'SkinBly', tw: 'SkinBly', ja: 'スキンブリー', locked: false },
  { korean: '코어스컬프', category: 'equipment', en: 'CoreSculpt', cn: 'CoreSculpt', tw: 'CoreSculpt', ja: 'コアスカルプト', locked: false, note: 'One word, capital S' },
  { korean: '울핏', category: 'equipment', en: 'Ulfit', cn: 'Ulfit', tw: 'Ulfit', ja: 'ウルフィット', locked: false },
  { korean: '바디 인모드', category: 'equipment', en: 'Body InMode', cn: 'Body InMode', tw: 'Body InMode', ja: 'ボディ インモード', locked: false },
  { korean: '더마샤인', category: 'equipment', en: 'DermaShine', cn: 'DermaShine', tw: 'DermaShine', ja: 'ダーマシャイン', locked: true, note: 'Huons Meditech. Capital S only, not all-caps SHINE' },
  { korean: '에어눅스', category: 'equipment', en: 'AirNux', cn: 'AirNux', tw: 'AirNux', ja: 'エアナックス', locked: false },
  { korean: '마크뷰', category: 'equipment', en: 'Mark-Vu', cn: 'Mark-Vu', tw: 'Mark-Vu', ja: 'マークビュー', locked: true, note: 'PSI Plus. Official with hyphen: Mark-Vu' },
  { korean: '메타뷰', category: 'equipment', en: 'MetaVu', cn: 'MetaVu', tw: 'MetaVu', ja: 'メタビュー', locked: false },
  { korean: '아발란체', category: 'equipment', en: 'AvalancheLase', cn: 'AvalancheLase', tw: 'AvalancheLase', ja: 'アバランチレイズ', locked: true, note: 'Fotona (fotona.com). Official: AvalancheLase®. JA=レイズ(not レーズ)' },
  { korean: '올타이트', category: 'equipment', en: 'Alltite', cn: 'Alltite', tw: 'Alltite', ja: 'オールタイト', locked: true, note: 'Innoxus. Official: Alltite (NOT AllTight)' },

  // ═══════════════════════════════════════
  // TREATMENT (시술 27종)
  // ═══════════════════════════════════════
  { korean: '지방분해주사', category: 'procedure', en: 'Fat Dissolving Injection', cn: '溶脂针', tw: '溶脂針', ja: '脂肪溶解注射', locked: false },
  { korean: '피코토닝', category: 'procedure', en: 'Pico Toning', cn: '皮秒调色', tw: '皮秒調色', ja: 'ピコトーニング', locked: false },
  { korean: '레이저제모', category: 'procedure', en: 'Laser Hair Removal', cn: '激光脱毛', tw: '激光脫毛', ja: 'レーザー脱毛', locked: false },
  { korean: '주름보톡스', category: 'procedure', en: 'Wrinkle Botox', cn: '除皱针', tw: '除皺針', ja: 'しわボトックス', locked: false },
  { korean: '승모근보톡스', category: 'procedure', en: 'Trapezius Botox', cn: '瘦肩针', tw: '瘦肩針', ja: '僧帽筋ボトックス', locked: false },
];

export { GLOSSARY_SEED };
