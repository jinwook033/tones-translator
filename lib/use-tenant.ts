// 단독 앱용 고정 설정. 원본(blog-rank-multi)은 병원 여러 곳을 한 앱에서 돌려
// /api/auth 로 테넌트를 받아왔지만, 여기서는 톤즈 하나만 쓰므로 값을 고정한다.
"use client";

export interface ClientTenantConfig {
  name: string;
  slug: string;
  branches: string[];
  aliases: Record<string, string>;
  inactive: string[];
  placeKeywords: Record<string, string>;
  blogGrades: { id: string; url: string; grade: string }[];
  placeSearchName: string;
}

const TONES: ClientTenantConfig = {
  name: "톤즈의원",
  slug: "tones",
  branches: [],
  aliases: {},
  inactive: [],
  placeKeywords: {},
  blogGrades: [],
  placeSearchName: "톤즈의원",
};

export function useTenantConfig() {
  return { config: TONES, loading: false, role: "admin", availableTenants: [], tenantId: 1 };
}
