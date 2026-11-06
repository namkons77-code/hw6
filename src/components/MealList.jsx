import { useState, useMemo, memo } from "react";
import { Search, MapPin, Navigation, GraduationCap, Pin } from "lucide-react";
import { formatDisplayDate, formatDateYMD } from "../utils/date";
import { OFFICES_OF_EDUCATION } from "../constants/offices";

// 학교급별 테두리 클래스 매핑
const getSchoolKindBorderClass = (kind = "") => {
  if (kind.includes("초등")) return "border-yellow";
  if (kind.includes("중학")) return "border-blue";
  if (kind.includes("고등")) return "border-red";
  return "border-gray";
};

// 단일 식단 카드 컴포넌트 (Memoization 및 핀 고정 버튼 포함)
const MealCard = memo(function MealCard({ item, isPinned, onTogglePin }) {
  const borderClass = getSchoolKindBorderClass(item.schoolKind);

  return (
    <div className={`dish-clean-card ${borderClass} ${isPinned ? "is-pinned" : ""}`}>
      {/* 카드 상단: 학교명 + 오른쪽 상단 핀 고정 버튼 */}
      <div className="dish-card-header">
        <div className="dish-title-wrapper">
          <span className="dish-school-title">{item.schoolName}</span>
          {isPinned && <span className="pinned-badge">고정됨</span>}
        </div>
        <button
          type="button"
          onClick={() => onTogglePin && onTogglePin(item)}
          className={`btn-pin ${isPinned ? "pinned" : ""}`}
          title={isPinned ? "상단 고정 해제" : "상단에 고정"}
          aria-label={isPinned ? "상단 고정 해제" : "상단에 고정"}
        >
          <Pin className="pin-icon" />
        </button>
      </div>

      {/* 카드 본문: 순수 요리명 칩만 표시 */}
      <div className="pure-dishes-box">
        <div className="pure-dishes-chips">
          {item.pureDishes.map((dish, idx) => (
            <span key={idx} className="pure-dish-pill">
              {dish}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});

export default function MealList({
  allMeals = [],
  locationText,
  selectedOfficeCode = "B10",
  selectedDistrict = "",
  selectedDong = "",
  availableDongs = [],
  pinnedSchools = [],
  onTogglePinSchool,
  onSelectLocation,
  onRefreshLocation,
  isRefreshing = false
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [userSelectedDate, setUserSelectedDate] = useState("");

  // 현재 선택된 교육청 객체 및 산하 시/군/구 목록
  const currentOffice = useMemo(() => {
    return (
      OFFICES_OF_EDUCATION.find((o) => o.code === selectedOfficeCode) ||
      OFFICES_OF_EDUCATION[0]
    );
  }, [selectedOfficeCode]);

  const availableDistricts = useMemo(() => {
    return currentOffice.districts || [];
  }, [currentOffice]);

  // 시/도 변경 이벤트 핸들러
  const handleOfficeChange = (e) => {
    const newCode = e.target.value;
    const targetOffice =
      OFFICES_OF_EDUCATION.find((o) => o.code === newCode) ||
      OFFICES_OF_EDUCATION[0];
    const defaultDistrict = targetOffice.districts[0] || "";
    if (onSelectLocation) {
      onSelectLocation(newCode, defaultDistrict, "");
    }
  };

  // 시/군/구 변경 이벤트 핸들러
  const handleDistrictChange = (e) => {
    const newDistrict = e.target.value;
    if (onSelectLocation) {
      onSelectLocation(selectedOfficeCode, newDistrict, "");
    }
  };

  // 동/읍/면 변경 이벤트 핸들러
  const handleDongChange = (e) => {
    const newDong = e.target.value;
    if (onSelectLocation) {
      onSelectLocation(selectedOfficeCode, selectedDistrict, newDong);
    }
  };

  // 상단 고정된 학교 코드 집합 (O(1) 빠른 조회를 위한 Set)
  const pinnedCodesSet = useMemo(() => {
    return new Set(
      pinnedSchools.map((s) =>
        typeof s === "string" ? s : s.schoolCode || s.SD_SCHUL_CODE
      )
    );
  }, [pinnedSchools]);

  // 오늘 날짜 YMD (예: '20261106')
  const todayYmd = useMemo(() => formatDateYMD(new Date()), []);

  // 앞뒤 7일간의 유효 급식 날짜 목록 (중복 제거 및 정렬)
  const availableDates = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < allMeals.length; i++) {
      if (allMeals[i].MLSV_YMD) set.add(allMeals[i].MLSV_YMD);
    }
    return Array.from(set).sort();
  }, [allMeals]);

  // 실제 활성 날짜 (선택 날짜 -> 오늘 -> 가장 가까운 미래 급식일 -> 첫 번째 급식일)
  const effectiveDate = useMemo(() => {
    if (userSelectedDate && availableDates.includes(userSelectedDate)) {
      return userSelectedDate;
    }
    if (availableDates.includes(todayYmd)) {
      return todayYmd;
    }
    const nextDate = availableDates.find((d) => d >= todayYmd);
    return nextDate || availableDates[0] || todayYmd;
  }, [userSelectedDate, availableDates, todayYmd]);

  // 선택된 날짜 식단 필터링 및 단일 패스(1-pass)로 1열/2열/3열 분할 (핀 고정된 학교 최우선 상단 정렬, O(N) 무정렬 선형 처리)
  const { elementaryMeals, middleMeals, highMeals } = useMemo(() => {
    const elemPinned = [];
    const elemNormal = [];
    const midPinned = [];
    const midNormal = [];
    const highPinned = [];
    const highNormal = [];
    const q = searchTerm.trim().toLowerCase();

    for (let i = 0; i < allMeals.length; i++) {
      const m = allMeals[i];
      // 1. 선택된 날짜 매칭 (가장 먼저 필터링하여 불필요한 검색 연산 차단)
      if (m.MLSV_YMD !== effectiveDate) continue;

      // 2. 검색어 매칭
      if (q) {
        const matchesSchool = m.schoolName && m.schoolName.toLowerCase().includes(q);
        const matchesDish = m.pureDishes.some((d) => d.toLowerCase().includes(q));
        if (!matchesSchool && !matchesDish) continue;
      }

      // 3. 학교급별 3열 분할 및 핀 고정 학교 최우선 분리 (O(N) 단일 패스로 원본 거리순 정렬 완벽 보존)
      const isPinned = pinnedCodesSet.has(m.SD_SCHUL_CODE);
      const kind = m.schoolKind || "";
      if (kind.includes("초등")) {
        if (isPinned) elemPinned.push(m);
        else elemNormal.push(m);
      } else if (kind.includes("중학")) {
        if (isPinned) midPinned.push(m);
        else midNormal.push(m);
      } else if (kind.includes("고등")) {
        if (isPinned) highPinned.push(m);
        else highNormal.push(m);
      }
    }

    return {
      elementaryMeals: [...elemPinned, ...elemNormal],
      middleMeals: [...midPinned, ...midNormal],
      highMeals: [...highPinned, ...highNormal]
    };
  }, [allMeals, effectiveDate, searchTerm, pinnedCodesSet]);

  return (
    <section className="dish-only-section">
      {/* 1. 상단 위치 선택 메뉴 및 접속 위치 정보 */}
      <div className="location-info-header">
        <div className="location-left">
          {/* 위치 선택 메뉴 (접속위치 앞에 위치) */}
          <div className="location-select-menu">
            <span className="location-menu-label">
              <MapPin className="w-3.5 h-3.5 mr-1 text-indigo-600" />
              위치 선택
            </span>
            <select
              value={selectedOfficeCode}
              onChange={handleOfficeChange}
              disabled={isRefreshing}
              className="location-dropdown"
              title="시/도 선택"
            >
              {OFFICES_OF_EDUCATION.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.shortName || o.region}
                </option>
              ))}
            </select>

            <select
              value={selectedDistrict}
              onChange={handleDistrictChange}
              disabled={isRefreshing}
              className="location-dropdown"
              title="시/군/구 선택"
            >
              {availableDistricts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              value={selectedDong}
              onChange={handleDongChange}
              disabled={isRefreshing}
              className="location-dropdown"
              title="동/읍/면 선택"
            >
              <option value="">전체 (동)</option>
              {availableDongs.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* 현재 감지된 접속 위치 */}
          <div className="location-detected-info">
            <span className="location-dong-pill">
              접속 위치
            </span>
            <h2 className="location-address-title">{locationText}</h2>
          </div>
        </div>

        <div className="location-right">
          <button
            type="button"
            onClick={onRefreshLocation}
            disabled={isRefreshing}
            className="btn-recheck-location"
            title="현재 위치 재감지"
          >
            <Navigation className="w-3.5 h-3.5 mr-1" />
            {isRefreshing ? "감지 중..." : "위치 재확인"}
          </button>
        </div>
      </div>

      {/* 2. 날짜 필터 및 검색창 바 (1줄 가로 배치) */}
      <div className="averages-filter-bar">
        {/* 날짜 선택 필터 (가로 스크롤 가능) */}
        <div className="date-filter-group">
          {availableDates.map((ymd) => {
            const isToday = ymd === todayYmd;
            return (
              <button
                key={ymd}
                type="button"
                onClick={() => setUserSelectedDate(ymd)}
                className={`filter-kind-btn ${effectiveDate === ymd ? "active" : ""} ${
                  isToday ? "btn-today" : ""
                }`}
              >
                {isToday ? `오늘 ${formatDisplayDate(ymd)}` : formatDisplayDate(ymd)}
              </button>
            );
          })}
        </div>

        {/* 학교명 / 요리명 검색창 */}
        <div className="search-input-box">
          <Search className="search-input-icon" />
          <input
            type="text"
            placeholder="학교명 또는 요리명 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="card-search-field"
          />
        </div>
      </div>

      {/* 3. 3열 레이아웃: 1열 초등학교, 2열 중학교, 3열 고등학교 */}
      <div className="three-columns-grid">
        {/* 1열: 초등학교 */}
        <div className="school-level-column column-elementary">
          <div className="column-cards-list">
            {elementaryMeals.length === 0 ? (
              <div className="column-empty-state">
                <GraduationCap className="w-8 h-8 text-amber-300 mx-auto mb-1.5" />
                <p>선택하신 날짜에 초등학교 급식 식단이 없습니다.</p>
              </div>
            ) : (
              elementaryMeals.map((item, idx) => (
                <MealCard
                  key={`${item.SD_SCHUL_CODE}_${item.MLSV_YMD}_${idx}`}
                  item={item}
                  isPinned={pinnedCodesSet.has(item.SD_SCHUL_CODE)}
                  onTogglePin={onTogglePinSchool}
                />
              ))
            )}
          </div>
        </div>

        {/* 2열: 중학교 */}
        <div className="school-level-column column-middle">
          <div className="column-cards-list">
            {middleMeals.length === 0 ? (
              <div className="column-empty-state">
                <GraduationCap className="w-8 h-8 text-blue-300 mx-auto mb-1.5" />
                <p>선택하신 날짜에 중학교 급식 식단이 없습니다.</p>
              </div>
            ) : (
              middleMeals.map((item, idx) => (
                <MealCard
                  key={`${item.SD_SCHUL_CODE}_${item.MLSV_YMD}_${idx}`}
                  item={item}
                  isPinned={pinnedCodesSet.has(item.SD_SCHUL_CODE)}
                  onTogglePin={onTogglePinSchool}
                />
              ))
            )}
          </div>
        </div>

        {/* 3열: 고등학교 */}
        <div className="school-level-column column-high">
          <div className="column-cards-list">
            {highMeals.length === 0 ? (
              <div className="column-empty-state">
                <GraduationCap className="w-8 h-8 text-rose-300 mx-auto mb-1.5" />
                <p>선택하신 날짜에 고등학교 급식 식단이 없습니다.</p>
              </div>
            ) : (
              highMeals.map((item, idx) => (
                <MealCard
                  key={`${item.SD_SCHUL_CODE}_${item.MLSV_YMD}_${idx}`}
                  item={item}
                  isPinned={pinnedCodesSet.has(item.SD_SCHUL_CODE)}
                  onTogglePin={onTogglePinSchool}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
