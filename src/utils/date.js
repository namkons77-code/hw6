// 날짜 관련 유틸리티 (오늘 기준 앞뒤 7일 계산 및 포맷팅)

export function formatDateYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function formatDisplayDate(dateStr) {
  let date;
  if (typeof dateStr === "string" && dateStr.length === 8) {
    const y = parseInt(dateStr.slice(0, 4), 10);
    const m = parseInt(dateStr.slice(4, 6), 10) - 1;
    const d = parseInt(dateStr.slice(6, 8), 10);
    date = new Date(y, m, d);
  } else if (dateStr instanceof Date) {
    date = dateStr;
  } else {
    return dateStr;
  }

  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const dayName = days[date.getDay()];
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${m}.${d}(${dayName})`;
}

/**
 * 오늘 기준으로 앞 7일, 오늘, 뒤 7일 (총 15일간)의 날짜 리스트 및 시작/종료 YMD 반환
 */
export function getSurroundingDays(daysBefore = 7, daysAfter = 7) {
  const dates = [];
  const today = new Date();

  for (let i = -daysBefore; i <= daysAfter; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push({
      dateObj: d,
      ymd: formatDateYMD(d),
      display: formatDisplayDate(d),
      isToday: i === 0,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      offsetDays: i
    });
  }

  return {
    fromYmd: dates[0].ymd,
    toYmd: dates[dates.length - 1].ymd,
    todayYmd: formatDateYMD(today),
    datesList: dates
  };
}

/**
 * 기존 코드 호환용 1주일 계산 함수 (필요시 사용)
 */
export function getUpcomingOneWeek(daysCount = 7) {
  return getSurroundingDays(0, daysCount - 1);
}
