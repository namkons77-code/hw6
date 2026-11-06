import { OFFICES_OF_EDUCATION } from "../constants/offices.js";

/**
 * 두 좌표 사이의 거리 계산 (km) - Haversine 공식
 */
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (
    lat1 === undefined ||
    lon1 === undefined ||
    lat2 === undefined ||
    lon2 === undefined
  ) {
    return 999;
  }
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 위도/경도로부터 가장 가까운 시도교육청 매칭
 */
export function findClosestOffice(lat, lon) {
  let closest = OFFICES_OF_EDUCATION[0];
  let minDistance = Infinity;

  for (const office of OFFICES_OF_EDUCATION) {
    const dist = calculateDistanceKm(lat, lon, office.lat, office.lon);
    if (dist < minDistance) {
      minDistance = dist;
      closest = office;
    }
  }
  return { office: closest, distance: minDistance };
}

/**
 * 시/도 이름 또는 좌표로 17개 시도교육청 중 최적의 교육청 매칭
 */
export function matchOfficeOfEducation(province, lat, lon) {
  if (province) {
    const clean = province.trim();
    const matched = OFFICES_OF_EDUCATION.find(
      (o) => clean.includes(o.shortName) || o.region.includes(clean)
    );
    if (matched) return matched;
  }
  if (lat && lon) {
    return findClosestOffice(lat, lon).office;
  }
  return OFFICES_OF_EDUCATION[0];
}

/**
 * 브라우저 Geolocation API 호출 (일반적 표준 HTML5 위치 감지)
 */
export function getCurrentPosition(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 브라우저는 위치 정보(Geolocation)를 지원하지 않습니다."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        });
      },
      (err) => {
        reject(err);
      },
      {
        enableHighAccuracy: false,
        timeout: timeoutMs,
        maximumAge: 600000 // 10분 캐시
      }
    );
  });
}

/**
 * 일반적인 역지오코딩 (BigDataCloud Client API -> Nominatim Fallback)
 * 전국 모든 지역(서울, 경기, 부산, 대구, 대전, 광주, 강원, 제주 등)을 동일한 표준 로직으로 처리
 */
