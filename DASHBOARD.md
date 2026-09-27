# 대시보드 개편 — 작업 명세 (완료, 기록용)

> **2026-09-17 구현 완료.** 아래 내용은 개편 *전* 상태를 기준으로 쓴 것이라 지금 코드와 맞지 않는다.
> 현재 화면 구성은 `README.md`, 디자인 대조는 `design/IMPLEMENTATION.md` 를 볼 것.
> 여기 적힌 `/translator/*` 경로는 모두 사라졌다.

이 문서는 대시보드를 새로 짜기 위한 재료였다. **사실(당시 있던 것)**과 **제안**과 **정해야 할 것**을 구분해서 적었다.

---

## 1. 지금 있는 것 (사실)

### 화면

| 경로 | 줄수 | 내용 |
|---|---|---|
| `/` | 5 | `/translator` 로 redirect. 실질적으로 없음 |
| `/translator` | 692 | 탭 3개 + 모달 1개 + 미리보기 1개가 **한 파일** |
| `/translator/glossary` | 181 | 용어집 목록·추가·삭제 |
| `/translator/language` | 281 | 언어별 금지표현·예문·문체규칙 |
| `/translator/review` | 300 | 번역 검수 |

`/translator` 692줄 안에 들어 있는 것:

- **텍스트 탭** — 입력창, 대상 언어 4개 토글, 한↔외 방향 전환, 실시간 번역(디바운스), 최근 기록(localStorage), 언어별 복사 / 전체 복사
- **엑셀 탭** — 다중 파일 업로드, 미등록 용어 사전 점검, SSE 진행률, 토큰·비용 표시, 언어별 xlsx 다운로드
- **용어집 탭** — 목록 미리보기 + 검색 (편집은 `/translator/glossary` 로 이동)
- **미등록 용어 모달** — Haiku 로 후보 검색, 개별/일괄 저장

### API

| 엔드포인트 | 메서드 | 응답 |
|---|---|---|
| `/api/translator/translate` | POST | `{ translations, glossaryApplied, cached, usage, unregisteredTerms }` |
| `/api/translator/translate-excel-stream` | POST | SSE — `status` / `unregistered` / `progress` / `done` |
| `/api/translator/translate-excel` | POST | `{ files: [{lang, fileName, base64}] }` |
| `/api/translator/glossary` | GET · POST · PUT · DELETE | `{ count, entries[] }` |
| `/api/translator/language` | GET · PUT · DELETE | `{ profiles[] }` |
| `/api/translator/review` | GET · PUT · POST | `{ items[], total, stats }` |
| `/api/translator/search-term` | POST | 미등록 용어 후보 |
| `/api/translator/resolve` | POST | 모호성 선택 반영 |

### 이미 있는데 화면에 안 드러난 데이터

대시보드에 쓸 수 있는데 지금은 아무 데도 안 보이는 것들이다.

| 데이터 | 어디서 | 지금 |
|---|---|---|
| 언어별 검수 대기/승인/수정 건수 | `GET /review` → `stats` | 검수 화면 안에서만 |
| 검수본 재사용 여부 | `translations[lang].reviewed` | 안 보임 |
| 번역 신뢰도 | `translations[lang].confidence` | 결과 카드에만 |
| 검증기 차단·경고 | `translations[lang].validation.issues` | 검수 화면에만 |
| 언어 설정 수정 여부 | `GET /language` → `customized` | 언어 화면에만 |
| 토큰·비용 | `usage` | 엑셀 탭에만 |

---

## 2. 문제

1. **첫 화면이 없다.** `/` 가 번역 입력창으로 바로 튄다. 지금 무슨 일이 벌어지고 있는지(검수 대기가 몇 건인지, 어제 뭘 돌렸는지) 볼 곳이 없다.
2. **화면 4개가 따로 논다.** 상단 링크로만 이어져 있고 공통 레이아웃이 없다.
3. **`/translator` 692줄이 한 파일이다.** 탭 3개 + 모달 + 미리보기가 섞여 있어 한 군데를 고치면 다른 데가 깨진다.
4. **스타일이 두 갈래다.** `/translator` 는 인라인 `style` 객체(`s.card2`, `s.accent`), 나머지 셋은 Tailwind 클래스. 토큰이 공유되지 않는다.

