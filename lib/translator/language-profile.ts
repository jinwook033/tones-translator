// language-profile.ts — 언어별 번역 설정
//
// 2026-09-16: 언어별 금지표현·예문·문체규칙이 prompt-builder.ts 소스 안에 박혀 있어서
// 일본인·중국인 검수자가 직접 고칠 수 없었다. 데이터로 빼내 화면에서 편집 가능하게 만든다.
//
// 용어집과 같은 두 겹 구조다.
//   SEED                          코드로 관리하는 기본값 (배포에 포함, git 이력에 남음)
//   data/language-profiles.json   화면에서 고친 내용 (서버를 껐다 켜도 유지)
// 같은 언어가 양쪽에 있으면 파일 쪽이 이긴다 — 사람이 고친 것이므로.

import * as fs from 'fs';
import * as path from 'path';
import type { TargetLang } from './types';

/** 대조 예문 한 쌍. few-shot 은 번역 품질에 가장 크게 작용하는 요소다. */
export interface FewShotExample {
  source: string;  // 원문 (ko 프로필만 영어가 원문)
  bad: string;     // 이렇게 나오면 안 된다
  good: string;    // 이렇게 나와야 한다
  reason: string;  // 왜 — 검수자가 남기는 근거
}

export interface LanguageProfile {
  lang: TargetLang;
  label: string;           // 日本語
  region: string;          // 일본
  rules: string;           // 문체·표기·단위 규칙 (자유 서술)
  antiPatterns: string[];  // 절대 나오면 안 되는 표현
  examples: FewShotExample[];
  updatedAt?: string;
  updatedBy?: string;      // 누가 고쳤는지 (예: "일본어 검수 - 사토")
}

// ---------------------------------------------------------------------------
// 파일 저장 — data/language-profiles.json
// ---------------------------------------------------------------------------

const FILE = () => path.join(process.cwd(), 'data', 'language-profiles.json');

function readOverrides(): Partial<Record<TargetLang, LanguageProfile>> {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  } catch {
    return {};
  }
}