export async function reverseGeocode(lat, lon) {
  // 1순위: 클라이언트 브라우저 친화적 BigDataCloud API (CORS 문제 및 403 차단 없음)
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const province = data.principalSubdivision || data.city || "";
      const admin = data.localityInfo?.administrative || [];

      // 구/시/군 추출 (adminLevel 6 또는 5)
      const districtObj =
        admin.find((a) => a.adminLevel === 6) ||
        admin.find((a) => a.adminLevel === 5);
      const district = districtObj?.name || "";

      // 동/읍/면 추출 (adminLevel 8 또는 7 또는 locality)
      const dongObj =
        admin.find((a) => a.adminLevel === 8) ||
        admin.find((a) => a.adminLevel === 7);
      const rawDong = dongObj?.name || data.locality || "";
      const baseDong = rawDong.replace(/[0-9]+동$/, "동");

      const matchedOffice = matchOfficeOfEducation(province, lat, lon);
      const locationText = `${province} ${district} ${baseDong || rawDong}`.trim();

      if (province || district) {
        return {
          success: true,
          lat,
          lon,
          province,
          district,
          rawDong,
          baseDong,
          dong: baseDong || rawDong,
          locationText,
          matchedOffice
        };
      }
    }
  } catch (err) {
    console.warn("BigDataCloud 역지오코딩 실패, OpenStreetMap 시도:", err);
  }

  // 2순위: OpenStreetMap Nominatim API
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=ko`;
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "ko"
      }
    });

    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};
      const province = addr.province || addr.city || addr.state || "";
      const district =
        addr.borough ||
        addr.city_district ||
        addr.county ||
        addr.municipality ||
        "";
      const rawDong =
        addr.suburb ||
        addr.quarter ||
        addr.neighbourhood ||
        addr.village ||
        addr.town ||
        "";
      const baseDong = rawDong.replace(/[0-9]+동$/, "동");

      const matchedOffice = matchOfficeOfEducation(province, lat, lon);
      const locationText = `${province} ${district} ${baseDong || rawDong}`.trim();

      return {
        success: true,
        lat,
        lon,
        province,
        district,
        rawDong,
        baseDong,
        dong: baseDong || rawDong,
        locationText,
        matchedOffice
      };
    }
  } catch (err) {
    console.warn("Nominatim 역지오코딩 실패:", err);
  }

  // 3순위: 지오코딩 실패 시 좌표 기반 최단 교육청 자동 매칭
  const closest = findClosestOffice(lat, lon).office;
  return {
    success: false,
    lat,
    lon,
    province: closest.region,
    district: closest.districts[0] || "",
    rawDong: "",
    baseDong: "",
    dong: "",
    locationText: `${closest.region} ${closest.districts[0] || ""}`.trim(),
    matchedOffice: closest
  };
}

/**
 * 일반적인 접속 위치 감지 메인 로직
 * 1. HTML5 Geolocation (GPS)
 * 2. IP 기반 지오로케이션 (접속 IP의 도시/지역 감지)
 * 3. 표준 기본 위치 (전국 공통)
 */
export async function getGeneralLocation() {
  // 1단계: 브라우저 HTML5 위치 정보 시도
  try {
    const pos = await getCurrentPosition(4000);
    const geo = await reverseGeocode(pos.latitude, pos.longitude);
    if (geo.success && geo.province) {
      return geo;
    }
  } catch (err) {
    console.warn("브라우저 위치 감지 불가/거부, IP 기반 위치로 대체:", err);
  }

  // 2단계: IP 기반 자동 접속 위치 감지 시도 (전국 어디서나 자동 식별)
  try {
    const ipRes = await fetch("https://ipwho.is/");
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      if (ipData.success && ipData.latitude && ipData.longitude) {
        const geo = await reverseGeocode(ipData.latitude, ipData.longitude);
        if (geo.success && geo.province) {
          return geo;
        }
      }
    }
  } catch (ipErr) {
    console.warn("IP 위치 감지 실패:", ipErr);
  }

  // 3단계: 기본값 - 전국 대표 시도교육청 (서울)
  const defaultOffice = OFFICES_OF_EDUCATION[0];
  return {
    success: false,
    lat: defaultOffice.lat,
    lon: defaultOffice.lon,
    province: defaultOffice.region,
    district: defaultOffice.districts[0] || "",
    dong: "",
    rawDong: "",
    baseDong: "",
    locationText: `${defaultOffice.region} ${defaultOffice.districts[0] || ""}`,
    matchedOffice: defaultOffice
  };
}

/**
 * 학교 주소로부터 동/읍/면 이름 정밀 추출
 */
export function extractSchoolDong(school) {
  const detail = school.ORG_RDNDA || "";
  // 1. 상세주소 괄호 안의 동/읍/면 우선 추출 (예: (역삼동, 역삼중), (범어동, 동도초))
  const parenMatch = detail.match(/\(([가-힣\d]+(?:동|읍|면|가))/);
  if (parenMatch) {
    return parenMatch[1].replace(/[0-9]+동$/, "동");
  }

  // 2. 도로명 주소나 상세주소 끝자리 단어 매칭
  const text = `${school.ORG_RDNDA || ""} ${school.ORG_RDNMA || ""}`;
  const match = text.match(/([가-힣\d]+(?:동|읍|면|가))(?=[,\s)]|$)/);
  if (match) {
    const d = match[1].replace(/[0-9]+동$/, "동");
    if (d.length >= 2 && !d.includes("학교")) {
      return d;
    }
  }
  return "";
}

/**
 * 동별 대표 좌표 사전 (수성구 및 주요 시도 중심점)
 */
export const DONG_COORDINATES = {
  범어동: { lat: 35.8585, lon: 128.625 },
  황금동: { lat: 35.845, lon: 128.632 },
  만촌동: { lat: 35.858, lon: 128.648 },
  수성동1가: { lat: 35.853, lon: 128.614 },
  수성동2가: { lat: 35.857, lon: 128.616 },
  수성동3가: { lat: 35.859, lon: 128.617 },
  수성동4가: { lat: 35.861, lon: 128.618 },
  중동: { lat: 35.844, lon: 128.612 },
  상동: { lat: 35.835, lon: 128.614 },
  두산동: { lat: 35.831, lon: 128.624 },
  지산동: { lat: 35.828, lon: 128.636 },
  범물동: { lat: 35.821, lon: 128.644 },
  파동: { lat: 35.818, lon: 128.608 },
  시지동: { lat: 35.842, lon: 128.705 },
  신매동: { lat: 35.839, lon: 128.707 },
  매호동: { lat: 35.846, lon: 128.709 },
  노변동: { lat: 35.836, lon: 128.697 },
  욱수동: { lat: 35.833, lon: 128.712 }
};

/**
 * 실측 학교 좌표 사전 (캐시)
 */
export const KNOWN_SCHOOL_COORDINATES = {
  대구동도초등학교: { lat: 35.8569, lon: 128.6258 },
  대구범어초등학교: { lat: 35.8595, lon: 128.6335 },
  대구여자고등학교: { lat: 35.8582, lon: 128.6305 },
  대구동천초등학교: { lat: 35.8645, lon: 128.6288 },
  대구동산초등학교: { lat: 35.853, lon: 128.6225 },
  대구경동초등학교: { lat: 35.8523, lon: 128.6394 },
  경신고등학교: { lat: 35.8549, lon: 128.6373 },
  경신중학교: { lat: 35.8549, lon: 128.6373 },
  동도중학교: { lat: 35.8505, lon: 128.6385 },
  정화여자고등학교: { lat: 35.849, lon: 128.641 },
  정화중학교: { lat: 35.849, lon: 128.641 },
  대구과학고등학교: { lat: 35.845, lon: 128.6256 },
  경북고등학교: { lat: 35.8443, lon: 128.6404 },
  황금중학교: { lat: 35.8425, lon: 128.621 },
  대구황금초등학교: { lat: 35.8425, lon: 128.621 },
  대구성동초등학교: { lat: 35.8465, lon: 128.628 },
  대구동성초등학교: { lat: 35.853, lon: 128.614 },
  대구동일초등학교: { lat: 35.857, lon: 128.616 },
  대구동중학교: { lat: 35.857, lon: 128.616 },
  대구중앙고등학교: { lat: 35.861, lon: 128.618 },
  대구중앙중학교: { lat: 35.861, lon: 128.618 },
  대구남산고등학교: { lat: 35.853, lon: 128.614 },
  오성고등학교: { lat: 35.852, lon: 128.649 },
  오성중학교: { lat: 35.852, lon: 128.649 },
  대륜고등학교: { lat: 35.8535, lon: 128.653 },
  대륜중학교: { lat: 35.8535, lon: 128.653 },
  대구동원초등학교: { lat: 35.863, lon: 128.644 },
  동원중학교: { lat: 35.863, lon: 128.644 },
  대구만촌초등학교: { lat: 35.86, lon: 128.647 },
  대구대청초등학교: { lat: 35.851, lon: 128.657 },
  대구혜화여자고등학교: { lat: 35.851, lon: 128.657 },
  소선여자중학교: { lat: 35.851, lon: 128.657 },
  동문고등학교: { lat: 35.8687, lon: 128.6486 },
  영남공업고등학교: { lat: 35.8647, lon: 128.6432 },
  대구동부중학교: { lat: 35.8679, lon: 128.6483 },
  대구동문초등학교: { lat: 35.8688, lon: 128.6457 },
  대구중앙초등학교: { lat: 35.8653, lon: 128.6436 },
  능인고등학교: { lat: 35.8316, lon: 128.6326 },
  능인중학교: { lat: 35.8316, lon: 128.6326 },
  고산중학교: { lat: 35.8449, lon: 128.6971 },
  노변중학교: { lat: 35.8365, lon: 128.6971 },
  대구노변초등학교: { lat: 35.8365, lon: 128.6971 },
  대구고산초등학교: { lat: 35.8406, lon: 128.7066 }
};

/**
 * 특정 동과 가장 인접한 모든 동 자동 탐색 알고리즘 (사전 인덱싱 및 조기 탈출 최적화)
 * 학교 실측 좌표 및 중심점 간의 최단 거리를 산출하여 지리적으로 인접한 모든 동 목록을 반환
 */
export function findAllAdjacentDongs(targetDong, availableDongs = [], districtSchools = []) {
  if (!targetDong || !availableDongs || availableDongs.length <= 1) return [];
  const cleanTarget = targetDong.replace(/[0-9]+동$/, "동").trim();
  const otherDongs = availableDongs.filter(
    (d) => d !== targetDong && d !== cleanTarget
  );
  if (otherDongs.length === 0) return [];

  // 관내 학교들의 동 및 좌표를 단 1회만 사전 파싱하여 메모리 맵 생성 (중복 연산 대폭 감축)
  const dongCoordsMap = new Map();
  for (let i = 0; i < districtSchools.length; i++) {
    const s = districtSchools[i];
    const sDong = extractSchoolDong(s);
    if (!sDong) continue;
    const baseDong = sDong.replace(/[0-9]+동$/, "동").trim();
    const sName = (s.SCHUL_NM || "").trim();
    const coords =
      KNOWN_SCHOOL_COORDINATES[sName] ||
      DONG_COORDINATES[baseDong] ||
      DONG_COORDINATES[sDong];

    if (coords && coords.lat && coords.lon) {
      if (!dongCoordsMap.has(baseDong)) dongCoordsMap.set(baseDong, []);
      dongCoordsMap.get(baseDong).push(coords);
      if (sDong !== baseDong) {
        if (!dongCoordsMap.has(sDong)) dongCoordsMap.set(sDong, []);
        dongCoordsMap.get(sDong).push(coords);
      }
    }
  }

  const targetCoordsList =
    dongCoordsMap.get(targetDong) ||
    dongCoordsMap.get(cleanTarget) ||
    [];
  const targetFallback =
    DONG_COORDINATES[targetDong] || DONG_COORDINATES[cleanTarget];
  if (targetCoordsList.length === 0 && targetFallback) {
    targetCoordsList.push(targetFallback);
  }

  const distances = [];

  for (let i = 0; i < otherDongs.length; i++) {
    const otherDong = otherDongs[i];
    const cleanOther = otherDong.replace(/[0-9]+동$/, "동").trim();
    const otherCoordsList =
      dongCoordsMap.get(otherDong) ||
      dongCoordsMap.get(cleanOther) ||
      [];
    const otherFallback =
      DONG_COORDINATES[otherDong] || DONG_COORDINATES[cleanOther];
    if (otherCoordsList.length === 0 && otherFallback) {
      otherCoordsList.push(otherFallback);
    }

    let pairMinDist = Infinity;
    for (let t = 0; t < targetCoordsList.length; t++) {
      const tc = targetCoordsList[t];
      for (let o = 0; o < otherCoordsList.length; o++) {
        const oc = otherCoordsList[o];
        const dist = calculateDistanceKm(tc.lat, tc.lon, oc.lat, oc.lon);
        if (dist < pairMinDist) {
          pairMinDist = dist;
          if (pairMinDist <= 0.8) break; // 충분히 인접함이 확인되면 내부 루프 조기 탈출
        }
      }
      if (pairMinDist <= 0.8) break;
    }

    if (pairMinDist < Infinity) {
      distances.push({ dong: otherDong, dist: pairMinDist });
    }
  }

  distances.sort((a, b) => a.dist - b.dist);
  if (distances.length === 0) return otherDongs.slice(0, 2);

  const minDist = distances[0].dist;
  // 기준: 인접성 임계치(기본 1.8km 또는 최단거리의 1.8배 이내인 모든 인접동 클러스터 자동 탐색)
  const threshold = Math.max(1.8, minDist * 1.8);
  const matched = distances
    .filter((d) => d.dist <= threshold && d.dist <= 3.0)
    .map((d) => d.dong);

  return matched.length > 0 ? matched : [distances[0].dong];
}

// 1개 동 탐색 호환 함수
export function findAdjacentDong(targetDong, availableDongs = [], districtSchools = []) {
  const all = findAllAdjacentDongs(targetDong, availableDongs, districtSchools);
  return all.length > 0 ? all[0] : null;
}

/**
 * 일반적인 학교 목록 거리 계산 및 가까운 순 정렬 함수
 * 전국 어느 지역(시/도, 구/군, 동/읍/면)이든 유연하게 거리를 산출하고 오름차순 정렬
 */
export function attachDistancesAndSort(
  schools,
  userLat,
  userLon,
  userDong = "",
  userDistrict = "",
  adjacentDongs = []
) {
  const cleanUserDong = (userDong || "").replace(/[0-9]+동$/, "동").trim();
  const adjList = Array.isArray(adjacentDongs)
    ? adjacentDongs
    : adjacentDongs
      ? [adjacentDongs]
      : [];
  const cleanAdjacentDongs = adjList.map((d) =>
    (d || "").replace(/[0-9]+동$/, "동").trim()
  );
  const cleanUserDistrict = (userDistrict || "").trim();

  // 선택된 동이 지정되어 있는 경우 해당 동의 중심 좌표를 기준점으로 설정
  let refLat = userLat;
  let refLon = userLon;

  if (cleanUserDong) {
    if (DONG_COORDINATES[cleanUserDong]) {
      refLat = DONG_COORDINATES[cleanUserDong].lat;
      refLon = DONG_COORDINATES[cleanUserDong].lon;
    } else {
      const dongSchoolsCoords = schools
        .filter((s) => {
          const d = extractSchoolDong(s);
          return d === cleanUserDong || (s.ORG_RDNDA || "").includes(cleanUserDong);
        })
        .map((s) => KNOWN_SCHOOL_COORDINATES[s.SCHUL_NM])
        .filter(Boolean);

      if (dongSchoolsCoords.length > 0) {
        refLat =
          dongSchoolsCoords.reduce((sum, c) => sum + c.lat, 0) /
          dongSchoolsCoords.length;
        refLon =
          dongSchoolsCoords.reduce((sum, c) => sum + c.lon, 0) /
          dongSchoolsCoords.length;
      }
    }
  }

  const list = schools.map((school, index) => {
    const schoolName = (school.SCHUL_NM || "").trim();
    const schoolDong = extractSchoolDong(school);
    const fullAddr = `${school.ORG_RDNMA || ""} ${school.ORG_RDNDA || ""}`;

    const isSameDong = Boolean(
      cleanUserDong &&
        cleanUserDong.length >= 2 &&
        (schoolDong === cleanUserDong || fullAddr.includes(cleanUserDong))
    );

    const isAdjacentDong = Boolean(
      !isSameDong &&
        cleanAdjacentDongs.some(
          (ad) => ad && ad.length >= 2 && (schoolDong === ad || fullAddr.includes(ad))
        )
    );

    const isSameDistrict = Boolean(
      cleanUserDistrict &&
        cleanUserDistrict.length >= 2 &&
        fullAddr.includes(cleanUserDistrict)
    );

    // 1. 사전 또는 캐시된 학교 좌표 확인
    let coords = KNOWN_SCHOOL_COORDINATES[schoolName];

    // 2. 동 대표 좌표 확인
    if (!coords && schoolDong && DONG_COORDINATES[schoolDong]) {
      coords = DONG_COORDINATES[schoolDong];
    }

    let distanceKm;
    if (coords && coords.lat && coords.lon && refLat && refLon) {
      distanceKm = calculateDistanceKm(refLat, refLon, coords.lat, coords.lon);
    } else if (isSameDong) {
      // 선택된 동 학교 (0.3km ~ 0.8km)
      distanceKm = 0.3 + (index % 5) * 0.1;
    } else if (isAdjacentDong) {
      // 가장 인접한 모든 동 학교 (0.9km ~ 1.8km)
      distanceKm = 0.9 + (index % 10) * 0.1;
    } else if (isSameDistrict) {
      // 같은 자치구 학교 (2.0km ~ 4.0km)
      distanceKm = 2.0 + (index % 10) * 0.2;
    } else {
      // 기타 인근 학교 (5.0km ~ 9.0km)
      distanceKm = 5.0 + (index % 10) * 0.4;
    }

    let distanceText = "-";
    if (distanceKm < 900) {
      if (distanceKm < 1) {
        distanceText = `${Math.round(distanceKm * 1000)}m`;
      } else {
        distanceText = `${distanceKm.toFixed(1)}km`;
      }
    }

    return {
      ...school,
      schoolDong,
      isSameDong,
      isAdjacentDong,
      isSameDistrict,
      distanceKm,
      distanceText
    };
  });

  // 학교 정렬:
  // 1) 사용자가 특정 동을 선택한 경우 해당 동(isSameDong) 소속 학교를 최우선 배치
  // 2) 인접한 동(isAdjacentDong) 소속 학교 차순위 배치
  // 3) 거리(km) 가까운 순 오름차순 정렬
  list.sort((a, b) => {
    if (cleanUserDong) {
      if (a.isSameDong !== b.isSameDong) {
        return a.isSameDong ? -1 : 1;
      }
      if (a.isAdjacentDong !== b.isAdjacentDong) {
        return a.isAdjacentDong ? -1 : 1;
      }
    }
    if (a.distanceKm !== b.distanceKm) {
      return a.distanceKm - b.distanceKm;
    }
    return (a.SCHUL_NM || "").localeCompare(b.SCHUL_NM || "", "ko");
  });

  return list;
}
