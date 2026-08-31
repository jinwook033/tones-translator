// 단독 앱이라 테넌트 구분이 없다. 원본(blog-rank-multi)은 여러 병원을 한 앱에서 돌려서
// 요청 헤더로 테넌트를 갈랐지만, 여기서는 톤즈 하나만 쓰므로 항상 1을 돌려준다.
export function getTenantId(_req?: unknown): number {
  return 1;
}
