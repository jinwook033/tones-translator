# 톤즈의원 번역기 (tones-translator)

용어집 기반 의료 원고 번역기. `blog-rank-multi` 에서 번역 기능만 떼어낸 **독립 앱**입니다.

## 실행

```bash
npm install
cp .env.example .env.local     # 키 입력
npm run dev                    # http://localhost:3300
```

로그인이 없습니다. 원본은 멀티 테넌트 + 로그인이었지만 이 앱은 톤즈 전용 도구입니다.

## 화면

| 주소 | 내용 |
|---|---|
| `/translator` | 번역 (텍스트 · 엑셀 일괄) |
| `/translator/glossary` | 용어집 관리 |

## 언어

`en` 영어 · `cn` 중국어 · `sg` 싱가포르 · `ja` 일본어 · `ko` 한국어

## 용어집

두 겹입니다.

```
GLOSSARY_SEED        코드로 관리하는 검증 용어 226건 (lib/translator/glossary-data.ts)
data/glossary.json   화면에서 추가·수정한 용어 (서버 재시작해도 유지)
```

같은 단어가 양쪽에 있으면 **파일 쪽이 이깁니다** (사람이 고친 것이므로).

`locked: true` 인 항목은 번역기가 바꾸지 못합니다 — 예: `톤즈의원 → Tone's CLINIC` 고정.

## 원본과 달라진 점

| | blog-rank-multi | 이 앱 |
|---|---|---|
| 로그인 | 있음 | 없음 |
| 테넌트 | 여러 병원 | 톤즈 하나 (`lib/tenant.ts` 가 항상 1) |
| 용어집 저장 | Supabase | `data/glossary.json` |

번역 로직(`lib/translator/`)은 **원본 그대로**입니다. 용어집 SEED 226건도 동일합니다.

## 환경변수

| 변수 | 용도 |
|---|---|
| `TRANSLATOR_API_KEY` | 번역용 Claude 키 (없으면 `ANTHROPIC_API_KEY` 사용) |
