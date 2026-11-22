/**
 * 모의 주식 웹게임 (개미광장) - 초기 설정값 (기획서 14쪽 기준)
 * 모든 규칙 수치를 한곳에서 조회하고 조정할 수 있도록 관리합니다.
 */
module.exports = {
  // 기초 자금 및 연간 지원금 (기획서 3쪽, 14쪽)
  INITIAL_CASH: 500000,          // 참가자 모두에게 2010년 첫 거래 전에 지급 (500,000원)
  ANNUAL_GRANT: 50000,           // 2011~2019년의 결과를 보여준 후 참가자에게 지급 (50,000원)

  // 유료 기사 공통 가격 공식 (기획서 3쪽, 14쪽)
  // 연간 지원금 지급 후 총자산 중앙값 * (기준 비율 * (1 + 인상률))을 1,000원 단위로 내림, 최소 1,000원
  ARTICLE_PRICE_RATE: 0.02,
  ARTICLE_PRICE_INCREASE_RATE: process.env.ARTICLE_PRICE_INCREASE_RATE
    ? Number(process.env.ARTICLE_PRICE_INCREASE_RATE)
    : 0.25,                        // 현행 가격 산정 비율 대비 25% 인상 (0.02 -> 0.025)
  ARTICLE_PRICE_UNIT: 1000,
  ARTICLE_MIN_PRICE: 1000,

  // 연도 설정 (기획서 1쪽, 2쪽, 14쪽)
  START_YEAR: 2010,
  FIRST_OPENING_YEAR: 2011,
  MILESTONE_OPENING_YEAR: 2012,  // 1차 완료 기준 목표 시점 (2012년 개장)
  MIDTERM_YEAR: 2015,            // 2015년 개장 중간 점검
  LAST_TRADING_YEAR: 2019,       // 2019년 마지막 거래
  SETTLEMENT_YEAR: 2020,         // 2020년 최종 정산

  // 구간별 제한 시간 제안값 (초 단위, 기획서 2쪽, 14쪽)
  DURATION_TUTORIAL_SEC: 45,       // 튜토리얼 45초
  DURATION_TRADING_2010_SEC: 45,   // 2010년 첫 거래 45초
  DURATION_TRADING_YEAR_SEC: 90,   // 2011~2019년 거래 회당 90초
  DURATION_OPENING_RESULT_SEC: 8,  // 일반 개장 결과 8초
  DURATION_MIDTERM_RESULT_SEC: 20, // 2015년 중간 점검 결과 20초

  // 2012년 개장 도달 시 자동 시간 만료 없이 대기할지 여부 (일반 플레이에서는 false로 두어 정상 진행)
  HOLD_AT_2012_OPENING: false,

  // 참가 인원 및 방 세션 규칙 (기획서 11쪽, 14쪽)
  FRIEND_ROOM_MIN_PLAYERS: 2,
  FRIEND_ROOM_MAX_PLAYERS: 6,
  FRIEND_ROOM_DEFAULT_CAPACITY: 4,
  SOLO_BOT_COUNT: 3,
  ROOM_CODE_LENGTH: 6,
  NICKNAME_MIN_LENGTH: 2,
  NICKNAME_MAX_LENGTH: 12,
  ROOM_NAME_MIN_LENGTH: 2,
  ROOM_NAME_MAX_LENGTH: 24,

  // 서버 포트
  PORT: process.env.PORT ? Number(process.env.PORT) : 3000
};
