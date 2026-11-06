import { parsePureDishNames } from "./dish.js";

// NEIS Open API 연동 및 급식 데이터 수집 유틸리티
const NEIS_BASE_URL = "https://open.neis.go.kr/hub";

export function getApiKey() {
  const envKey =
    (import.meta && import.meta.env && import.meta.env.VITE_API_KEY) ||
    "d202735e444d43b78264ee6c1f849c6b";
  return envKey.replace(/["'\s]/g, "");
}

/**
 * 특정 시도교육청의 학교 목록 조회 (schoolInfo)
 * @param {string} officeCode - 시도교육청 코드 (예: 'B10')
 * @param {number} pSize - 가져올 학교 수 (기본 800개)
 */
export async function fetchSchoolList(officeCode, pSize = 800) {
  const apiKey = getApiKey();
  const url = `${NEIS_BASE_URL}/schoolInfo?KEY=${apiKey}&Type=json&ATPT_OFCDC_SC_CODE=${officeCode}&pIndex=1&pSize=${pSize}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`학교 정보 조회 실패 (상태 코드: ${res.status})`);
  }

  const data = await res.json();
  if (data.RESULT && data.RESULT.CODE !== "INFO-000") {
    if (data.RESULT.CODE === "INFO-200") return [];
    throw new Error(
      data.RESULT.MESSAGE || "학교 목록 조회 중 오류가 발생했습니다."
    );
  }

  if (!data.schoolInfo || !data.schoolInfo[1] || !data.schoolInfo[1].row) {
    return [];
  }

  const rawRows = data.schoolInfo[1].row;

  // 정상적인 표준학교코드가 있는 학교만 필터링
  return rawRows.filter(
    (s) => s.SD_SCHUL_CODE && s.SD_SCHUL_CODE.trim().length > 0
  );
}

// 식단 데이터 세션 메모리 캐시 (동일 학교/기간 중복 네트워크 호출 차단)
const dietCache = new Map();

/**
 * 특정 학교의 특정 기간 급식 식단 정보 조회 (mealServiceDietInfo - 캐시 적용)
 */
export async function fetchSchoolDiet(officeCode, schoolCode, fromYmd, toYmd) {
  const cacheKey = `${officeCode}_${schoolCode}_${fromYmd}_${toYmd}`;
  if (dietCache.has(cacheKey)) {
    return dietCache.get(cacheKey);
  }

  const apiKey = getApiKey();
  const url = `${NEIS_BASE_URL}/mealServiceDietInfo?KEY=${apiKey}&Type=json&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&MLSV_FROM_YMD=${fromYmd}&MLSV_TO_YMD=${toYmd}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    if (
      !data.mealServiceDietInfo ||
      !data.mealServiceDietInfo[1] ||
      !data.mealServiceDietInfo[1].row
    ) {
      dietCache.set(cacheKey, []);
      return [];
    }
    const rows = data.mealServiceDietInfo[1].row;
    dietCache.set(cacheKey, rows);
    return rows;
  } catch (err) {
    console.warn(`식단 조회 실패 (${schoolCode}):`, err);
    return [];
  }
}

/**
 * 대상 학교들의 급식 데이터 동시성 배치 수집 및 순수 요리명 사전 파싱
 */
export async function fetchTargetSchoolsDiet(
  officeCode,
  targetSchools,
  fromYmd,
  toYmd,
  maxSchools = 36,
  onProgress
) {
  const schoolsToFetch = targetSchools.slice(0, maxSchools);
  const total = schoolsToFetch.length;
  let completed = 0;
  const allMeals = [];

  const concurrency = 8;
  const queue = [...schoolsToFetch];

  async function worker() {
    while (queue.length > 0) {
      const school = queue.shift();
      if (!school) break;

      const targetOfficeCode =
        school.officeCode || school.ATPT_OFCDC_SC_CODE || officeCode;

      const meals = await fetchSchoolDiet(
        targetOfficeCode,
        school.SD_SCHUL_CODE,
        fromYmd,
        toYmd
      );

      for (const m of meals) {
        const pureDishes = parsePureDishNames(m.DDISH_NM);
        // 순수 요리명이 있는 식단만 포함
        if (pureDishes.length > 0) {
          allMeals.push({
            ...m,
            officeCode: targetOfficeCode,
            schoolName: school.SCHUL_NM,
            schoolKind: school.SCHUL_KND_SC_NM || "학교",
            address: school.ORG_RDNMA,
            distanceKm: school.distanceKm !== undefined ? school.distanceKm : 999,
            distanceText: school.distanceText || "-",
            isSameDong: Boolean(school.isSameDong),
            schoolDong: school.schoolDong || "",
            isPinned: Boolean(school.isPinned),
            pureDishes // 미리 파싱하여 렌더링/검색 시 중복 계산 방지
          });
        }
      }

      completed++;
      if (onProgress) {
        onProgress(completed, total, school.SCHUL_NM);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () =>
    worker()
  );
  await Promise.all(workers);

  // 학교 거리 가까운 순으로 식단 정렬 (오름차순)
  allMeals.sort((a, b) => {
    const distA = a.distanceKm !== undefined ? a.distanceKm : 999;
    const distB = b.distanceKm !== undefined ? b.distanceKm : 999;
    if (distA !== distB) {
      return distA - distB;
    }
    if (a.schoolName === b.schoolName) {
      return (a.MLSV_YMD || "").localeCompare(b.MLSV_YMD || "");
    }
    return (a.schoolName || "").localeCompare(b.schoolName || "", "ko");
  });

  return { allMeals };
}
