/**
 * NEIS API DDISH_NM(요리명)에서 알레르기 유발물질 번호, 부호 및 특수문자를 제거하여
 * 순수 요리명만 추출하는 유틸리티
 */
export function cleanSingleDishName(dish) {
  if (!dish || typeof dish !== "string") return "";
  return dish
    .replace(/\([0-9.\s]+\)/g, "") // 알레르기 유발물질 번호 제거 e.g. (1.2.5.6)
    .replace(/[0-9.]+$/g, "") // 끝에 붙은 번호 제거
    .replace(/[-*#~]+$/g, "") // 끝에 붙은 특수문자(-, *, #) 제거
    .replace(/^[-*#~]+/g, "") // 앞에 붙은 특수문자 제거
    .replace(/[a-zA-Z]+$/g, "") // 끝에 붙은 알파벳 코드(k, s 등) 제거
    .replace(/[-*#~]+$/g, "") // 알파벳 제거 후 남은 특수문자 제거
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * HTML <br/> 태그로 구분된 원본 DDISH_NM 문자열을 파싱하여
 * 순수 요리명 배열만 반환
 */
export function parsePureDishNames(rawDdish) {
  if (!rawDdish || typeof rawDdish !== "string") return [];
  return rawDdish
    .split(/<br\s*\/?>/i)
    .map((item) => cleanSingleDishName(item))
    .filter((item) => item.length > 0);
}