---

## 3. 제안 — 정보 구조

```
/                    대시보드 (신규)
/translate           번역          ← 지금 /translator 의 텍스트 탭
/translate/excel     엑셀 일괄      ← 지금 /translator 의 엑셀 탭
/review              검수
/glossary            용어집
/settings/language   언어 설정
```

공통 레이아웃 하나에 좌측 또는 상단 내비게이션을 두고, 각 화면은 자기 일만 한다.

### 대시보드에 올릴 것 (제안)

위 「화면에 안 드러난 데이터」로 만들 수 있는 것들이다.

| 블록 | 내용 | 원천 |
|---|---|---|
| 검수 현황 | 언어별 대기 건수. 클릭하면 해당 언어 검수로 | `GET /review` → `stats` |
| 손봐야 할 것 | 검증기가 `block` 한 항목 상위 몇 건 | `GET /review?issuesOnly=true` |
| 용어집 상태 | 총 건수, 분류별 분포, 최근 추가 | `GET /glossary` |
| 언어 설정 상태 | 언어별 금지표현·예문 개수, 수정 여부 | `GET /language` |
| 최근 작업 | 최근 번역·엑셀 처리 기록 | **없음 — 새로 만들어야 함** |
| 이번 달 비용 | 누적 토큰·비용 | **없음 — 새로 만들어야 함** |

마지막 두 줄은 지금 데이터가 없다. 필요하면 기록을 남기는 것부터 만들어야 한다.

---

## 4. 공통으로 뽑을 것

지금 네 화면에 흩어져 있는 것들이다.

| 항목 | 지금 | 제안 |
|---|---|---|
| 색·간격 토큰 | `/translator` 인라인 객체 + 나머지 Tailwind | 한 곳 |
| 언어 라벨 | `LANG_KO` 가 2곳에 재선언 (검수·언어설정) | `types.ts` 의 `LANG_LABELS` 로 통일 |
| 언어 탭 | 검수·언어설정에 각각 구현 | 컴포넌트 하나 |
| 상태 배지 | 검수 화면에만 | 컴포넌트 하나 |
| 내비게이션 | 화면마다 링크 나열 | 레이아웃 |

`LANG_KO` 는 `types.ts` 의 `LANG_LABELS` 와 내용이 겹치는데 따로 적혀 있다. 언어 이름을 바꿀 때 세 군데를 손대야 한다.

---

## 5. 정해야 할 것

| # | 결정 | 영향 |
|---|---|---|
| 1 | 대시보드 첫 화면에 뭘 올릴지 | 위 「대시보드에 올릴 것」 중 선택 |
| 2 | 작업 기록을 남길지 | 「최근 작업」·「이번 달 비용」 블록의 전제 |
| 3 | 용어집을 노션으로 옮길지 | 옮기면 `/glossary` 는 읽기 전용 + 새로고침 버튼이 됨 |
| 4 | 내비게이션 위치 | 좌측 사이드바 / 상단 바 |
| 5 | 스타일 갈래 통일 방향 | Tailwind 로 모을지, 토큰 객체로 모을지 |

---

## 6. 권장 작업 순서

앞엣것이 뒤엣것의 토대가 된다.

1. **공통 레이아웃 + 내비게이션** — 화면 4개를 한 껍데기에 넣는다
2. **스타일 토큰 통일** — 1번 하면서 같이
3. **`/translator` 692줄 분해** — 텍스트/엑셀을 각자 경로로
4. **대시보드 화면** — 이미 있는 데이터(검수·용어집·언어설정)로 먼저
5. **작업 기록** — 2번 결정이 「남긴다」면
