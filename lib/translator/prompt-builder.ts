/**
 * prompt-builder.ts — Claude system prompt construction for Tones Translator
 *
 * Architecture based on:
 * - Anthropic official: XML tags, few-shot examples, role assignment
 * - WMT 2024: 4-step decomposition (MetricX +0.84)
 * - Academic 2025: Reflective translation (COMET +0.1753)
 * - Translation theory: Dynamic equivalence for marketing, formal for clinical
 */

import type {
  GlossaryEntry,
  TargetLang,
  TranslationContext,
  PromptConfig,
} from './types';
import { buildGlossaryReference } from './glossary-engine';

// ---------------------------------------------------------------------------
// Anti-patterns: translations that must NEVER appear in output
// ---------------------------------------------------------------------------

const ANTI_PATTERNS: Record<string, string[]> = {
  en: [
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
  cn: [
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
  sg: [
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
  ja: [
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
  ko: [
    'Do not leave English/Chinese/Japanese text untranslated',
    'Use natural Korean medical aesthetics terminology',
    'Use 합니다 체 (polite formal register)',
  ],
};

// ---------------------------------------------------------------------------
// Few-shot examples per language (highest single impact on quality)
// ---------------------------------------------------------------------------

const FEW_SHOT_EXAMPLES: Record<string, string> = {
  en: `<examples>
<example>
<korean>몇 부위 맞고 싶으세요?</korean>
<bad>How many areas would you like to get Botox?</bad>
<good>Which areas would you like to treat with Botox?</good>
<reason>"몇 부위" implies selection among options, not counting. "get Botox" is too colloquial for a clinic setting.</reason>
</example>
<example>
<korean>주름이 생기는 근육의 과도한 움직임을 완화하여 표정 주름을 개선·예방하는 시술</korean>
<bad>A procedure that improves and prevents expression wrinkles by relieving excessive movement of muscles that create wrinkles</bad>
<good>A treatment that smooths out expression lines and prevents new ones by relaxing the facial muscles that cause wrinkles</good>
<reason>"smooths out" is standard clinic marketing. "the facial muscles that cause wrinkles" is more patient-friendly than clinical "overactive muscles".</reason>
</example>
<example>
<korean>피부 깊은 층과 근막층을 자극하여 리프팅 효과를 실현하는 비침습 초음파 시술</korean>
<bad>A non-invasive ultrasound procedure that stimulates the deep layer of the skin and the fascial layer to achieve a lifting effect</bad>
<good>A non-invasive ultrasound treatment that lifts and tightens by stimulating collagen in the deeper skin layers for a natural-looking result</good>
<reason>US/UK clinics pair "lifts and tightens" and reference collagen stimulation. "SMAS" is too clinical — no major English clinic uses it in patient-facing marketing (verified: Ultherapy.com, Define Clinic, sk:n, Cosmetic Skin Clinic).</reason>
</example>
</examples>`,

  cn: `<examples>
<example>
<korean>통증이 적고 회복이 빠른 리프팅 시술</korean>
<bad>疼痛少恢复快的提升施术</bad>
<good>痛感低、恢复期短的轻医美紧致提升项目</good>
<reason>痛感低 (not 低痛感) follows natural CN word order. 恢复期短 is standard marketing form. 项目 is what Chinese clinics use for individual treatments (疗程 implies multi-session course).</reason>
</example>
<example>
<korean>자연스러운 볼륨감을 더해 매끄럽고 부드러운 윤곽을 완성하는 시술</korean>
<bad>添加自然体积感完成光滑柔软轮廓的施术</bad>
<good>通过自然饱满塑造流畅柔和轮廓线条的项目</good>
<reason>饱满 (not 丰盈) is standard CN medical aesthetics term for fullness. 流畅 (not 光滑) is used for contour lines. 项目 for single treatments.</reason>
</example>
</examples>`,

  sg: `<examples>
<example>
<korean>가성비 좋은 피부 관리 프로그램</korean>
<bad>高性價比的皮膚管理程式</bad>
<good>CP值高的肌膚管理療程</good>
<reason>CP值 is standard Taiwan usage even in professional clinics (星和醫美, Seoul Clinic etc). 肌膚管理 (not 皮膚護理) is the Taiwan standard term.</reason>
</example>
<example>
<korean>초음파를 이용한 비침습 리프팅 시술</korean>
<bad>使用超聲刀的非侵入性提升施術</bad>
<good>非侵入式音波拉提療程</good>
<reason>TW uses 音波拉提 (not 超聲刀 — that's mainland). 拉提 for ultrasound lifting, 拉皮 for RF. 非侵入式 is verified standard.</reason>
</example>
</examples>`,

  ja: `<examples>
<example>
<korean>자연스러운 볼륨감과 탄력을 되찾아주는 스킨부스터</korean>
<bad>自然なボリューム感と弾力を取り戻すスキンブースター</bad>
<good>自然なふっくら感とハリを取り戻すスキンブースター</good>
<reason>Japanese aesthetic clinics use sensory words: ふっくら感 (plumpness, used by 品川美容外科), ハリ (firmness, used on virtually every clinic page), ツヤ (glow), うるおい (moisture).</reason>
</example>
<example>
<korean>출시 기념 이벤트 체험가</korean>
<bad>発売記念イベント体験価</bad>
<good>導入記念キャンペーン 特別価格</good>
<reason>キャンペーン (not イベント) for clinic promotions. 導入記念 for new treatment launch (湘南美容). 特別価格 or 初回限定価格 (not 体験価格). ローンチ is ad industry jargon, never used by clinics.</reason>
</example>
</examples>`,

  ko: `<examples>
<example>
<english>Which areas would you like to treat with Botox?</english>
<good>보톡스 시술을 원하시는 부위를 선택해 주세요.</good>
<reason>Natural Korean clinic language with 합니다 체 (polite formal). 원하시는 부위를 선택해 주세요 is how Korean clinics actually phrase this.</reason>
</example>
</examples>`,
};

// ---------------------------------------------------------------------------
// Language-specific style guides (enhanced from research)
// ---------------------------------------------------------------------------

const LANG_RULES: Record<string, string> = {
  en: `TARGET LANGUAGE: English
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

  cn: `TARGET LANGUAGE: 简体中文 (Simplified Chinese)
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

  sg: `TARGET LANGUAGE: 繁體中文 (Traditional Chinese)
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

  ja: `TARGET LANGUAGE: 日本語
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

  ko: `TARGET LANGUAGE: 한국어 (Korean)
REGISTER: 한국 피부과 클리닉 전문 용어 — 존댓말 합니다체 기본.
STYLE:
- 자연스러운 한국어 의료 마케팅 문체
- 외래어는 한국식 표기 (Botox → 보톡스, Filler → 필러, Lifting → 리프팅)
- 영문 의료기기명은 한국 클리닉에서 쓰는 표현으로 (Ultherapy → 울쎄라, Thermage → 써마지)
- 존댓말 기본 (합니다체): "~하는 시술입니다", "~에 효과적입니다"`,
};

// ---------------------------------------------------------------------------
// Translation process (4-step, performed inside extended thinking)
// ---------------------------------------------------------------------------

function getTranslationProcess(context: TranslationContext): string {
  const isMarketing = context === 'description' || context === 'general';
  const equivalence = isMarketing
    ? 'DYNAMIC EQUIVALENCE — prioritize natural expression and intent over literal word-for-word accuracy. A good translation reads as if ORIGINALLY WRITTEN in the target language.'
    : 'FORMAL EQUIVALENCE — prioritize accuracy and precision. Preserve medical terminology exactly.';

  return `
TRANSLATION APPROACH: ${equivalence}

TRANSLATION PROCESS (follow these steps in your thinking):
1. ANALYZE: Read the Korean text. Identify:
   - Idioms or culturally-specific phrases that CANNOT be translated word-for-word
   - Medical terminology requiring precision
   - Marketing language requiring natural adaptation
2. DRAFT: Translate prioritizing MEANING over words. Write how a native ${'{target language}'} speaker would naturally express this.
3. REFINE: Re-read your draft. Fix:
   - Any phrase that sounds "translated" rather than native → rewrite naturally
   - Korean sentence structure leaking into target language → restructure
   - Awkward word choices → replace with natural equivalents
4. VERIFY: Final check:
   - No meaning lost compared to original?
   - All {{G_N}} placeholders preserved exactly?
   - Medical accuracy maintained?
   - Reads naturally as if originally written in target language?`;
}

// ---------------------------------------------------------------------------
// Thinking budget calibration (increased for quality)
// ---------------------------------------------------------------------------

const THINKING_BUDGETS: Record<TranslationContext, number> = {
  treatment_name: 5000,
  description: 12000,
  category: 3000,
  general: 8000,
  legal: 16000,
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildSystemPrompt(config: PromptConfig): string {
  const { targetLang, context, glossaryEntries } = config;

  const glossaryRef = buildGlossaryReference(glossaryEntries, targetLang);
  const antiPatterns = ANTI_PATTERNS[targetLang] || ANTI_PATTERNS['en'];
  const langRules = LANG_RULES[targetLang] || LANG_RULES['en'];
  const examples = FEW_SHOT_EXAMPLES[targetLang] || '';
  const process = getTranslationProcess(context);
  const langName = targetLang === 'en' ? 'English' : targetLang === 'cn' ? '简体中文' : targetLang === 'sg' ? '繁體中文' : targetLang === 'ja' ? '日本語' : '한국어';

  return `You are a professional medical marketing translator with 15 years of experience specializing in Korean dermatology and aesthetic clinics.
You translate ${targetLang === 'ko' ? 'foreign languages' : 'Korean (한국어)'} into ${langName}.
Your translations are used on the official website of Tone's Clinic (톤즈의원), a chain of 26 dermatology clinics across South Korea.
Translate as idiomatic speech as if it were a native speaker of ${langName}.

DOMAIN: Non-surgical aesthetic dermatology — botox, fillers, lifting devices, laser treatments, skin boosters, body contouring, IV therapy.

CRITICAL: Any text wrapped in {{G_N}} placeholders (e.g. {{G_0}}, {{G_1}}) is a LOCKED glossary term.
You MUST preserve these placeholders EXACTLY as-is in your output. Do NOT translate, modify, or remove them.
${process}

<glossary>
${glossaryRef || '(No additional glossary entries)'}
</glossary>

<anti_patterns>
NEVER generate any of these:
${antiPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}
</anti_patterns>

<language_rules>
${langRules}
</language_rules>

${examples}

<context>${context}</context>
${context === 'treatment_name' ? 'This is a TREATMENT NAME — be precise, concise, use established medical terminology.' : ''}
${context === 'description' ? 'This is a TREATMENT DESCRIPTION — marketing copy for patients. Natural, benefit-focused, NOT clinical/academic.' : ''}
${context === 'category' ? 'This is a CATEGORY NAME — keep it short and standard.' : ''}
${context === 'legal' ? 'This is LEGAL/POLICY TEXT — precision and compliance are paramount.' : ''}

<output_format>
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "translated": "your translation here",
  "confidence": 0.95,
  "ambiguities": []
}

If uncertain (confidence < 0.85), include alternatives:
{
  "translated": "best translation",
  "confidence": 0.7,
  "ambiguities": [
    { "text": "alternative", "explanation": "why this might be better", "recommended": true }
  ]
}
</output_format>`;
}

export function buildUserPrompt(text: string): string {
  return `Translate the following text. Remember: preserve all {{G_N}} placeholders exactly as-is. Translate naturally — do NOT translate word-by-word.

${text}`;
}

export function getThinkingBudget(context: TranslationContext): number {
  return THINKING_BUDGETS[context] ?? 8000;
}
