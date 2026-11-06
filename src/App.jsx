import { useState, useEffect, useCallback, useRef } from "react";
import MealList from "./components/MealList";
import { OFFICES_OF_EDUCATION } from "./constants/offices";
import { getSurroundingDays } from "./utils/date";
import {
  getGeneralLocation,
  attachDistancesAndSort,
  extractSchoolDong,
  findAllAdjacentDongs,
  DONG_COORDINATES,
} from "./utils/geo";
import { fetchSchoolList, fetchTargetSchoolsDiet } from "./utils/neis";
import { AlertCircle, Loader2, UtensilsCrossed } from "lucide-react";
import "./App.css";

// 고정 학교 목록 로컬 스토리지 안전 저장 헬퍼
const savePinnedSchoolsToStorage = (updated) => {
  try {
    localStorage.setItem("pinned_schools_v1", JSON.stringify(updated));
    localStorage.setItem(
      "pinned_school_codes",
      JSON.stringify(updated.map((s) => s.schoolCode || s.SD_SCHUL_CODE))
    );
  } catch {
    // 스토리지 에러 무시
  }
};

// 학교급 판별 헬퍼 (초등/중학/고등 분류 보정)
const inferSchoolKind = (kind = "", name = "") => {
  const k = kind || "";
  const n = name || "";
  if (k.includes("초등") || n.includes("초등")) return "초등학교";
  if (k.includes("중학") || n.includes("중학교") || n.endsWith("중")) return "중학교";
  if (k.includes("고등") || n.includes("고등학교") || n.endsWith("고")) return "고등학교";
  return k || "고등학교";
};

