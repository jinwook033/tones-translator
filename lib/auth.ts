// API 라우트 접근 제어.
//
// 이 앱에는 로그인이 없다. 원본(blog-rank-multi)은 middleware.ts 의 세션 인증이
// 브라우저 요청을 가려줬는데, 번역기만 떼어내면서 그 미들웨어가 빠졌다. 그 결과
// /api/translator/* 가 전부 무인증으로 열려 있었다 — 헤더 없이 POST 하면
// 그냥 통과하고 Claude 크레딧이 나간다.
//
// 두 겹으로 막는다.
//   1. package.json 의 -H 127.0.0.1  — 같은 네트워크의 다른 기기가 아예 못 붙는다.
//   2. 이 파일                        — 그 위에 얹는 요청 단위 검사.
//
// 이 파일이 보는 것:
//   - x-api-key 가 있으면 TRANSLATOR_INBOUND_KEY 와 일치해야 한다 (Spring 등 외부 호출자).
//   - 없으면 브라우저 UI 호출로 보고, 동일 출처인지만 확인한다 (타 사이트의 CSRF 차단).
//
// TRANSLATOR_INBOUND_KEY 는 Claude 키(TRANSLATOR_API_KEY)와 별개여야 한다.
// 외부에 넘겨주는 값이므로 같은 값을 쓰면 Claude 키를 넘겨주는 셈이 된다.

import { NextRequest, NextResponse } from 'next/server';

/**
 * 통과하면 null, 막으면 401 응답을 돌려준다.
 * 라우트에서 `const denied = checkAuth(req); if (denied) return denied;` 로 쓴다.
 */
export function checkAuth(req: NextRequest): NextResponse | null {
  const provided = req.headers.get('x-api-key');

  // 1. 외부 호출자 경로 — 헤더가 있으면 반드시 일치해야 한다 (fail-closed).
  if (provided !== null) {
    const expected = process.env.TRANSLATOR_INBOUND_KEY;
    if (!expected || provided !== expected) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }
    return null;
  }

  // 2. 브라우저 경로 — Origin 이 붙어 있으면 자기 자신이어야 한다.
  //    fetch 로 다른 사이트에서 부르면 Origin 이 그 사이트로 찍히므로 걸러진다.
  //    같은 출처의 단순 GET 은 Origin 이 없을 수 있어 그때는 통과시킨다.
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('host');
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 401 });
    }
    if (originHost !== host) {
      return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 401 });
    }
  }

  return null;
}