function writeOverrides(all: Partial<Record<TargetLang, LanguageProfile>>): void {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(all, null, 2));
  } catch (e) {
    console.error('[LanguageProfile] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

// 프롬프트 캐시가 걸리려면 같은 요청에 대해 프로필이 바이트 단위로 같아야 한다.
// 메모리에 캐시하고, 저장할 때만 비운다.
let cache: Partial<Record<TargetLang, LanguageProfile>> | null = null;

function loadAll(): Record<TargetLang, LanguageProfile> {
  if (!cache) {
    const overrides = readOverrides();
    cache = {};
    for (const lang of Object.keys(LANGUAGE_PROFILE_SEED) as TargetLang[]) {
      cache[lang] = overrides[lang] ?? LANGUAGE_PROFILE_SEED[lang];
    }
  }
  return cache as Record<TargetLang, LanguageProfile>;
}

/** 한 언어의 설정. 화면에서 고친 게 있으면 그게 우선. */
export function getLanguageProfile(lang: TargetLang): LanguageProfile {
  return loadAll()[lang] ?? LANGUAGE_PROFILE_SEED.en;
}

export function getAllLanguageProfiles(): LanguageProfile[] {
  const all = loadAll();
  return (Object.keys(LANGUAGE_PROFILE_SEED) as TargetLang[]).map((l) => all[l]);
}

/** 화면에서 고친 설정을 저장한다. 다음 번역부터 바로 반영된다. */
export function saveLanguageProfile(profile: LanguageProfile): void {
  const all = readOverrides();
  all[profile.lang] = { ...profile, updatedAt: new Date().toISOString() };
  writeOverrides(all);
  cache = null;
}

/** 이 언어를 코드 기본값으로 되돌린다. */
export function resetLanguageProfile(lang: TargetLang): void {
  const all = readOverrides();
  delete all[lang];
  writeOverrides(all);
  cache = null;
}

/** 코드 기본값에서 얼마나 달라졌는지 — 화면에 "수정됨" 표시용. */
export function isCustomized(lang: TargetLang): boolean {
  return readOverrides()[lang] !== undefined;
}

// ---------------------------------------------------------------------------
// SEED — prompt-builder.ts 에 하드코딩돼 있던 내용을 그대로 옮긴 것
// ---------------------------------------------------------------------------

export const LANGUAGE_PROFILE_SEED: Record<TargetLang, LanguageProfile> = {
  en: {
    lang: 'en',
    label: 'English',
    region: '영미권',
    rules: `TARGET LANGUAGE: English
REGISTER: Professional medical aesthetics marketing — patient-facing, warm but authoritative.
SCRIPT: Latin alphabet only.
STYLE:
- Use active voice: "smooths wrinkles" not "wrinkles are smoothed"
- Use "treatment" for 시술 (NEVER "surgery" or "procedure" in non-surgical context)
- Prefer concise, benefit-focused phrasing over literal descriptions
- Body areas: forehead, glabella, crow's feet area, under-eye, nose bridge, jawline
- Title Case for treatment names (Modeling Mask, Regeneration Care)
UNITS:
- Preserve cc, U, shots exactly
- ONDA energy: always "J" (Joules) — 줄 in ONDA context = J, NOT lines
- Currency: keep KRW as-is with ₩ or "KRW"
- 국산 → "Korean" or "Domestic" (means Korean-made, NOT Chinese-made)`,
    antiPatterns: [
      '"Moving line" for person name 이동선',
      '"politician" or "legislator" for 의원 (must be "clinic")',
      '"surgery" for 시술 in non-surgical context (must be "treatment")',
      '"weightlifting" for 리프팅 (must be "lifting")',
      '"Juvéderm" for 쥬베룩 (must be "Juvelook" — different manufacturer)',
      '"Pure Toxin" for 코어톡스/순수톡신 (must be "Coretox")',
      '"Tonz" or "TONZ" for 톤즈 (must be "Tone\'s")',
      '"LHA LALA Peel" for 라라필 (must be "LHALA Peel")',
      'ULTRAFORMER MPT for 슈링크유니버스 (must be "Shurink Universe")',
      'Word-for-word Korean sentence structure — rewrite in natural English syntax',
    ],
    examples: [
      {
        source: '몇 부위 맞고 싶으세요?',
        bad: 'How many areas would you like to get Botox?',
        good: 'Which areas would you like to treat with Botox?',
        reason: '"몇 부위" implies selection among options, not counting. "get Botox" is too colloquial for a clinic setting.',
      },
      {
        source: '주름이 생기는 근육의 과도한 움직임을 완화하여 표정 주름을 개선·예방하는 시술',
        bad: 'A procedure that improves and prevents expression wrinkles by relieving excessive movement of muscles that create wrinkles',
        good: 'A treatment that smooths out expression lines and prevents new ones by relaxing the facial muscles that cause wrinkles',
        reason: '"smooths out" is standard clinic marketing. "the facial muscles that cause wrinkles" is more patient-friendly than clinical "overactive muscles".',
      },
      {
        source: '피부 깊은 층과 근막층을 자극하여 리프팅 효과를 실현하는 비침습 초음파 시술',
        bad: 'A non-invasive ultrasound procedure that stimulates the deep layer of the skin and the fascial layer to achieve a lifting effect',
        good: 'A non-invasive ultrasound treatment that lifts and tightens by stimulating collagen in the deeper skin layers for a natural-looking result',
        reason: 'US/UK clinics pair "lifts and tightens" and reference collagen stimulation. "SMAS" is too clinical — no major English clinic uses it in patient-facing marketing (verified: Ultherapy.com, Define Clinic, sk:n, Cosmetic Skin Clinic).',
      },
    ],
  },
  cn: {
    lang: 'cn',
    label: '简体中文',
    region: '중국 본토',
    rules: `TARGET LANGUAGE: 简体中文 (Simplified Chinese)
REGISTER: 中国大陆轻医美营销用语 — 专业但亲和。
SCRIPT: 必须全部使用简体字。严禁繁体字。
STYLE:
- 使用轻医美行业标准表达：紧致、水润、焕亮、嫩肤、提拉
- 시술 → 疗程/项目 (绝不能用"手术")
- 원장 → 院长 (绝不能用"元帐")
- 의원 → 诊所 (绝不能用"议员")
- 리프팅 → 面部提升/紧致提升 (绝不能用"举重")
- 身体部位 리프팅 → 紧致提升 (NOT 面部提升)
- 스케일링 → 去角质 (NOT 洗牙)
- 물톡스 → 水光注射 (NOT 水毒素)
UNITS:
- 射击单位统一为"射次"
- ONDA → "J"(焦耳)
- 국산 → 韩产 (NOT 国产)
广告法合规: 禁止使用 瘦脸针/水光针/美白针/童颜针 等俗称`,
    antiPatterns: [
      '"议员" for 의원 (must be 诊所)',
      '"举重" for 리프팅 (must be 面部提升/紧致提升)',
      '"手术" for 시술 (must be 疗程/项目)',
      '"元帐" for 원장 (must be 院长)',
      '"纯毒素" for 코어톡스 (must be Coretox)',
      '"通斯" or "Tonz" for 톤즈 (must be Tone\'s)',
      '"修复针" for 리쥬란 힐러 (must be Rejuran Healer)',
      '"水毒素" for 물톡스 (must be 水光注射)',
      '"洗牙" for 스케일링 (must be 去角质)',
      '"德玛V" — never create Chinese phonetic translations of device names',
      '"音调" for 토닝 (must be 净肤)',
      'Traditional characters (國/學/產) in 简体 output',
      '瘦脸针/水光针/美白针/童颜针 — 广告法 prohibited colloquial terms',
    ],
    examples: [
      {
        source: '통증이 적고 회복이 빠른 리프팅 시술',
        bad: '疼痛少恢复快的提升施术',
        good: '痛感低、恢复期短的轻医美紧致提升项目',
        reason: '痛感低 (not 低痛感) follows natural CN word order. 恢复期短 is standard marketing form. 项目 is what Chinese clinics use for individual treatments (疗程 implies multi-session course).',
      },
      {
        source: '자연스러운 볼륨감을 더해 매끄럽고 부드러운 윤곽을 완성하는 시술',
        bad: '添加自然体积感完成光滑柔软轮廓的施术',
        good: '通过自然饱满塑造流畅柔和轮廓线条的项目',
        reason: '饱满 (not 丰盈) is standard CN medical aesthetics term for fullness. 流畅 (not 光滑) is used for contour lines. 项目 for single treatments.',
      },
    ],
  },
  tw: {
    lang: 'tw',
    label: '繁體中文',
    region: '대만·홍콩',
    rules: `TARGET LANGUAGE: 繁體中文 (Traditional Chinese)
REGISTER: 台灣/港澳醫美產業用語 — 專業親切。
SCRIPT: 必須全部使用繁體字。嚴禁簡體字。
STYLE:
- 使用台灣醫美標準用語：拉提、緊緻、淨膚、煥膚
- 시술 → 療程 (NOT 手術)
- 리프팅 → 拉提 (NOT 面部提升 — that's mainland term)
- 보톡스 → 肉毒桿菌 (NOT 肉毒素 — mainland term)
- 일산 → 一山 (NOT 日產)
- 스케일링 → 去角質 (NOT 洗牙)
- 물톡스 → 水光注射 (NOT 水毒素)
UNITS:
- 射擊單位統一為"射"
- ONDA → "J"(焦耳)
- 국산 → 韓產 (NOT 國產)
- CP值高 is standard TW usage (NOT 高性價比 which is mainland)
- 肌膚管理/肌膚保養 (NOT 皮膚護理 which sounds mainland)
- 音波拉提 for HIFU, 電波拉皮 for Thermage (distinct terms)`,
    antiPatterns: [
      '"議員" for 의원 (must be 診所)',
      '"舉重" for 리프팅 (must be 拉提)',
      '"手術" for 시술 (must be 療程)',
      '"純毒素" for 코어톡스 (must be Coretox)',
      '"通斯" for 톤즈 (must be Tone\'s)',
      '"修復針" for 리쥬란 힐러 (must be Rejuran Healer)',
      '"水毒素" for 물톡스 (must be 水光注射)',
      '"洗牙" for 스케일링 (must be 去角質)',
      '"日產" for 일산 (must be 一山)',
      'Simplified characters (国/学/产) in 繁體 output',
      '"高性價比" — mainland Chinese term, use CP值高 or CP值超高 in Taiwan context',
    ],
    examples: [
      {
        source: '가성비 좋은 피부 관리 프로그램',
        bad: '高性價比的皮膚管理程式',
        good: 'CP值高的肌膚管理療程',
        reason: 'CP值 is standard Taiwan usage even in professional clinics (星和醫美, Seoul Clinic etc). 肌膚管理 (not 皮膚護理) is the Taiwan standard term.',
      },
      {
        source: '초음파를 이용한 비침습 리프팅 시술',
        bad: '使用超聲刀的非侵入性提升施術',
        good: '非侵入式音波拉提療程',
        reason: 'TW uses 音波拉提 (not 超聲刀 — that\'s mainland). 拉提 for ultrasound lifting, 拉皮 for RF. 非侵入式 is verified standard.',
      },
    ],
  },
  ja: {
    lang: 'ja',
    label: '日本語',
    region: '일본',
    rules: `TARGET LANGUAGE: 日本語
REGISTER: 日本の美容皮膚科マーケティング — 丁寧で親しみやすい。
SCRIPT: ひらがな・カタカナ・漢字を適切に使い分け。外来語はカタカナ。
STYLE:
- 美容クリニック特有の感覚的表現を使用: ふっくら感、ハリ、ツヤ、うるおい、キメ
- 시술 → 施術 (NOT 手術)
- 원장 → 院長 (NOT 元帳)
- 이벤트 → キャンペーン (NOT イベント — クリニックの文脈)
- 애교살 → 涙袋 (NOT エギョサル)
- 카タカナ正確性: ビタミン(NOT ビッタミン), ライン(NOT ラライン)
UNITS:
- ショット数統一: ショット (not 発/線)
- ONDA → "J"(ジュール)
- 국산 → 韓国産
- 括弧は必ずペアで: （韓国産）`,
    antiPatterns: [
      '"議員" for 의원 (must be 医院/クリニック)',
      '"持ち上がる" for 리프팅 (must be リフティング)',
      '"元帳" for 원장 (must be 院長)',
      '"手術" for 시술 (must be 施術)',
      '"純粋毒素" for 코어톡스 (must be コアトックス/Coretox)',
      '"エギョサル" for 애교살 (must be 涙袋)',
      '"ビッタミン" (must be ビタミン)',
      '"LHAラッラピール" for 라라필 (must be LHALA Peel)',
      '"イベント" for clinic promotions (must be キャンペーン)',
    ],
    examples: [
      {
        source: '자연스러운 볼륨감과 탄력을 되찾아주는 스킨부스터',
        bad: '自然なボリューム感と弾力を取り戻すスキンブースター',
        good: '自然なふっくら感とハリを取り戻すスキンブースター',
        reason: 'Japanese aesthetic clinics use sensory words: ふっくら感 (plumpness, used by 品川美容外科), ハリ (firmness, used on virtually every clinic page), ツヤ (glow), うるおい (moisture).',
      },
      {
        source: '출시 기념 이벤트 체험가',
        bad: '発売記念イベント体験価',
        good: '導入記念キャンペーン 特別価格',
        reason: 'キャンペーン (not イベント) for clinic promotions. 導入記念 for new treatment launch (湘南美容). 特別価格 or 初回限定価格 (not 体験価格). ローンチ is ad industry jargon, never used by clinics.',
      },
    ],
  },
  ko: {
    lang: 'ko',
    label: '한국어',
    region: '한국',
    rules: `TARGET LANGUAGE: 한국어 (Korean)
REGISTER: 한국 피부과 클리닉 전문 용어 — 존댓말 합니다체 기본.
STYLE:
- 자연스러운 한국어 의료 마케팅 문체
- 외래어는 한국식 표기 (Botox → 보톡스, Filler → 필러, Lifting → 리프팅)
- 영문 의료기기명은 한국 클리닉에서 쓰는 표현으로 (Ultherapy → 울쎄라, Thermage → 써마지)
- 존댓말 기본 (합니다체): "~하는 시술입니다", "~에 효과적입니다"`,
    antiPatterns: [
      'Do not leave English/Chinese/Japanese text untranslated',
      'Use natural Korean medical aesthetics terminology',
      'Use 합니다 체 (polite formal register)',
    ],
    examples: [
      {
        source: 'Which areas would you like to treat with Botox?',
        bad: '',
        good: '보톡스 시술을 원하시는 부위를 선택해 주세요.',
        reason: 'Natural Korean clinic language with 합니다 체 (polite formal). 원하시는 부위를 선택해 주세요 is how Korean clinics actually phrase this.',
      },
    ],
  },
};