function App() {
  // 위치 표시 텍스트 및 선택된 위치 상태 (시/도, 시/군/구, 동/읍/면)
  const [locationText, setLocationText] = useState("접속 위치 확인 중...");
  const [selectedOfficeCode, setSelectedOfficeCode] = useState("B10");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedDong, setSelectedDong] = useState("");
  const [availableDongs, setAvailableDongs] = useState([]);

  // 상단 고정 학교 목록 상태 (위치가 바뀌어도 영구 고정 유지)
  const [pinnedSchools, setPinnedSchools] = useState(() => {
    try {
      const saved = localStorage.getItem("pinned_schools_v1");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // pinnedSchools 동기화 Ref (비동기 함수 내부에서 즉시 최신 상태 참조)
  const pinnedSchoolsRef = useRef(pinnedSchools);
  useEffect(() => {
    pinnedSchoolsRef.current = pinnedSchools;
  }, [pinnedSchools]);

  // 현재 선택된 위치(동/구) 관할 학교 코드 집합 Ref
  const currentCandidateCodesRef = useRef(new Set());

  // 교육청별 학교 목록 메모리 캐시 (불필요한 중복 API 호출 방지)
  const cachedOfficeSchoolsRef = useRef({});

  // 오늘 기준으로 앞 7일, 오늘, 뒤 7일 (총 15일 범위)
  const [dateRange] = useState(() => getSurroundingDays(7, 7));

  // 주변 학교 급식 식단 데이터
  const [allMeals, setAllMeals] = useState([]);

  // 로딩 & 에러 상태
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    schoolName: "",
  });
  const [errorMessage, setErrorMessage] = useState("");

  // 접속 시 단 1회만 위치를 로드하도록 제어하는 Ref
  const hasInitializedRef = useRef(false);

  // 일반적인 주변 학교 1주일 식단 수집 함수
  const fetchNearbySchoolsMeals = useCallback(
    async (office, targetDistrict, targetDong, coords) => {
      setIsLoading(true);
      setErrorMessage("");
      setProgress({
        current: 0,
        total: 0,
        schoolName: "주변 학교 목록 조회 중...",
      });

      try {
        const currentOffice = office || OFFICES_OF_EDUCATION[0];
        const cleanDistrict = (targetDistrict || "").trim();
        const cleanDong = (targetDong || "").trim();
        const currentCoords = coords || {
          lat: currentOffice.lat,
          lon: currentOffice.lon,
        };

        // 1단계: 시도교육청 관내 학교 목록 조회 (캐시 활용)
        let allSchools = cachedOfficeSchoolsRef.current[currentOffice.code];
        if (!allSchools || allSchools.length === 0) {
          allSchools = await fetchSchoolList(currentOffice.code, 800);
          if (allSchools && allSchools.length > 0) {
            cachedOfficeSchoolsRef.current[currentOffice.code] = allSchools;
          }
        }

        if (!allSchools || allSchools.length === 0) {
          throw new Error(
            `${currentOffice.name}에서 조회 가능한 학교 정보가 없습니다.`,
          );
        }

        // 해당 자치구(구/군) 소속 학교 목록 필터링
        const districtSchools = cleanDistrict
          ? allSchools.filter((s) => {
              const addr = `${s.ORG_RDNMA || ""} ${s.ORG_RDNDA || ""}`;
              return addr.includes(cleanDistrict);
            })
          : allSchools;

        // 해당 자치구의 모든 동 목록 동적 추출 (드롭다운 옵션 제공)
        const dongSet = new Set();
        districtSchools.forEach((s) => {
          const d = extractSchoolDong(s);
          if (d) dongSet.add(d);
        });
        const dongsList = Array.from(dongSet).sort((a, b) =>
          a.localeCompare(b, "ko"),
        );
        setAvailableDongs(dongsList);

        // 2단계: 자치구 및 동 단위 학교 후보 선별 ("가장 인접한 모든 동 자동 탐색 알고리즘")
        let adjacentDongs = [];
        let candidateSchools = districtSchools;

        if (cleanDong) {
          adjacentDongs =
            findAllAdjacentDongs(cleanDong, dongsList, districtSchools) || [];

          // 선택된 동 학교 + 가장 인접한 모든 동 학교 선별
          candidateSchools = districtSchools.filter((s) => {
            const sDong = extractSchoolDong(s);
            const addr = `${s.ORG_RDNMA || ""} ${s.ORG_RDNDA || ""}`;
            const isMainDong =
              sDong === cleanDong || addr.includes(cleanDong);
            const isAdjDong = adjacentDongs.some(
              (ad) => sDong === ad || addr.includes(ad),
            );
            return isMainDong || isAdjDong;
          });

          // 만약 선택된 동 + 인접 동들의 학교 수가 부족한 경우(10개 미만) 자치구 학교로 보충
          if (candidateSchools.length < 10) {
            candidateSchools =
              districtSchools.length >= 10 ? districtSchools : allSchools.slice(0, 50);
          }
        }

        // 현재 위치(동/구) 대상 학교 코드 집합 갱신 (핀 해제 시 타 지역 학교 구별용)
        currentCandidateCodesRef.current = new Set(
          candidateSchools.map((s) => s.SD_SCHUL_CODE),
        );

        // 3단계: 접속 위치 기준 거리(km) 계산 및 '학교 거리 가까운 순 정렬'
        const sortedNearestSchools = attachDistancesAndSort(
          candidateSchools,
          currentCoords.lat,
          currentCoords.lon,
          cleanDong,
          cleanDistrict,
          adjacentDongs,
        );

        // 4단계: 1열 초등학교, 2열 중학교, 3열 고등학교 각 학교급별 최인접 학교 선별
        // "핀 고정하면 위치가 변해도 고정": 고정된 학교는 위치가 변해도 무조건 최우선 포함
        const currentPinned =
          pinnedSchoolsRef.current && pinnedSchoolsRef.current.length > 0
            ? pinnedSchoolsRef.current
            : (function () {
                try {
                  const raw = localStorage.getItem("pinned_schools_v1");
                  return raw ? JSON.parse(raw) : [];
                } catch {
                  return [];
                }
              })();

        const pinnedSchoolObjs = currentPinned
          .map((p) => {
            const code =
              typeof p === "string" ? p : p.schoolCode || p.SD_SCHUL_CODE;
            if (!code) return null;
            const rawName =
              (typeof p === "object" && (p.schoolName || p.SCHUL_NM)) || "";
            const rawKind =
              (typeof p === "object" &&
                (p.schoolKind || p.SCHUL_KND_SC_NM)) ||
              "";
            const inferredKind = inferSchoolKind(rawKind, rawName);

            return {
              SD_SCHUL_CODE: code,
              SCHUL_NM: rawName || "고정 학교",
              SCHUL_KND_SC_NM: inferredKind,
              ORG_RDNMA:
                (typeof p === "object" && (p.address || p.ORG_RDNMA)) || "",
              officeCode:
                (typeof p === "object" && p.officeCode) || currentOffice.code,
              isPinned: true,
              distanceKm: 0.1,
              distanceText: "고정",
            };
          })
          .filter(Boolean);

        const pinnedCodes = new Set(
          pinnedSchoolObjs.map((s) => s.SD_SCHUL_CODE),
        );

        // 1-Pass로 고정 학교 학교급별 분할
        const pinnedElem = [];
        const pinnedMid = [];
        const pinnedHigh = [];
        for (let i = 0; i < pinnedSchoolObjs.length; i++) {
          const s = pinnedSchoolObjs[i];
          const kind = s.SCHUL_KND_SC_NM || "";
          if (kind.includes("초등")) pinnedElem.push(s);
          else if (kind.includes("중학")) pinnedMid.push(s);
          else if (kind.includes("고등")) pinnedHigh.push(s);
        }

        // 1-Pass 및 조기 탈출(Early Exit)로 각 학교급별 상위 10개교 선별 (불필요한 반복 순회 제거)
        const localElem = [];
        const localMid = [];
        const localHigh = [];
        for (let i = 0; i < sortedNearestSchools.length; i++) {
          const s = sortedNearestSchools[i];
          if (pinnedCodes.has(s.SD_SCHUL_CODE)) continue;
          const kind = s.SCHUL_KND_SC_NM || "";
          if (kind.includes("초등") && localElem.length < 10) {
            localElem.push(s);
          } else if (kind.includes("중학") && localMid.length < 10) {
            localMid.push(s);
          } else if (kind.includes("고등") && localHigh.length < 10) {
            localHigh.push(s);
          }
          if (
            localElem.length >= 10 &&
            localMid.length >= 10 &&
            localHigh.length >= 10
          ) {
            break;
          }
        }

        const targetSchools = [
          ...pinnedElem,
          ...localElem,
          ...pinnedMid,
          ...localMid,
          ...pinnedHigh,
          ...localHigh,
        ];

        // 5단계: 선별된 학교들의 급식 식단 수집 (고정 학교 포함)
        const { allMeals: fetchedMeals } = await fetchTargetSchoolsDiet(
          currentOffice.code,
          targetSchools,
          dateRange.fromYmd,
          dateRange.toYmd,
          Math.max(36, targetSchools.length),
          (current, total, schoolName) => {
            setProgress({ current, total, schoolName });
          },
        );

        setAllMeals(fetchedMeals);
      } catch (err) {
        console.error("식단 조회 중 오류:", err);
        setErrorMessage(
          err.message ||
            "주변 학교 식단 정보를 가져오는 중 오류가 발생했습니다.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [dateRange],
  );

  // 일반적인 접속 위치 감지 및 식단 조회 함수 (전국 표준 로직)
  const detectLocationAndFetch = useCallback(
    async (isManualRefresh = false) => {
      try {
        let geoResult = null;

        // 수동 새로고침이 아닌 경우 세션 캐시 확인 (불필요한 반복 호출 방지)
        if (!isManualRefresh) {
          try {
            const cached = sessionStorage.getItem("user_geo_cache");
            if (cached) {
              geoResult = JSON.parse(cached);
            }
          } catch {
            // 캐시 파싱 에러 무시
          }
        }

        // 캐시가 없거나 수동 재확인인 경우 일반적인 위치 감지 실행
        if (!geoResult) {
          geoResult = await getGeneralLocation();
          try {
            sessionStorage.setItem("user_geo_cache", JSON.stringify(geoResult));
          } catch {
            // 스토리지 저장 에러 무시
          }
        }

        const matchedOffice =
          geoResult.matchedOffice || OFFICES_OF_EDUCATION[0];
        const detectedDistrict =
          geoResult.district || matchedOffice.districts[0] || "";
        const detectedDong = geoResult.dong || "";
        const fullLocation =
          geoResult.locationText ||
          `${matchedOffice.region} ${detectedDistrict} ${detectedDong}`.trim();
        const coords = { lat: geoResult.lat, lon: geoResult.lon };

        setSelectedOfficeCode(matchedOffice.code);
        setSelectedDistrict(detectedDistrict);
        setSelectedDong(detectedDong);
        setLocationText(fullLocation);

        await fetchNearbySchoolsMeals(
          matchedOffice,
          detectedDistrict,
          detectedDong,
          coords,
        );
      } catch (err) {
        console.error("위치 감지 실행 중 예외:", err);
        const defaultOffice = OFFICES_OF_EDUCATION[0];
        const defaultDistrict = defaultOffice.districts[0] || "중구";
        const defaultLocation = `${defaultOffice.region} ${defaultDistrict}`;
        const defaultCoords = {
          lat: defaultOffice.lat,
          lon: defaultOffice.lon,
        };

        setSelectedOfficeCode(defaultOffice.code);
        setSelectedDistrict(defaultDistrict);
        setSelectedDong("");
        setLocationText(defaultLocation);

        await fetchNearbySchoolsMeals(
          defaultOffice,
          defaultDistrict,
          "",
          defaultCoords,
        );
      }
    },
    [fetchNearbySchoolsMeals],
  );

  // 사용자 수동 위치 선택 메뉴 핸들러 (시/도, 시/군/구, 동/읍/면)
  const handleSelectLocation = useCallback(
    async (officeCode, districtName, dongName = "") => {
      const office =
        OFFICES_OF_EDUCATION.find((o) => o.code === officeCode) ||
        OFFICES_OF_EDUCATION[0];
      const targetDistrict = districtName || office.districts[0] || "";
      const targetDong = (dongName || "").trim();

      const fullLocation = [office.region, targetDistrict, targetDong]
        .filter(Boolean)
        .join(" ")
        .trim();

      setSelectedOfficeCode(office.code);
      setSelectedDistrict(targetDistrict);
      setSelectedDong(targetDong);
      setLocationText(fullLocation);

      const baseDong = targetDong ? targetDong.replace(/[0-9]+동$/, "동") : "";
      const targetCoords = (baseDong && DONG_COORDINATES[baseDong]) || {
        lat: office.lat,
        lon: office.lon,
      };

      await fetchNearbySchoolsMeals(
        office,
        targetDistrict,
        targetDong,
        targetCoords,
      );
    },
    [fetchNearbySchoolsMeals],
  );

  // 상단 핀 고정 토글 핸들러 (위치가 바뀌어도 고정 상태 및 식단 유지)
  const handleTogglePinSchool = useCallback(
    (schoolInfo) => {
      const schoolCode =
        typeof schoolInfo === "string"
          ? schoolInfo
          : schoolInfo.schoolCode || schoolInfo.SD_SCHUL_CODE;
      if (!schoolCode) return;

      setPinnedSchools((prev) => {
        const exists = prev.some(
          (s) => (s.schoolCode || s.SD_SCHUL_CODE) === schoolCode,
        );
        let updated;
        if (exists) {
          updated = prev.filter(
            (s) => (s.schoolCode || s.SD_SCHUL_CODE) !== schoolCode,
          );
          // 현재 위치 후보군(동/구)에 속하지 않는 학교(고정 기능으로 인해 외부에서 로드된 학교)인 경우 즉시 식단 목록에서 제거
          if (
            currentCandidateCodesRef.current.size > 0 &&
            !currentCandidateCodesRef.current.has(schoolCode)
          ) {
            setAllMeals((prevMeals) =>
              prevMeals.filter((m) => m.SD_SCHUL_CODE !== schoolCode),
            );
          }
        } else {
          const rawName =
            (typeof schoolInfo === "object" &&
              (schoolInfo.schoolName || schoolInfo.SCHUL_NM)) ||
            "";
          const rawKind =
            (typeof schoolInfo === "object" &&
              (schoolInfo.schoolKind || schoolInfo.SCHUL_KND_SC_NM)) ||
            "";
          const inferredKind = inferSchoolKind(rawKind, rawName);

          const schoolObj =
            typeof schoolInfo === "object"
              ? {
                  schoolCode,
                  SD_SCHUL_CODE: schoolCode,
                  schoolName: rawName,
                  SCHUL_NM: rawName,
                  schoolKind: inferredKind,
                  SCHUL_KND_SC_NM: inferredKind,
                  officeCode:
                    schoolInfo.officeCode ||
                    schoolInfo.ATPT_OFCDC_SC_CODE ||
                    selectedOfficeCode,
                  address: schoolInfo.address || schoolInfo.ORG_RDNMA || "",
                  ORG_RDNMA: schoolInfo.address || schoolInfo.ORG_RDNMA || "",
                  isPinned: true,
                }
              : {
                  schoolCode,
                  SD_SCHUL_CODE: schoolCode,
                  schoolKind: inferredKind,
                  SCHUL_KND_SC_NM: inferredKind,
                  isPinned: true,
                };
          updated = [schoolObj, ...prev];
        }

        savePinnedSchoolsToStorage(updated);
        return updated;
      });
    },
    [selectedOfficeCode],
  );

  // 접속 시 단 1회만 일반적 위치 감지 및 식단 조회 실행
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    detectLocationAndFetch(false);
  }, [detectLocationAndFetch]);

  return (
    <div className="app-layout">
      {/* 상단 사이트 헤더 */}
      <header className="app-header">
        <div className="header-container">
          <div className="header-brand">
            <UtensilsCrossed className="brand-icon" />
            <h1 className="brand-title">뭐 먹었지???</h1>
          </div>
        </div>
      </header>

      <main className="main-content">
        {/* 오류 알림 */}
        {errorMessage && (
          <div className="error-alert">
            <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-rose-800">{errorMessage}</div>
          </div>
        )}

        {/* 로딩 진행 바 */}
        {isLoading && (
          <div className="progress-card">
            <div className="progress-header">
              <div className="flex items-center space-x-2">
                <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                <span className="font-semibold text-gray-800">
                  {progress.total > 0
                    ? `[${progress.current}/${progress.total}] 개교 주변 학교 식단 수집 중...`
                    : progress.schoolName}
                </span>
              </div>
              <span className="text-xs font-bold text-indigo-600">
                {progress.total > 0
                  ? `${Math.round((progress.current / progress.total) * 100)}%`
                  : ""}
              </span>
            </div>

            {progress.total > 0 && (
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
                />
              </div>
            )}
            <div className="text-xs text-gray-500 mt-2">
              현재 처리 학교: <strong>{progress.schoolName}</strong>
            </div>
          </div>
        )}

        {/* 접속 위치 주변 학교 식단 (1열 초등, 2열 중학, 3열 고등) */}
        {!isLoading && allMeals.length > 0 && (
          <MealList
            allMeals={allMeals}
            locationText={locationText}
            selectedOfficeCode={selectedOfficeCode}
            selectedDistrict={selectedDistrict}
            selectedDong={selectedDong}
            availableDongs={availableDongs}
            pinnedSchools={pinnedSchools}
            onTogglePinSchool={handleTogglePinSchool}
            onSelectLocation={handleSelectLocation}
            onRefreshLocation={() => detectLocationAndFetch(true)}
            isRefreshing={isLoading}
          />
        )}
      </main>

      {/* 하단 푸터 */}
      <footer className="app-footer">
        <div className="footer-content">
          <p className="text-xs text-gray-500">
            교육부 NEIS Open API (<code>mealServiceDietInfo</code>,{" "}
            <code>schoolInfo</code>) 연동
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
