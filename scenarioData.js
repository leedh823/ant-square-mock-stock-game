/**
 * 모의 주식 웹게임 (개미광장) - 동적 시나리오 · 2~6년 장기 연쇄 사건 · 유료 단서 유형 선택(일정 단서 / 사업 리스크 단서) 생성 엔진
 *
 * 핵심 설계:
 * 1. 바이오·조선·반도체의 장기 사건(2~6년 아크)이 진행되는 연도에는 각 종목당 2개의 선택형 유료 단서
 *    - '일정 단서' (clueType: 'schedule') : 언제 심사·납품·발표·정산이 이뤄지고 시세에 반영될지 추리
 *    - '사업 리스크 단서' (clueType: 'risk') : 무엇 때문에 계획이 지연되거나 무산될 수 있는지(보증 한도, 원가, 수율, 부작용 등) 추리
 *    를 제공합니다. 같은 참가자는 같은 종목·같은 거래 연도에 두 유형 중 하나만 구매할 수 있습니다.
 * 2. 일반 단년 사건과 장기 사건이 없는 연도의 종목에는 기존처럼 종목당 유료 기사 1개(단일 단서)를 제공합니다.
 * 3. 모든 단서는 구매 시점에 실제로 알 수 있는 사실만 담으며, 미래 개장가·확정 등락률(% 수치)·최종 계약 성사 결과를 미리 노출하지 않습니다.
 */

const crypto = require('node:crypto');

const STOCKS = [
  {
    id: 'a_bio',
    name: 'A바이오',
    displayName: 'A 바이오',
    badge: '바',
    industry: '바이오',
    publicBusiness: '신약 연구·개발',
    description: '대사질환 및 면역 신약 파이프라인 연구·개발',
    basePriceRange: [18000, 28000]
  },
  {
    id: 'b_bio',
    name: 'B바이오',
    displayName: 'B 바이오',
    badge: '바',
    industry: '바이오',
    publicBusiness: '신약 연구·개발',
    description: '합성신약 및 바이오 의약품 연구·개발',
    basePriceRange: [14000, 23000]
  },
  {
    id: 'a_enter',
    name: 'A엔터',
    displayName: 'A 엔터',
    badge: '엔',
    industry: '엔터',
    publicBusiness: '아티스트 기획·공연·음반',
    description: '글로벌 콘서트 투어 기획 및 음반 제작',
    basePriceRange: [15000, 25000]
  },
  {
    id: 'b_enter',
    name: 'B엔터',
    displayName: 'B 엔터',
    badge: '엔',
    industry: '엔터',
    publicBusiness: '영화·드라마 제작 및 판권 판매',
    description: '텐트폴 드라마·영화 제작 및 글로벌 OTT 판권 공급',
    basePriceRange: [12000, 21000]
  },
  {
    id: 'a_semi',
    name: 'A반도체',
    displayName: 'A 반도체',
    badge: '반',
    industry: '반도체',
    publicBusiness: '메모리 제조',
    description: 'D램 및 낸드플래시 메모리 반도체 생산',
    basePriceRange: [24000, 36000]
  },
  {
    id: 'b_semi',
    name: 'B반도체',
    displayName: 'B 반도체',
    badge: '반',
    industry: '반도체',
    publicBusiness: '반도체 장비 공급',
    description: '반도체 전공정 증착·식각 설비 제작 및 납품',
    basePriceRange: [19000, 30000]
  },
  {
    id: 'a_food',
    name: 'A식품',
    displayName: 'A 식품',
    badge: '식',
    industry: '식품',
    publicBusiness: '곡물 기반 가공식품',
    description: '제분·사료·간편식 제조 및 국내외 식품 유통',
    basePriceRange: [8000, 15000]
  },
  {
    id: 'a_game',
    name: 'A게임',
    displayName: 'A 게임',
    badge: '게',
    industry: '게임',
    publicBusiness: '모바일 게임 개발·서비스',
    description: '모바일 RPG 개발 및 글로벌 라이브 서비스',
    basePriceRange: [11000, 19000]
  },
  {
    id: 'a_ship',
    name: 'A조선',
    displayName: 'A 조선',
    badge: '조',
    industry: '조선',
    publicBusiness: '대형 선박 건조',
    description: '초대형 컨테이너선 및 LNG 운반선 건조·수출',
    basePriceRange: [16000, 26000]
  },
  {
    id: 'a_air',
    name: 'A항공',
    displayName: 'A 항공',
    badge: '항',
    industry: '항공',
    publicBusiness: '국제선 여객 운송',
    description: '중·단거리 및 장거리 국제선 여객·화물 항공 운송',
    basePriceRange: [12000, 20000]
  }
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const OPENING_2011_REASONS = {
  a_bio: {
    up: [
      '신약 후보물질 초기 전임상 데이터 호조와 연구 인력 확충이 반영됐습니다.',
      '글로벌 학회 초기 후보물질 발표 기대감과 특허 출원이 반영됐습니다.'
    ],
    down: [
      '초기 후보물질 탐색 비용 증가와 연구 설비 선투입 부담으로 하락했습니다.',
      '전임상 독성 데이터 보완 시험에 따른 연구개발비 증가가 반영됐습니다.'
    ]
  },
  b_bio: {
    up: [
      '바이오 공정 기술 협약 및 초기 연구 파이프라인 기대감이 반영됐습니다.',
      '원료의약품 배양 수율 개선 및 위탁연구 계약 유입이 반영됐습니다.'
    ],
    down: [
      '기초 독성 시험 일정 보완과 초기 연구개발비 지출로 조정됐습니다.',
      '신규 연구동 클린룸 설비 투자 비용이 선반영되어 하락했습니다.'
    ]
  },
  a_enter: {
    up: [
      '소속 아티스트 음반 판매 호조와 국내외 콘서트 매진이 반영됐습니다.',
      '신인 그룹 데뷔 앨범 흥행과 음원 스트리밍 매출 증가가 반영됐습니다.'
    ],
    down: [
      '신규 아티스트 데뷔 프로모션 비용 증가로 단기 이익이 축소됐습니다.',
      '주요 아티스트 컴백 일정 순연으로 분기 매출이 이월됐습니다.'
    ]
  },
  b_enter: {
    up: [
      '주말 드라마 시청률 흥행과 해외 방영권 선판매 실적이 반영됐습니다.',
      '텐트폴 영화 배급 흥행 및 부가 판권 정산 이익이 반영됐습니다.'
    ],
    down: [
      '차기 대작 드라마 세트장 구축 등 선투입 제작비 부담이 반영됐습니다.',
      '신작 영화 마케팅 비용 증가 대비 관객 수 부진이 반영됐습니다.'
    ]
  },
  a_semi: {
    up: [
      '모바일 및 서버용 D램 고정거래가격 상승으로 실적이 개선됐습니다.',
      '프리미엄 스마트폰향 모바일 메모리 출하 확대가 반영됐습니다.'
    ],
    down: [
      'PC용 메모리 현물 가격 조정과 재고 평가 손실이 반영됐습니다.',
      '글로벌 PC 출하량 둔화에 따른 범용 메모리 단가 하락이 반영됐습니다.'
    ]
  },
  b_semi: {
    up: [
      '반도체 미세공정 전환에 따른 핵심 식각·증착 장비 수주가 반영됐습니다.',
      '국내외 파운드리 및 메모리 라인용 검사 장비 납품 증가가 반영됐습니다.'
    ],
    down: [
      '고객사 라인 투자 일정 조정으로 장비 납품 매출 인식이 이월됐습니다.',
      '차세대 장비 시제품 개발비 증가로 단기 영업이익률이 낮아졌습니다.'
    ]
  },
  a_food: {
    up: [
      '주력 가공식품 가격 인상과 간편식 판매량 증가가 반영됐습니다.',
      '해외 라면·스낵 수출 호조와 공장 가동률 상승이 반영됐습니다.'
    ],
    down: [
      '원곡 수입 단가 및 물류비 상승으로 원가율 부담이 반영됐습니다.',
      '유통 채널 판촉비 경쟁 심화로 영업마진이 소폭 축소됐습니다.'
    ]
  },
  a_game: {
    up: [
      '기존 라이브 모바일 게임의 대규모 업데이트 흥행이 반영됐습니다.',
      '주력 RPG의 시즌 이벤트 매출 반등과 해외 로열티 유입이 반영됐습니다.'
    ],
    down: [
      '차기 신작 개발 인력 채용과 마케팅 비용 선집행이 반영됐습니다.',
      '기존 서비스 게임의 자연 매출 감소와 서버 개편 비용이 반영됐습니다.'
    ]
  },
  a_ship: {
    up: [
      '글로벌 해상 물동량 회복과 컨테이너선 신규 수주 실적이 반영됐습니다.',
      '고부가 가스운반선 건조 인도 대금 유입으로 수익성이 개선됐습니다.'
    ],
    down: [
      '철강 후판 가격 인상과 환율 변동에 따른 건조 원가 부담이 반영됐습니다.',
      '저가 수주 선박 건조 비중 영향으로 단기 마진이 축소됐습니다.'
    ]
  },
  a_air: {
    up: [
      '해외여행 수요 회복에 따른 국제선 여객 탑승률 상승이 반영됐습니다.',
      'IT·반도체 항공 화물 운임 강세와 여객 노선 호조가 반영됐습니다.'
    ],
    down: [
      '국제 유가 상승으로 인한 항공유 유류비 부담이 반영됐습니다.',
      '환율 상승에 따른 항공기 리스료 및 외화 부채 평가 부담이 반영됐습니다.'
    ]
  }
};

/**
 * 일반 단년 사건 템플릿 (장기 사건이 없는 해에 종목당 1개 유료 기사로 제공)
 */
const SINGLE_YEAR_TEMPLATES = {
  a_enter: [
    {
      eventKey: 'enter_world_tour_venue',
      industry: '엔터',
      freeTitle: '해외 공연 수요 회복에 월드투어 추가 편성 검토',
      freeSummary: '주요 도시 티켓 판매 호조… 현지 공연장 대관료와 장비 운송료 분담 조건이 변수',
      freeBody: '글로벌 주요 도시의 콘서트 티켓 판매가 예상을 웃돌자 기획사들이 추가 공연을 검토하고 있다. 다만 현지 공연장 대관료와 장비 운송료도 함께 올라 계약 조건에 따라 실제 수익성은 달라질 전망이다.',
      paidTopic: '투어 대관료 정산 조건',
      outcomes: [
        {
          outcomeId: 'tour_promoter_covers_70',
          isPositive: true,
          rateRange: [0.09, 0.24],
          paidPostTitle: 'A엔터, 현지 주최 측 추가 공연 대관료 70% 부담 합의',
          paidBody: '현지 주최 측이 추가 공연 대관료의 70%를 부담하기로 했다. A 엔터는 미니멈 개런티와 함께 티켓 매출 일부를 정산받는 조건으로 계약을 마쳤다.',
          paidHighlight: '대관료 비용 부담 완화로 추가 공연 정산 이익이 반영될 예정입니다.',
          openingReason: '현지 주최 측 대관료 70% 분담 및 해외 투어 추가 공연 수익이 반영됐습니다.'
        },
        {
          outcomeId: 'tour_cost_overrun',
          isPositive: false,
          rateRange: [-0.18, -0.07],
          paidPostTitle: 'A엔터, 현지 대관료·항공 운송비 상승분 자체 부담 구조',
          paidBody: '추가 공연 대관료와 무대 장비 항공 운송비가 크게 올랐으나 현지 프로모터와의 분담 협의가 난항을 겪으며 A 엔터가 비용 대부분을 부담하는 조건으로 진행 중이다.',
          paidHighlight: '대관료·운송비 부담 증가로 공연 마진이 낮아질 위험이 있습니다.',
          openingReason: '해외 공연 대관료 및 장비 운송비 급등 부담이 반영되어 하락했습니다.'
        }
      ]
    },
    {
      eventKey: 'enter_album_merch_platform',
      industry: '엔터',
      freeTitle: '음반 초동 판매 경쟁과 글로벌 팬덤 플랫폼 MD(굿즈) 사업 확대',
      freeSummary: '음반 출하량과 자체 커머스 굿즈 물류 원가 관리에 시장 관심 집중',
      freeBody: '기획사들이 주력 아티스트의 정규 앨범 발매와 함께 글로벌 팬덤 플랫폼을 통한 굿즈(MD) 직판 사업을 확대하고 있다. 물류 원가와 재고 관리 여부가 영업이익을 가를 전망이다.',
      paidTopic: '음반·MD 정산 및 물류비',
      outcomes: [
        {
          outcomeId: 'merch_high_margin_hit',
          isPositive: true,
          rateRange: [0.10, 0.23],
          paidPostTitle: 'A엔터, 정규 앨범 선주문 호조 및 고마진 디지털 MD 비중 확대',
          paidBody: 'A 엔터 주력 그룹의 신보 선주문량이 자체 최고치를 기록 중이며, 원가율이 낮은 디지털 콘텐츠와 투어 응원봉 물량이 조기 소진되고 있다.',
          paidHighlight: '음반 선주문 호조와 고마진 MD 판매로 수익성 개선이 기대됩니다.',
          openingReason: '주력 아티스트 정규 앨범 흥행 및 글로벌 팬덤 MD 고마진 매출이 반영됐습니다.'
        },
        {
          outcomeId: 'merch_inventory_writeoff',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'A엔터, 해외 물류비 상승 및 시즌 굿즈 미판매 재고 부담',
          paidBody: 'A 엔터가 해외 배송망 개편 과정에서 항공 물류비 부담이 늘었고, 대량 생산한 기획 굿즈 일부가 미판매 재고로 남아 재고 충당금 설정 가능성이 제기됐다.',
          paidHighlight: '해외 배송 원가 상승과 굿즈 재고 부담이 확인됐습니다.',
          openingReason: '팬덤 커머스 해외 물류비 증가 및 시즌 MD 재고 평가손실이 반영됐습니다.'
        }
      ]
    },
    {
      eventKey: 'enter_artist_renewal_ip',
      industry: '엔터',
      freeTitle: '주요 아티스트 전속계약 재계약 시즌 도래와 IP 수익 배분 협상',
      freeSummary: '핵심 매출원 아티스트 재계약 진행 상황과 계약금·인세 조건이 관건',
      freeBody: '엔터 업계의 핵심 매출을 담당하는 간판 아티스트들의 전속계약 만료 시점이 다가오면서 재계약 조건 협상이 한창이다. 재계약 성사 시점과 수익 배분율 조정이 향후 실적을 좌우할 전망이다.',
      paidTopic: '전속계약 재계약 조건',
      outcomes: [
        {
          outcomeId: 'renewal_full_group_success',
          isPositive: true,
          rateRange: [0.11, 0.26],
          paidPostTitle: 'A엔터, 간판 아티스트 전원 재계약 합의 및 글로벌 광고 계약 유입',
          paidBody: 'A 엔터의 핵심 매출 비중을 차지하는 간판 그룹 전원이 재계약 조건에 합의했다. 하반기 완전체 활동 일정과 글로벌 브랜드 광고 계약도 예정대로 추진된다.',
          paidHighlight: '전원 재계약 합의와 광고 일정 확정으로 안정적인 매출 흐름이 확인됐습니다.',
          openingReason: '간판 아티스트 전원 재계약 타결 및 글로벌 광고 수익 유입이 반영됐습니다.'
        },
        {
          outcomeId: 'renewal_bonus_burden',
          isPositive: false,
          rateRange: [-0.17, -0.07],
          paidPostTitle: 'A엔터, 재계약 협상 장기화로 완전체 컴백 연기 및 정산율 상향 부담',
          paidBody: 'A 엔터 주요 아티스트와의 재계약 조건 조율이 길어지면서 하반기 완전체 앨범 발매 일정이 순연됐다. 아티스트 측의 정산 비율 상향 요구로 원가 부담도 커진 상태다.',
          paidHighlight: '컴백 일정 순연과 정산 비용 증가 부담이 확인됐습니다.',
          openingReason: '재계약 협상에 따른 완전체 활동 공백 및 정산 비용 증가가 반영됐습니다.'
        }
      ]
    }
  ],

  b_enter: [
    {
      eventKey: 'b_enter_ott_series',
      industry: '엔터',
      freeTitle: '글로벌 OTT, 국내 드라마 제작사와 텐트폴 판권 협상',
      freeSummary: '대작 시리즈 제작비 선투입 규모와 판권 대금 정산 시점이 핵심',
      freeBody: '글로벌 OTT 플랫폼이 국내 드라마 제작사들과 시즌제 텐트폴 작품 계약을 논의하고 있다. 선투입 제작비 회수 시점과 해외 판권 정산 조건에 따라 실적이 엇갈릴 전망이다.',
      paidTopic: '판권 계약 및 정산 일정',
      outcomes: [
        {
          outcomeId: 'ott_upfront_settlement',
          isPositive: true,
          rateRange: [0.09, 0.25],
          paidPostTitle: 'B엔터, 글로벌 OTT 오리지널 납품 마스터링 완료 및 연내 일괄 정산 일정',
          paidBody: 'B 엔터가 제작한 대작 드라마가 글로벌 OTT에 최종 마스터본 납품을 마쳤다. 계약 조건에 따라 제작비와 판권 수익이 다음 개장 전 일괄 정산될 예정이다.',
          paidHighlight: 'OTT 납품 완료와 연내 판권 대금 정산 일정이 확인됐습니다.',
          openingReason: '글로벌 OTT 드라마 납품 완료 및 판권 정산 수익이 반영됐습니다.'
        },
        {
          outcomeId: 'ott_production_cost_delay',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'B엔터, 대작 드라마 후반 CG 작업 지연으로 납품 및 정산 시점 이월',
          paidBody: 'B 엔터가 대규모 제작비를 먼저 지출했으나 후반 시각효과 작업이 길어지면서 OTT 납품과 판권 대금 정산 일정이 차기 연도 이후로 밀릴 가능성이 커졌다.',
          paidHighlight: '선투입 제작비 부담과 납품 일정 지연 위험이 확인됐습니다.',
          openingReason: '드라마 선투입 제작비 부담과 판권 정산 일정 지연이 반영됐습니다.'
        }
      ]
    },
    {
      eventKey: 'b_enter_theatrical_movie_release',
      industry: '엔터',
      freeTitle: '성수기 극장가 대작 영화 개봉과 손익분기점 달성 경쟁',
      freeSummary: '텐트폴 영화 예매율 추이와 해외·VOD 부가 판권 선판매 여부 주목',
      freeBody: '영상 제작·배급사들이 성수기 극장가에 대규모 제작비가 투입된 신작 영화를 선보이고 있다. 초기 예매율 추이와 부가 판권 선판매 계약이 실적을 좌우한다.',
      paidTopic: '예매율 추이 및 부가판권 계약',
      outcomes: [
        {
          outcomeId: 'movie_boxoffice_hit',
          isPositive: true,
          rateRange: [0.10, 0.24],
          paidPostTitle: 'B엔터, 배급 신작 개봉 첫 주 손익분기점 근접 및 아시아 판권 선판매',
          paidBody: 'B 엔터가 투자·배급한 신작 영화가 높은 좌석점유율을 기록 중이며 아시아 주요국 방영권 선판매 계약으로 제작비 대부분을 조기 확보했다.',
          paidHighlight: '초기 흥행 호조와 해외 판권 선판매로 제작비 회수가 순조롭습니다.',
          openingReason: '투자·제작 영화의 극장 흥행 돌파 및 해외 판권 완판 수익이 반영됐습니다.'
        },
        {
          outcomeId: 'movie_bep_miss',
          isPositive: false,
          rateRange: [-0.18, -0.07],
          paidPostTitle: 'B엔터, 주력 개봉작 상영관 확보 부진 및 마케팅비 회수 불투명',
          paidBody: 'B 엔터가 대규모 마케팅비를 투입한 신작 영화가 경쟁작에 밀려 상영관 수가 줄어들고 있으며 손익분기점 달성이 쉽지 않은 흐름이다.',
          paidHighlight: '관객 수 부진으로 제작비 미회수 상각 위험이 있습니다.',
          openingReason: '주력 영화 관객 수 부진에 따른 제작비 미회수 상각 손실이 반영됐습니다.'
        }
      ]
    }
  ],

  a_food: [
    {
      eventKey: 'food_grain_wholesale_contract',
      industry: '식품',
      freeTitle: '국제 곡물 도매가 변동과 가공식품 원료 재계약 시점 도래',
      freeSummary: '주요 곡물 도매가격 흐름과 업체별 기존 공급 계약 만료 시점에 주목',
      freeBody: '국제 곡물 도매가격이 움직이는 가운데 식품 가공업체들의 원료 공급 계약 갱신 시점이 다가왔다. 업체마다 기존 재고 소진 속도와 새 단가 반영 시점이 다를 것으로 보인다.',
      paidTopic: '원가 계약 및 재고 현황',
      outcomes: [
        {
          outcomeId: 'grain_cost_drop_applied',
          isPositive: true,
          rateRange: [0.08, 0.20],
          paidPostTitle: 'A식품, 기존 원료 계약 만료로 하락한 곡물 도매가 신규 계약에 반영',
          paidBody: '주요 곡물의 도매가격이 낮아진 시점에 A 식품의 기존 원료 공급 계약이 만료되어 낮아진 단가로 새 계약을 체결했다. 하반기 제조 원가부터 즉시 반영된다.',
          paidHighlight: '원료 단가 하락분이 신규 공급 계약에 반영되는 구조가 확인됐습니다.',
          openingReason: '곡물 도매가 하락에 따른 신규 원료 계약 원가 절감이 반영됐습니다.'
        },
        {
          outcomeId: 'grain_high_cost_locked',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'A식품, 과거 고가 원료 장기계약 잔여 물량으로 단가 인하 반영 지연',
          paidBody: 'A 식품은 과거 고점에 체결한 원곡 장기 공급 계약 물량이 아직 남아 있어 올해는 도매가 하락 혜택을 받기 어렵다. 포장재와 물류비 부담도 이어지고 있다.',
          paidHighlight: '고가 원료 재고 소진 전까지 원가율 부담이 지속될 수 있습니다.',
          openingReason: '고가 원료 재고 부담 및 물류·포장 원가 상승이 반영되어 하락했습니다.'
        }
      ]
    },
    {
      eventKey: 'food_kfood_overseas_export',
      industry: '식품',
      freeTitle: 'K-푸드 간편식·라면 해외 대형마트 입점 경쟁과 수출용 라인 증설',
      freeSummary: '북미·유럽 대형 유통망 입점 속도와 현지 판촉비 투입 규모 비교',
      freeBody: '국내 식품업체들이 북미와 유럽 주류 유통 채널에 간편식과 면류 입점을 추진하고 있다. 대형마트 메인 매대 입점 여부와 초기 입점 수수료·판촉비 부담이 실적을 가를 전망이다.',
      paidTopic: '해외 유통망 입점 및 판촉비',
      outcomes: [
        {
          outcomeId: 'kfood_costco_walmart_hit',
          isPositive: true,
          rateRange: [0.10, 0.24],
          paidPostTitle: 'A식품, 북미 대형 유통 체인 본사 직매입 입점 계약 및 수출 라인 증편',
          paidBody: 'A 식품의 주력 간편식과 면류가 북미 대형 유통 체인에 초기 입점 수수료 면제 및 직매입 조건으로 공급되기 시작했다.',
          paidHighlight: '판촉비 부담 없는 직매입 수출 계약이 확인됐습니다.',
          openingReason: '북미·유럽 대형 유통망 전 지점 입점 및 고마진 수출 급증이 반영됐습니다.'
        },
        {
          outcomeId: 'kfood_promo_fee_burden',
          isPositive: false,
          rateRange: [-0.15, -0.05],
          paidPostTitle: 'A식품, 해외 유통망 초기 매대 수수료 및 현지 시식 판촉비 선집행 부담',
          paidBody: 'A 식품이 해외 유통망 진입을 위해 매대 입점 수수료와 판촉비를 먼저 지출했으나 재발주 속도가 더뎌 초기 비용 부담이 큰 상태다.',
          paidHighlight: '해외 초기 판촉비와 물류 수수료 지출 부담이 확인됐습니다.',
          openingReason: '해외 유통망 초기 입점 수수료 및 판촉비 부담 증가가 반영됐습니다.'
        }
      ]
    }
  ],

  a_game: [
    {
      eventKey: 'game_overseas_launch_review',
      industry: '게임',
      freeTitle: '모바일 게임 신작 해외 사전 예약 개시',
      freeSummary: '해외 주요 시장 사전 예약 돌입… 현지 심사 통과 및 정식 출시 일정이 관건',
      freeBody: '국내 모바일 게임 제작사가 주력 신작의 해외 사전 예약을 받기 시작했다. 사전 예약자 유입 속도와 주요 출시 지역의 서비스 심사 완료 시점이 초기 매출을 좌우할 전망이다.',
      paidTopic: '출시 준비 및 심사 현황',
      outcomes: [
        {
          outcomeId: 'game_review_delayed',
          isPositive: false,
          rateRange: [-0.19, -0.07],
          paidPostTitle: 'A게임, 해외 사전 예약 호조이나 주요 출시 지역 심사 미완료',
          paidBody: '해외 사전 예약은 예상보다 많았다. 주요 출시 지역의 심사가 끝나지 않아 올해 정식 출시와 매출 반영은 어려울 전망이다.',
          paidHighlight: '심사 지연으로 올해 매출 반영이 미뤄질 위험이 있습니다.',
          openingReason: '주요 출시 지역 심사 지연에 따른 정식 출시 연기가 반영됐습니다.'
        },
        {
          outcomeId: 'game_global_hit_launch',
          isPositive: true,
          rateRange: [0.12, 0.30],
          paidPostTitle: 'A게임, 주요 출시 지역 심사 조기 통과 및 글로벌 동시 출시 일정 확정',
          paidBody: 'A 게임의 모바일 신작이 주요 출시 지역의 등급 심사를 모두 통과해 연내 정식 서비스와 초기 결제 매출 집계가 예정대로 진행된다.',
          paidHighlight: '심사 조기 통과로 연내 정식 출시 매출이 정상 반영됩니다.',
          openingReason: '모바일 신작 해외 정식 출시 흥행과 초기 결제 매출 급증이 반영됐습니다.'
        }
      ]
    },
    {
      eventKey: 'game_pc_console_crossplay',
      industry: '게임',
      freeTitle: '모바일·PC 크로스플레이 대작 확장팩 업데이트와 결제 모델 개편',
      freeSummary: '시즌 업데이트 이용자 복귀율과 자체 PC 런처 결제 수수료 절감 효과 주목',
      freeBody: '게임사가 주력 타이틀의 대규모 확장팩 업데이트와 함께 자체 PC 결제 런처를 도입했다. 휴면 이용자 복귀율과 플랫폼 수수료 절감 폭이 분기 실적을 결정할 전망이다.',
      paidTopic: '자체 결제 비중 및 서버 현황',
      outcomes: [
        {
          outcomeId: 'crossplay_pc_margin_boom',
          isPositive: true,
          rateRange: [0.11, 0.28],
          paidPostTitle: 'A게임, 확장팩 사전 복귀자 급증 및 수수료 낮은 자체 PC 결제 비중 확대',
          paidBody: 'A 게임의 확장팩 업데이트 직후 복귀 이용자 지표가 상승 중이며, 앱마켓 수수료가 없는 자체 PC 런처 결제 비중이 절반을 넘어섰다.',
          paidHighlight: '이용자 복귀와 결제 수수료 절감이 동시에 확인됐습니다.',
          openingReason: '확장팩 흥행 및 자체 PC 결제 비중 확대에 따른 수수료 절감이 반영됐습니다.'
        },
        {
          outcomeId: 'crossplay_server_issue_refund',
          isPositive: false,
          rateRange: [-0.18, -0.07],
          paidPostTitle: 'A게임, 업데이트 직후 서버 접속 불안정 및 과금 밸런스 불만 제기',
          paidBody: 'A 게임의 신규 업데이트 이후 주말 서버 대기열과 접속 장애가 반복되고 있으며 일부 과금 아이템에 대한 환불 요구가 늘고 있다.',
          paidHighlight: '서버 장애와 이용자 이탈 위험이 포착됐습니다.',
          openingReason: '업데이트 초기 서버 장애 및 이용자 이탈에 따른 매출 둔화가 반영됐습니다.'
        }
      ]
    }
  ],

  a_semi: [
    {
      eventKey: 'semi_ddr_contract_price',
      industry: '반도체',
      freeTitle: '글로벌 클라우드 기업 서버 교체 주기와 D램·낸드 고정거래가격 협상',
      freeSummary: '북미 빅테크 서버 증설 발주량과 메모리 재고 일수 변화에 촉각',
      freeBody: '글로벌 클라우드 사업자들의 서버 교체 시점이 도래하면서 메모리 제조사들과의 분기 고정거래가격 협상이 진행 중이다. 고객사 재고 수준과 프리미엄 제품 비중에 따라 수익성이 갈릴 전망이다.',
      paidTopic: '고정거래가격 및 재고 추이',
      outcomes: [
        {
          outcomeId: 'ddr_price_rebound_win',
          isPositive: true,
          rateRange: [0.11, 0.26],
          paidPostTitle: 'A반도체, 서버용 메모리 고정거래가격 인상 합의 및 보유 재고 정상화',
          paidBody: 'A 반도체가 주요 클라우드 고객사들과의 협상에서 서버용 메모리 고정거래가격 인상 조건에 접근했으며 보유 재고 일수도 빠르게 줄어들고 있다.',
          paidHighlight: '고정거래가격 인상과 재고 축소 흐름이 확인됐습니다.',
          openingReason: '서버용 메모리 고정거래가격 인상 타결 및 재고 정상화가 반영됐습니다.'
        },
        {
          outcomeId: 'ddr_inventory_valuation_loss',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'A반도체, 고객사 서버 발주 이월로 출하 단가 인하 압박 및 재고 누적',
          paidBody: '클라우드 고객사들이 자체 재고 소진을 우선하며 신규 발주를 미뤄 A 반도체의 분기 출하 단가 협상이 불리하게 전개되고 있다.',
          paidHighlight: '고객사 발주 이월과 재고 누적 부담이 확인됐습니다.',
          openingReason: '고객사 발주 이월에 따른 메모리 단가 하락 및 재고평가손실이 반영됐습니다.'
        }
      ]
    }
  ],

  b_semi: [
    {
      eventKey: 'b_semi_nextgen_etcher_qual',
      industry: '반도체',
      freeTitle: '차세대 미세공정용 국산화 식각·증착 장비 퀄(품질) 테스트 진행',
      freeSummary: '외산 장비 대체 국산화 테스트 통과 여부와 초도 양산 발주 시점 주목',
      freeBody: '국내 반도체 장비업계가 외산 의존도가 높았던 초미세 전공정 장비의 국산화 품질(Qual) 테스트를 진행하고 있다. 양산 라인 채택 여부에 따라 수주 잔고가 바뀔 전망이다.',
      paidTopic: '국산화 장비 퀄 테스트 현황',
      outcomes: [
        {
          outcomeId: 'qual_test_passed_mass_order',
          isPositive: true,
          rateRange: [0.12, 0.27],
          paidPostTitle: 'B반도체, 차세대 증착 장비 고객사 품질 기준 충족 및 연내 초도 발주 일정',
          paidBody: 'B 반도체가 개발한 차세대 원자층 증착 장비가 고객사 테스트 공정 기준을 통과해 연내 초도 양산 라인 발주 품의가 진행 중이다.',
          paidHighlight: '품질 테스트 통과와 연내 초도 수주 일정이 확인됐습니다.',
          openingReason: '차세대 국산화 반도체 장비 양산 품질 테스트 통과 및 초도 수주가 반영됐습니다.'
        },
        {
          outcomeId: 'qual_test_redesign_delay',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'B반도체, 신규 장비 챔버 내구성 보완 요청으로 양산 채택 일정 순연',
          paidBody: 'B 반도체의 신규 장비가 고객사 가혹 조건 테스트에서 부품 내구성 보완 요청을 받아 재설계 작업에 들어갔으며 초도 납품이 내년 이후로 미뤄질 전망이다.',
          paidHighlight: '부품 보완 재설계에 따른 납품 일정 지연 위험이 확인됐습니다.',
          openingReason: '신규 반도체 장비 품질 보완 재설계 비용 및 납품 지연이 반영됐습니다.'
        }
      ]
    }
  ],

  a_ship: [
    {
      eventKey: 'ship_steel_plate_heavy_tail',
      industry: '조선',
      freeTitle: '조선업계 선박용 후판 가격 협상과 인도 선박 잔금(헤비테일) 정산',
      freeSummary: '철강사와의 후판 단가 협상 결과 및 인도 예정 선박 잔금 회수 점검',
      freeBody: '선박 건조 원가의 큰 비중을 차지하는 후판 가격 협상이 진행 중이다. 동시에 올해 인도 예정인 선박들의 최종 인도 대금 정산 일정이 현금흐름을 좌우할 전망이다.',
      paidTopic: '후판 단가 협상 및 잔금 일정',
      outcomes: [
        {
          outcomeId: 'steel_drop_heavytail_inflow',
          isPositive: true,
          rateRange: [0.10, 0.23],
          paidPostTitle: 'A조선, 후판 단가 인하 합의 근접 및 하반기 대형 선박 인도 잔금 유입 예정',
          paidBody: 'A 조선이 철강사와 후판 공급 단가 인하 방향에 공감대를 형성했고, 건조 막바지인 선박들의 인도 잔금이 예정된 일정대로 연내 회수될 예정이다.',
          paidHighlight: '후판 원가 부담 완화와 인도 잔금 회수 일정이 확인됐습니다.',
          openingReason: '선박용 후판 단가 인하에 따른 원가 절감 및 인도 대금 유입이 반영됐습니다.'
        },
        {
          outcomeId: 'steel_hike_provision_loss',
          isPositive: false,
          rateRange: [-0.17, -0.06],
          paidPostTitle: 'A조선, 철강사 후판 가격 인상 요구 강경… 공사손실충당금 설정 부담',
          paidBody: '원자재 가격 상승으로 후판 단가 인상이 불가피해지면서 A 조선이 기수주 선박에 대해 공사손실충당금을 추가로 설정해야 할 위험이 커졌다.',
          paidHighlight: '후판 원가 상승에 따른 충당금 비용 부담이 확인됐습니다.',
          openingReason: '후판 가격 인상에 따른 공사손실충당금 비용 반영으로 하락했습니다.'
        }
      ]
    }
  ],

  a_air: [
    {
      eventKey: 'air_route_expansion_fuel',
      industry: '항공',
      freeTitle: '국제선 여객 노선 증편과 항공유·환율 변동',
      freeSummary: '단거리 해외여행 및 공연 관람 수요 증가… 예약률과 유류비 부담 비교 필요',
      freeBody: '해외 공연과 관광 수요가 늘어나면서 항공사들이 주요 국제선 증편을 검토하고 있다. 노선별 실제 예약률과 항공유 가격 변동에 따라 영업이익 개선 폭이 달라질 수 있다.',
      paidTopic: '노선 예약률 및 유류비 현황',
      outcomes: [
        {
          outcomeId: 'air_load_factor_surge',
          isPositive: true,
          rateRange: [0.07, 0.19],
          paidPostTitle: 'A항공, 주력 단거리 국제선 예약률 상승 및 항공유 헤지 계약 확보',
          paidBody: '해외 공연 관람객과 여행 수요가 늘어나면서 A 항공의 국제선 예약률이 높은 수준을 유지하고 있으며, 사전 항공유 헤지 계약으로 유류비 변동 폭도 제한적이다.',
          paidHighlight: '국제선 예약률 호조와 유류비 방어 구조가 확인됐습니다.',
          openingReason: '국제선 노선 탑승률 상승과 여객 운임 수익 개선이 반영됐습니다.'
        },
        {
          outcomeId: 'air_fuel_cost_spike',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'A항공, 신규 증편 노선 초기 예약률 저조 및 항공유 급등 부담',
          paidBody: 'A 항공이 노선을 증편했으나 일부 노선의 예약률이 아직 손익분기점을 밑돌고 있으며 항공유 단가 상승으로 운항 원가 부담이 커진 상태다.',
          paidHighlight: '증편 초기 비용과 유류비 상승 부담이 확인됐습니다.',
          openingReason: '항공유 가격 상승과 신규 증편 노선 고정비 부담이 반영되어 하락했습니다.'
        }
      ]
    },
    {
      eventKey: 'air_cargo_semiconductor_freight',
      industry: '항공',
      freeTitle: '글로벌 IT·반도체 긴급 항공 화물 수요와 장거리 노선 슬롯 배분',
      freeSummary: '고운임 항공 화물 적재율과 항공기 리스·정비비 변동 점검',
      freeBody: '글로벌 IT 신제품 출시와 반도체 장비 수송 수요로 항공 화물 운임이 움직이고 있다. 화물기 적재율과 외화 표시 항공기 리스료·정비비 부담이 항공사 실적을 가를 전망이다.',
      paidTopic: '항공 화물 운임 및 정비비',
      outcomes: [
        {
          outcomeId: 'cargo_yield_boom',
          isPositive: true,
          rateRange: [0.09, 0.22],
          paidPostTitle: 'A항공, 미주·유럽 노선 IT·반도체 화물 전세기 장기 편성 가동',
          paidBody: 'A 항공이 글로벌 IT·반도체 화주들과 고운임 화물 전세기 편성 계약을 맺어 하반기 화물 적재율과 운임 단가가 동시에 올라가고 있다.',
          paidHighlight: '고운임 항공 화물 전세기 가동 확대가 확인됐습니다.',
          openingReason: '미주·유럽 노선 고운임 IT·반도체 항공 화물 매출 급증이 반영됐습니다.'
        },
        {
          outcomeId: 'lease_maintenance_cost_surge',
          isPositive: false,
          rateRange: [-0.15, -0.05],
          paidPostTitle: 'A항공, 주력 기재 엔진 중정비 일정 집중 및 외화 리스료 부담 증가',
          paidBody: 'A 항공의 장거리 기재 엔진 중정비 일정이 올해 하반기에 집중된 데다 환율 상승으로 외화 항공기 리스료 지출이 늘어날 예정이다.',
          paidHighlight: '엔진 정비비와 외화 리스료 비용 증가 요인이 확인됐습니다.',
          openingReason: '항공기 엔진 중정비 비용 및 외화 리스료 부담 증가가 반영됐습니다.'
        }
      ]
    }
  ],

  a_bio: [
    {
      eventKey: 'bio_pipeline_general_a',
      industry: '바이오',
      freeTitle: '바이오 업계, 후속 면역·항암 파이프라인 전임상 및 특허 출원',
      freeSummary: '신규 후보물질 특허 등록과 초기 연구개발 비용 집행 시점 점검',
      freeBody: '국내 바이오 업체들이 후속 신약 파이프라인의 물질 특허 출원과 초기 임상 준비를 병행하고 있다. 기술료 유입 시점과 연구비 지출 규모가 단기 실적을 좌우할 전망이다.',
      paidTopic: '후속 파이프라인 연구 현황',
      outcomes: [
        {
          outcomeId: 'bio_a_patent_milestone',
          isPositive: true,
          rateRange: [0.08, 0.22],
          paidPostTitle: 'A바이오, 후속 파이프라인 해외 물질특허 등록 및 초기 기술료 정산 예정',
          paidBody: 'A 바이오가 개발 중인 후속 후보물질의 해외 특허 심사 등록이 완료 단계이며 공동연구 파트너사로부터 초기 마일스톤 기술료가 연내 정산될 예정이다.',
          paidHighlight: '특허 등록과 초기 기술료 유입 일정이 확인됐습니다.',
          openingReason: '후속 신약 파이프라인 특허 등록 및 마일스톤 기술료 유입이 반영됐습니다.'
        },
        {
          outcomeId: 'bio_a_rd_cost_expand',
          isPositive: false,
          rateRange: [-0.15, -0.05],
          paidPostTitle: 'A바이오, 신규 임상 시료 위탁생산 비용 선집행 구조',
          paidBody: 'A 바이오가 차기 후보물질의 임상 시료 확보를 위해 올해 위탁생산 비용을 먼저 집행했다. 기술료 유입 없이 연구개발비 지출만 먼저 반영되는 구간이다.',
          paidHighlight: '임상 시료 생산비 선집행에 따른 단기 비용 부담이 확인됐습니다.',
          openingReason: '임상 시료 생산 및 연구개발비 선집행 부담이 반영됐습니다.'
        }
      ]
    }
  ],

  b_bio: [
    {
      eventKey: 'bio_pipeline_general_b',
      industry: '바이오',
      freeTitle: '바이오 의약품 원료 위탁생산(CMO) 수주 및 품질 실사',
      freeSummary: '글로벌 제약사 원료 공급 실사 진행… 가동률과 초기 검증 비용이 변수',
      freeBody: '바이오 의약품 원료 공급과 위탁생산 시장을 둘러싸고 글로벌 제약사들의 품질 실사가 이어지고 있다. 실사 통과 시점과 설비 보완 비용에 따라 수익성이 달라질 전망이다.',
      paidTopic: '품질 실사 및 공급 일정',
      outcomes: [
        {
          outcomeId: 'bio_b_cmo_batch_approved',
          isPositive: true,
          rateRange: [0.08, 0.21],
          paidPostTitle: 'B바이오, 해외 제약사 현장 품질 실사 완료 및 연내 초도 물량 선적 일정',
          paidBody: 'B 바이오의 원료 생산 라인이 해외 제약사의 현장 품질 실사를 마치고 하반기 상업용 초도 물량 선적 일정을 잡았다.',
          paidHighlight: '품질 실사 완료와 연내 초도 물량 출하 일정이 확인됐습니다.',
          openingReason: '바이오 원료 의약품 품질 실사 통과 및 공급 개시가 반영됐습니다.'
        },
        {
          outcomeId: 'bio_b_facility_revalidation',
          isPositive: false,
          rateRange: [-0.16, -0.05],
          paidPostTitle: 'B바이오, 무균 공정 추가 밸리데이션 요구로 초도 출하 일정 이월',
          paidBody: 'B 바이오가 생산 설비의 무균 공정 추가 검증을 요구받아 상업용 물량 출하 일정이 내년 이후로 미뤄지고 설비 보완 비용이 발생했다.',
          paidHighlight: '설비 추가 검증에 따른 출하 이월과 비용 부담이 확인됐습니다.',
          openingReason: '생산 설비 추가 검증에 따른 출하 일정 순연과 비용 부담이 반영됐습니다.'
        }
      ]
    }
  ]
};

/**
 * 선택형 유료 단서 2개(일정 단서 + 사업 리스크 단서) 객체를 생성하는 헬퍼
 * - 두 단서는 동일한 choiceGroup(`${year}_${stockId}`)을 공유하여 서버와 화면에서 1종목·1연도 1개만 구매하도록 묶입니다.
 * - 구매 당시 알 수 있는 일정 사실과 리스크 사실만 각각 담으며, 미래 개장가·확정 등락률·최종 성사 결과를 미리 노출하지 않습니다.
 */
function createChoicePaidCluePair({
  year,
  stock,
  arcStageLabel,
  isPositive,
  scheduleWhatItTells,
  scheduleSubtitle,
  schedulePostTitle,
  scheduleBody,
  scheduleHighlight,
  riskWhatItTells,
  riskSubtitle,
  riskPostTitle,
  riskBody,
  riskHighlight
}) {
  const choiceGroup = `choice_${year}_${stock.id}`;
  return [
    {
      id: `paid_${year}_${stock.id}_schedule`,
      year,
      type: 'paid',
      stockId: stock.id,
      stockName: stock.name,
      industry: stock.industry,
      hasChoicePair: true,
      choiceGroup,
      clueType: 'schedule',
      clueTypeLabel: '일정 단서',
      topic: '일정 단서',
      preTitle: `${stock.name} · 일정 단서`,
      whatItTells: scheduleWhatItTells,
      subtitle: scheduleSubtitle,
      postTitle: schedulePostTitle,
      body: scheduleBody,
      fallbackPostTitle: schedulePostTitle,
      fallbackBody: scheduleBody,
      highlightNote: scheduleHighlight,
      isPositive,
      disclosedFacts: [schedulePostTitle, scheduleBody],
      questionOrClue: scheduleHighlight,
      arcStageLabel
    },
    {
      id: `paid_${year}_${stock.id}_risk`,
      year,
      type: 'paid',
      stockId: stock.id,
      stockName: stock.name,
      industry: stock.industry,
      hasChoicePair: true,
      choiceGroup,
      clueType: 'risk',
      clueTypeLabel: '사업 리스크 단서',
      topic: '사업 리스크 단서',
      preTitle: `${stock.name} · 사업 리스크 단서`,
      whatItTells: riskWhatItTells,
      subtitle: riskSubtitle,
      postTitle: riskPostTitle,
      body: riskBody,
      fallbackPostTitle: riskPostTitle,
      fallbackBody: riskBody,
      highlightNote: riskHighlight,
      isPositive,
      disclosedFacts: [riskPostTitle, riskBody],
      questionOrClue: riskHighlight,
      arcStageLabel
    }
  ];
}

function createSingleArcPaidClue({
  year,
  stock,
  arcStageLabel,
  isPositive,
  topic,
  subtitle,
  postTitle,
  body,
  highlightNote
}) {
  return [
    {
      id: `paid_${year}_${stock.id}`,
      year,
      type: 'paid',
      stockId: stock.id,
      stockName: stock.name,
      industry: stock.industry,
      hasChoicePair: false,
      choiceGroup: null,
      clueType: 'single',
      clueTypeLabel: '단일 단서',
      topic,
      preTitle: `${stock.name} · ${topic}`,
      whatItTells: subtitle,
      subtitle,
      postTitle,
      body,
      fallbackPostTitle: postTitle,
      fallbackBody: body,
      highlightNote,
      isPositive,
      disclosedFacts: [postTitle, body],
      questionOrClue: highlightNote,
      arcStageLabel
    }
  ];
}

const BIO_ARC_VARIANTS = [
  {
    projectAName: 'GLP-1 계열 차세대 비만 치료제',
    projectBName: '다가 감염병 예방 백신',
    recruitKeyword: '대사질환·내분비 임상 전문 인력',
    equipKeyword: '면역 항원 정제 설비'
  },
  {
    projectAName: '경구용 비만·대사질환 복합 신약',
    projectBName: '차세대 mRNA 호흡기 백신',
    recruitKeyword: '대사질환·내분비 임상 설계 연구진',
    equipKeyword: '지질나노입자(LNP) 항원 제형 설비'
  },
  {
    projectAName: '장기지속형 비만·지방간 치료 신약',
    projectBName: '프리미엄 세포배양 백신',
    recruitKeyword: '글로벌 대사질환 임상 운영팀',
    equipKeyword: '바이오리액터 항원 원액 배양 설비'
  }
];

/**
 * [다년도 장기 사건 1] 바이오 비만 치료제 & 백신 프로젝트 (2~6년)
 * - 1단계(step 0), 핵심 중간 단계(step 1), 최종 단계(isLast)에는 서로 다른 일정 사실과 리스크 사실이 존재하므로
 *   A바이오·B바이오 각각 '일정 단서'와 '사업 리스크 단서' 2종을 제공합니다.
 * - 4~6년 아크의 추가 중간 단계(step >= 2 && !isLast)에는 앞선 단계와 본문 핵심 사실이 중복되지 않도록 기존 단일 기사 방식(1개)으로 제공합니다.
 * - 구매 전 미리보기(whatItTells, subtitle)는 A바이오와 B바이오에 완전히 동일한 중립 문구를 적용하여,
 *   구매 전에 누가 숨겨진 비만 치료제 담당 회사이고 누가 백신 담당 회사인지 절대 드러나지 않게 보호합니다.
 */
function generateBioMultiYearArc({ startYear, durationYears, obesityOwnerId, vaccineOwnerId }) {
  const obesityStock = STOCKS.find((s) => s.id === obesityOwnerId);
  const vaccineStock = STOCKS.find((s) => s.id === vaccineOwnerId);
  const endTradeYear = startYear + durationYears - 1;
  const finalOpeningYear = endTradeYear + 1;
  const variant = pickOne(BIO_ARC_VARIANTS);

  const obesityFinalSuccess = Math.random() < 0.55;
  const vaccineFinalSuccess = Math.random() < 0.55;

  const stagesByYear = {};

  for (let step = 0; step < durationYears; step++) {
    const y = startYear + step;
    const isFirst = step === 0;
    const isLast = step === durationYears - 1;
    const stageNum = step + 1;
    const arcStageLabel = `바이오 장기 사건 ${stageNum}/${durationYears}단계`;

    let freeTitle = '';
    let freeSummary = '';
    let freeBody = '';

    let obesityRate = 0;
    let obesityReason = '';
    let obesityPos = true;
    let obesityPair = [];

    let vaccineRate = 0;
    let vaccineReason = '';
    let vaccinePos = true;
    let vaccinePair = [];

    if (isFirst) {
      freeTitle = `바이오 업계, ${variant.projectAName} 임상 1상 착수 소식`;
      freeSummary = `담당 회사명 비공개… 채용·설비 일정과 초기 안전성·비용 리스크 단서로 후보 추리 필요 (${arcStageLabel})`;
      freeBody = `국내 한 신약 개발사가 ${variant.projectAName} 후보물질의 초기 임상에 착수했다는 소식이 전해졌다. 비밀유지 조항으로 담당 회사명은 공개되지 않았으며, 각 기업의 연구 일정과 초기 독성·비용 리스크를 조사해 후보를 좁힐 수 있다.`;

      obesityPos = true;
      obesityRate = Number(randFloat(0.08, 0.16).toFixed(3));
      obesityReason = '신규 임상 파이프라인 초기 일정 진행 및 전문 연구 인력 확충이 반영됐습니다.';

      // A바이오·B바이오 공통 중립 미리보기 문구 (숨겨진 비만 신약/백신 담당 회사가 미리보기에서 노출되지 않도록 동일하게 설정)
      const stage1SchedWhat = '신규 연구 인력·설비 투입 시점과 차기 임상·검증 데이터 집계 일정을 확인합니다.';
      const stage1RiskWhat = '초기 안전성·독성 변수와 연구개발·설비 선집행 비용 리스크를 확인합니다.';

      obesityPair = createChoicePaidCluePair({
        year: y,
        stock: obesityStock,
        arcStageLabel,
        isPositive: obesityPos,
        scheduleWhatItTells: stage1SchedWhat,
        scheduleSubtitle: `${obesityStock.name}의 신규 파이프라인 착수 일정 및 차기 데이터 집계 시점 조사`,
        schedulePostTitle: `${obesityStock.name}, ${variant.recruitKeyword} 충원 완료 및 내년 개장 전 임상 1상 초기 데이터 집계 일정`,
        scheduleBody: `${obesityStock.name}가 최근 ${variant.recruitKeyword}을 집중 채용하고 코호트 투여 일정을 확정했다. 올해 하반기 투여를 거쳐 내년 개장 전에 1차 약동학 및 내약성 중간 데이터가 먼저 집계될 예정이다.`,
        scheduleHighlight: '대사질환 임상 인력 충원과 내년 개장 전 1차 임상 데이터 집계 일정이 확인됐습니다.',
        riskWhatItTells: stage1RiskWhat,
        riskSubtitle: `${obesityStock.name}의 초기 안전성 지표 및 연구·설비 비용 부담 리스크 조사`,
        riskPostTitle: `${obesityStock.name}, 초기 용량 탐색의 간 독성 지표는 안정적이나 고순도 시료 합성 비용 부담 상존`,
        riskBody: `${obesityStock.name}가 진행 중인 초기 용량 탐색에서 우려됐던 간 수치 이상 징후는 발견되지 않아 급격한 임상 중단 위험은 낮다. 다만 고순도 임상 시료 추가 합성에 따른 위탁연구비 지출 부담이 단기 수익성의 리스크 요인으로 남아 있다.`,
        riskHighlight: '초기 간 독성 중단 리스크는 낮으나 시료 합성 연구비 부담이 존재합니다.'
      });

      vaccinePos = false;
      vaccineRate = Number(randFloat(-0.08, -0.03).toFixed(3));
      vaccineReason = '기초 시험 설비 발주 및 초기 연구개발 비용 지출이 반영됐습니다.';

      vaccinePair = createChoicePaidCluePair({
        year: y,
        stock: vaccineStock,
        arcStageLabel,
        isPositive: vaccinePos,
        scheduleWhatItTells: stage1SchedWhat,
        scheduleSubtitle: `${vaccineStock.name}의 신규 파이프라인 착수 일정 및 차기 데이터 집계 시점 조사`,
        schedulePostTitle: `${vaccineStock.name}, ${variant.equipKeyword} 하반기 반입 예정… 본임상 진입 일정은 차기 연도 이후`,
        scheduleBody: `${vaccineStock.name}가 최근 ${variant.equipKeyword}를 발주하고 하반기 설비 반입 및 공정 밸리데이션 일정을 잡았다. 실제 임상 진입 일정은 내년 이후로 계획되어 있어 올해 안에 발표될 임상 데이터 일정은 없다.`,
        scheduleHighlight: '올해는 면역 항원 설비 반입과 공정 검증만 진행되고 임상 발표 일정은 차기 연도 이후입니다.',
        riskWhatItTells: stage1RiskWhat,
        riskSubtitle: `${vaccineStock.name}의 초기 안전성 지표 및 연구·설비 비용 부담 리스크 조사`,
        riskPostTitle: `${vaccineStock.name}, 항원 정제 설비 선급금 일시 지출 및 기초 안전성 보완 시험 비용 리스크`,
        riskBody: `${vaccineStock.name}가 신규 항원 라인 설비 선급금을 일시에 지출한 데다 규제 기관의 기초 안전성 자료 보완 기준이 강화되면서 초기 시험 비용이 당초 예산을 초과할 리스크가 커졌다.`,
        riskHighlight: '설비 선급금과 안전성 보완 시험으로 단기 원가·비용 초과 리스크가 높은 구간입니다.'
      });
    } else if (step === 1 && !isLast) {
      const midObesityPos = true;
      const midVaccinePos = false;

      freeTitle = `${variant.projectAName} 임상 중간 분석… 투여군별 유효성 편차와 후속 일정 점검`;
      freeSummary = `중간 데이터 발표 시점과 투여군 이탈·품질 보완 리스크에 따라 주가 향방 갈릴 전망 (${arcStageLabel})`;
      freeBody = `진행 중인 ${variant.projectAName} 임상 중간 분석에서 투여 용량별 유효성 편차와 안전성 추적 일정이 주요 쟁점으로 떠올랐다. 후속 임상 진입 일정과 규제 당국의 보완 요구 여부가 기업별 실적을 좌우할 전망이다.`;

      const stage2SchedWhat = '중간 데이터·공정 검증 완료 시점과 후속 단계 진입 및 협약 일정을 확인합니다.';
      const stage2RiskWhat = '참여군 중도 이탈·품질 편차 가능성과 프로토콜 재설계·재시험 비용 리스크를 확인합니다.';

      obesityPos = midObesityPos;
      obesityRate = Number(randFloat(0.05, 0.14).toFixed(3));
      obesityReason = '임상 중간 데이터 일부 집단 개선 및 후속 단계 진입이 반영됐습니다.';

      obesityPair = createChoicePaidCluePair({
        year: y,
        stock: obesityStock,
        arcStageLabel,
        isPositive: obesityPos,
        scheduleWhatItTells: stage2SchedWhat,
        scheduleSubtitle: `${obesityStock.name}의 파이프라인 중간 점검 시점 및 후속 단계 진입 일정 조사`,
        schedulePostTitle: `${obesityStock.name}, 하반기 학회서 대사질환 중간 데이터 발표 후 연내 후속 임상 투여 개시 예정`,
        scheduleBody: `${obesityStock.name}가 하반기 국제 학회에서 고용량 코호트의 대사 지표 중간 분석 결과를 발표하기로 확정했다. 학회 발표 직후 연내에 다음 단계 임상 환자 투여 일정을 곧바로 시작할 예정이다.`,
        scheduleHighlight: '하반기 학회 중간 데이터 발표와 연내 후속 임상 진입 일정이 확인됐습니다.',
        riskWhatItTells: stage2RiskWhat,
        riskSubtitle: `${obesityStock.name}의 파이프라인 유효성·품질 편차 및 추가 비용 리스크 조사`,
        riskPostTitle: `${obesityStock.name}, 저용량 투여군 유효성 편차 및 위장관 부작용 이탈에 따른 용량 재설계 리스크`,
        riskBody: `${obesityStock.name}의 고용량군과 달리 저용량 투여 집단에서는 유효성 편차와 위장관 부작용에 따른 중도 이탈 우려가 제기되고 있다. 이탈률이 높아질 경우 용량 조절 프로토콜 보완과 추가 안전성 검증 비용이 발생할 수 있다.`,
        riskHighlight: '투여 용량별 유효성 편차와 부작용 이탈 시 프로토콜 보완 비용이 발생할 수 있는 리스크가 있습니다.'
      });

      vaccinePos = midVaccinePos;
      vaccineRate = Number(randFloat(-0.11, -0.04).toFixed(3));
      vaccineReason = '백신 유통 안정성 보완 시험에 따른 일정 순연이 반영됐습니다.';

      vaccinePair = createChoicePaidCluePair({
        year: y,
        stock: vaccineStock,
        arcStageLabel,
        isPositive: vaccinePos,
        scheduleWhatItTells: stage2SchedWhat,
        scheduleSubtitle: `${vaccineStock.name}의 파이프라인 중간 점검 시점 및 후속 단계 진입 일정 조사`,
        schedulePostTitle: `${vaccineStock.name}, 항원 후보물질 장기 보관 시험 연장으로 허가 신청 일정 차기 연도로 순연`,
        scheduleBody: `${vaccineStock.name}의 면역 항원 파이프라인이 장기 보관 기간의 데이터 추가 수집 일정을 부여받아 올해 안에 품목 허가 신청 일정을 잡지 못하고 내년 이후로 일정이 미뤄졌다.`,
        scheduleHighlight: '장기 보관 데이터 추가 수집으로 인해 올해 허가 신청 일정이 차기 연도로 순연됐습니다.',
        riskWhatItTells: stage2RiskWhat,
        riskSubtitle: `${vaccineStock.name}의 파이프라인 유효성·품질 편차 및 추가 비용 리스크 조사`,
        riskPostTitle: `${vaccineStock.name}, 유통 온도 변화 시험에서 역가 저하 우려 제기… 안정제 제형 변경 비용 리스크`,
        riskBody: `${vaccineStock.name}가 생산한 항원 시료가 상온 노출 시험에서 역가 저하 가능성을 보여 콜드체인 안정제 조성을 재설계하고 재시험 비용을 추가 투입해야 하는 품질 리스크가 발생했다.`,
        riskHighlight: '유통 온도 변화에 따른 역가 저하 우려로 제형 재설계 및 재시험 비용 리스크가 확인됐습니다.'
      });
    } else if (!isLast) {
      // 4~6년 아크의 추가 중간 단계(step >= 2 && !isLast):
      // 앞선 2단계와 선택형 단서 핵심 사실이 중복되지 않도록 이 연도에는 기존 단일 유료 기사(1개) 방식으로 제공 (요구사항 2번 반영)
      const midObesityPos = (step % 2 === 1) ? true : obesityFinalSuccess;
      const midVaccinePos = (step % 2 === 0) ? true : vaccineFinalSuccess;

      freeTitle = `바이오 업계 장기 파이프라인, 글로벌 임상 사이트 확대 및 생산 라인 실사 진행`;
      freeSummary = `다국가 임상 환자 모집 속도와 상업용 원액 공정 검증 현황 점검 (${arcStageLabel})`;
      freeBody = `장기 진행 중인 바이오 업계 신약·항원 프로젝트들이 다국가 임상 사이트 확대와 상업 생산용 공정 실사 구간을 지나고 있다. 각 기업의 환자 모집 진척도와 원액 배양 수율에 따라 연도별 실적이 엇갈릴 전망이다.`;

      obesityPos = midObesityPos;
      obesityRate = midObesityPos
        ? Number(randFloat(0.05, 0.13).toFixed(3))
        : Number(randFloat(-0.11, -0.04).toFixed(3));
      obesityReason = midObesityPos
        ? '다국가 임상 사이트 환자 모집 순항 및 공동연구 마일스톤 유입이 반영됐습니다.'
        : '다국가 임상 위탁기관(CRO) 운영 비용 증가가 반영됐습니다.';

      obesityPair = createSingleArcPaidClue({
        year: y,
        stock: obesityStock,
        arcStageLabel,
        isPositive: obesityPos,
        topic: '다국가 임상 운영 및 연구비 현황',
        subtitle: `${obesityStock.name}의 다국가 임상 사이트 운영 및 비용 집행 현황 조사`,
        postTitle: midObesityPos
          ? `${obesityStock.name}, 다국가 대사질환 임상 환자 목표 모집률 달성 및 단계별 기술료 유입`
          : `${obesityStock.name}, 해외 임상 사이트 추가 개설에 따른 위탁연구기관(CRO) 수수료 부담 증가`,
        body: midObesityPos
          ? `${obesityStock.name}가 해외 임상 사이트의 대사질환 환자 모집 목표치를 조기에 채우며 공동연구 파트너사로부터 단계별 연구 마일스톤을 수령했다.`
          : `${obesityStock.name}가 환자 모집 속도를 높이기 위해 해외 위탁연구기관(CRO) 사이트를 추가 개설하면서 단기 임상 운영비 지출이 크게 늘었다.`,
        highlightNote: midObesityPos
          ? '다국가 대사질환 임상 모집 순항과 단계별 기술료 유입이 확인됐습니다.'
          : '해외 임상 사이트 확장에 따른 단기 위탁연구비 부담이 확인됐습니다.'
      });

      vaccinePos = midVaccinePos;
      vaccineRate = midVaccinePos
        ? Number(randFloat(0.05, 0.13).toFixed(3))
        : Number(randFloat(-0.10, -0.04).toFixed(3));
      vaccineReason = midVaccinePos
        ? '항원 원액 대량 배양 공정 수율 안정화가 반영됐습니다.'
        : '항원 생산 라인 무균 공정 추가 검증 비용이 반영됐습니다.';

      vaccinePair = createSingleArcPaidClue({
        year: y,
        stock: vaccineStock,
        arcStageLabel,
        isPositive: vaccinePos,
        topic: '다국가 임상 운영 및 연구비 현황',
        subtitle: `${vaccineStock.name}의 다국가 임상 사이트 운영 및 비용 집행 현황 조사`,
        postTitle: midVaccinePos
          ? `${vaccineStock.name}, 상업용 항원 원액 연속 배치 배양 수율 안정화 및 해외 조달 실사 통과`
          : `${vaccineStock.name}, 항원 원액 무균 충전 라인 추가 밸리데이션에 따른 가동 지연`,
        body: midVaccinePos
          ? `${vaccineStock.name}가 상업용 스케일의 항원 원액 연속 배양에서 균일한 수율을 확보하며 해외 조달기관의 중간 공정 실사를 통과했다.`
          : `${vaccineStock.name}의 항원 충전 라인에서 무균 공정 추가 검증 요구가 나와 상업용 시료 생산 일정이 늦춰지고 보완 비용이 발생했다.`,
        highlightNote: midVaccinePos
          ? '상업용 항원 원액 배양 수율 안정화와 중간 실사 통과가 확인됐습니다.'
          : '무균 충전 라인 추가 검증에 따른 비용과 일정 부담이 확인됐습니다.'
      });
    } else {
      // 최종 단계 거래 연도 (isLast)
      // - 다음 해 개장에 최종 결과가 발표되므로, 올해 단서에서는 최종 성패나 미래 등락률을 절대 노출하지 않습니다.
      // - 구매 전 미리보기도 A바이오·B바이오 동일 중립 문구로 유지하며, 구매 후 본문도 무료 기사의 숨겨진 프로젝트명을 직접 적지 않고 간접 사실만 제공합니다.
      freeTitle = `${variant.projectAName} 최종 임상 데이터 잠금 및 ${variant.projectBName} 최종 심사 돌입`;
      freeSummary = `${durationYears}년 바이오 장기 프로젝트의 최종 판정 일정과 막바지 유효성·품질 리스크 점검 (${durationYears}/${durationYears} 최종 단계)`;
      freeBody = `수년간 이어진 ${variant.projectAName} 임상이 데이터 잠금(Data Lock)과 최종 통계 분석에 들어갔다. 동시에 ${variant.projectBName} 해외 공급 심사도 최종 판정을 앞두고 있어 각 프로젝트의 발표 일정과 막바지 리스크 요인에 시장의 관심이 쏠리고 있다.`;

      const finalSchedWhat = '최종 데이터 잠금·심의위원회 일정과 내년 개장 전 본계약·승인 결론 시점을 확인합니다.';
      const finalRiskWhat = '막바지 통계 유의성·현장 실사 미달 가능성과 본계약 협상 무산 리스크를 확인합니다.';

      obesityPos = obesityFinalSuccess;
      if (obesityFinalSuccess) {
        obesityRate = Number(randFloat(0.45, 1.35).toFixed(3));
        obesityReason = `비만 치료제 프로젝트 주인(${obesityStock.name})의 최종 임상 목표 달성 및 글로벌 기술이전 본계약이 반영됐습니다.`;
      } else {
        obesityRate = Number(randFloat(-0.30, -0.18).toFixed(3));
        obesityReason = `비만 치료제 프로젝트(${obesityStock.name})의 전체 참여자 기준 목표 효과 미달이 최종 공개되어 하락했습니다.`;
      }

      obesityPair = createChoicePaidCluePair({
        year: y,
        stock: obesityStock,
        arcStageLabel,
        isPositive: obesityPos,
        scheduleWhatItTells: finalSchedWhat,
        scheduleSubtitle: `${obesityStock.name}의 최종 데이터 판정 및 글로벌 본계약 결론 일정 조사`,
        schedulePostTitle: `${obesityStock.name}, 대사질환 최종 임상 데이터 잠금(Data Lock) 완료… 내년 개장 전 탑라인 발표 및 기술이전 결론 일정`,
        scheduleBody: `${obesityStock.name}가 대사질환 파이프라인 최종 임상 참여자의 투여 추적을 모두 마치고 데이터 잠금(Data Lock)에 들어갔다. 최종 통계 판정과 글로벌 제약사 기술이전 본계약 체결 여부는 내년 개장 직전에 일괄 발표될 예정이다.`,
        scheduleHighlight: '데이터 잠금이 완료되어 내년 개장 직전에 최종 임상 결과와 기술이전 여부가 확정되는 일정입니다.',
        riskWhatItTells: finalRiskWhat,
        riskSubtitle: `${obesityStock.name}의 최종 유효성·품질 기준 미달 및 협상 결렬 리스크 조사`,
        riskPostTitle: `${obesityStock.name}, 기저 대사질환 없는 참여군에서 위약 대비 효과 격차 축소 시 기술이전 협상 무산 리스크`,
        riskBody: `${obesityStock.name}의 최종 통계 집계에서는 일부 고용량 집단 외에 기저 대사질환이 없는 일반 참여군에서도 통계적 유의성을 충족하는지가 최대 쟁점이다. 전체 참여자 기준 목표 효과에 미달할 경우 진행 중인 글로벌 파트너사와의 기술이전 협상이 멈출 위험이 있다.`,
        riskHighlight: '전체 참여자 기준 목표 효과 미달 시 글로벌 기술이전 협상이 중단될 수 있는 핵심 리스크가 있습니다.'
      });

      vaccinePos = vaccineFinalSuccess;
      if (vaccineFinalSuccess) {
        vaccineRate = Number(randFloat(0.22, 0.55).toFixed(3));
        vaccineReason = `백신 프로젝트(${vaccineStock.name}) 최종 품목 허가 및 해외 장기 공급 본계약 체결이 반영됐습니다.`;
      } else {
        vaccineRate = Number(randFloat(-0.24, -0.14).toFixed(3));
        vaccineReason = `백신 프로젝트(${vaccineStock.name}) 최종 품질 재검증 지연 및 공급 계약 무산이 반영되어 하락했습니다.`;
      }

      vaccinePair = createChoicePaidCluePair({
        year: y,
        stock: vaccineStock,
        arcStageLabel,
        isPositive: vaccinePos,
        scheduleWhatItTells: finalSchedWhat,
        scheduleSubtitle: `${vaccineStock.name}의 최종 데이터 판정 및 글로벌 본계약 결론 일정 조사`,
        schedulePostTitle: `${vaccineStock.name}, 하반기 항원 품목 허가 최종 심의위원회 개최… 내년 개장 전 해외 장기 공급 계약 결론 예정`,
        scheduleBody: `${vaccineStock.name}가 진행 중인 면역 항원 파이프라인의 최종 품목 허가 심의위원회가 하반기에 열릴 예정이다. 심의 결과에 연동된 해외 공공조달 장기 공급 본계약 체결 여부는 내년 개장 직전에 결론이 난다.`,
        scheduleHighlight: '하반기 최종 품목 허가 심의를 거쳐 내년 개장 직전에 해외 공급 본계약 여부가 결정되는 일정입니다.',
        riskWhatItTells: finalRiskWhat,
        riskSubtitle: `${vaccineStock.name}의 최종 유효성·품질 기준 미달 및 협상 결렬 리스크 조사`,
        riskPostTitle: `${vaccineStock.name}, 원액 미량 불순물 기준 관련 현장 실사 재검증 판정 시 해외 공급 계약 중단 리스크`,
        riskBody: `${vaccineStock.name}의 항원 원액 정제 공정에서 해외 규제기관의 미량 불순물 허용 기준 충족 여부가 막바지 실사 쟁점으로 떠올랐다. 최종 실사에서 품질 재검증 판정을 받을 경우 해외 공급 본계약이 무산되고 설비 고정비 부담이 커질 위험이 있다.`,
        riskHighlight: '최종 현장 실사에서 원액 불순물 기준 재검증 판정을 받으면 해외 공급 계약이 무산될 리스크가 있습니다.'
      });
    }

    stagesByYear[y] = {
      stepIndex: stageNum,
      totalSteps: durationYears,
      freeArticle: {
        id: `free_${y}_bio_arc`,
        year: y,
        type: 'free',
        industry: '바이오',
        hideCompanyName: true,
        relatedStockIds: [],
        title: freeTitle,
        summary: freeSummary,
        body: freeBody,
        fallbackTitle: freeTitle,
        fallbackSummary: freeSummary,
        fallbackBody: freeBody,
        disclosedFacts: [freeTitle, freeSummary],
        questionOrClue: '일정 단서와 사업 리스크 단서 중 필요한 정보를 선택해 비만 치료제와 백신 프로젝트의 실제 주인과 성패를 추리하게 한다.',
        arcStageLabel
      },
      outcomesByStock: {
        [obesityOwnerId]: {
          rate: obesityRate,
          isMegaBoom: false,
          reason: obesityReason,
          signature: `bio_arc:${y}:${obesityOwnerId}:step${stageNum}:${obesityPos ? 'pos' : 'neg'}`,
          paidArticles: obesityPair
        },
        [vaccineOwnerId]: {
          rate: vaccineRate,
          isMegaBoom: false,
          reason: vaccineReason,
          signature: `bio_arc:${y}:${vaccineOwnerId}:step${stageNum}:${vaccinePos ? 'pos' : 'neg'}`,
          paidArticles: vaccinePair
        }
      }
    };
  }

  return {
    arcMeta: {
      arcId: `arc_bio_${startYear}_${finalOpeningYear}`,
      title: `${variant.projectAName}·${variant.projectBName} 프로젝트 (${startYear}~${finalOpeningYear}년 개장, ${durationYears}년 사건)`,
      industry: '바이오',
      targetStockIds: ['a_bio', 'b_bio'],
      startYear,
      endOpeningYear: finalOpeningYear,
      durationYears,
      finalOutcomeSummary: `비만신약 주인: ${obesityStock.name}(${obesityFinalSuccess ? '최종 임상 성공·기술이전' : '목표 효과 미달 실패'}) / 백신 주인: ${vaccineStock.name}(${vaccineFinalSuccess ? '해외 공급 본계약 성사' : '품질 재검증 지연'})`
    },
    stagesByYear
  };
}

const SHIP_ARC_VARIANTS = [
  {
    clientRegion: '유럽 대형 해운선사',
    vesselType: '차세대 친환경 LNG 이중연료 추진선',
    fleetScale: '14척 시리즈'
  },
  {
    clientRegion: '중동 국영 에너지 해운사',
    vesselType: '초대형 액화가스·암모니아 운반선',
    fleetScale: '16척 장기 선대'
  },
  {
    clientRegion: '북미·아시아 글로벌 해운 컨소시엄',
    vesselType: '2만4천TEU급 초대형 메탄올 컨테이너선',
    fleetScale: '12척 패키지'
  }
];

/**
 * [다년도 장기 사건 2] A조선 해외 선사 대형 선박 장기 프로젝트 (2~6년)
 * - 1단계(step 0), 핵심 중간 단계(step 1), 최종 단계(isLast)에는 서로 다른 일정 사실과 리스크 사실이 존재하므로
 *   A조선에 대해 '일정 단서'와 '사업 리스크 단서' 2종을 제공합니다.
 * - 4~6년 아크의 추가 중간 단계(step >= 2 && !isLast)에는 앞선 단계와 본문 핵심 사실이 중복되지 않도록 기존 단일 기사 방식(1개)으로 제공합니다.
 */
function generateShipMultiYearArc({ startYear, durationYears, finalMode }) {
  const shipStock = STOCKS.find((s) => s.id === 'a_ship');
  const endTradeYear = startYear + durationYears - 1;
  const finalOpeningYear = endTradeYear + 1;
  const variant = pickOne(SHIP_ARC_VARIANTS);
  const stagesByYear = {};

  for (let step = 0; step < durationYears; step++) {
    const y = startYear + step;
    const isFirst = step === 0;
    const isLast = step === durationYears - 1;
    const stageNum = step + 1;
    const arcStageLabel = `조선 장기 협상 ${stageNum}/${durationYears}단계`;

    let fTitle = '';
    let fSum = '';
    let fBody = '';
    let rate = 0;
    let reason = '';
    let isPos = true;
    let isMegaBoom = false;
    let paidPair = [];

    if (isFirst) {
      fTitle = `${variant.clientRegion}, ${variant.vesselType} 장기 발주 협상 개시`;
      fSum = `국내 조선소와 다년 공급 조건 타진… 본계약 협상 일정과 선가·도크 리스크에 주목 (${arcStageLabel})`;
      fBody = `${variant.clientRegion}가 선대 교체를 위해 국내 조선업체와 ${variant.vesselType} 장기 발주 협상을 시작했다. 수년에 걸친 대형 프로젝트가 될 가능성이 거론되나 세부 협상 일정과 보증·원가 리스크는 유료 조사를 통해 확인할 필요가 있다.`;

      isPos = true;
      rate = Number(randFloat(0.05, 0.13).toFixed(3));
      reason = `${variant.clientRegion} 대형 선박 장기 수주 기본 의향서 교환이 반영됐습니다.`;

      paidPair = createChoicePaidCluePair({
        year: y,
        stock: shipStock,
        arcStageLabel,
        isPositive: isPos,
        scheduleWhatItTells: '투자의향서(LOI) 체결 시점, 기술 사양 심사 일정, 단계별 협상 타임라인을 확인합니다.',
        scheduleSubtitle: `A조선의 ${variant.clientRegion} 기본 의향서 체결 및 후속 심사 일정 조사`,
        schedulePostTitle: `A조선, ${variant.clientRegion}와 기본 의향서(LOI) 교환… 내년부터 기술 심사 및 보증 협의 일정 진행`,
        scheduleBody: `A 조선이 ${variant.clientRegion}와 ${variant.vesselType} 건조를 위한 기본 의향서를 교환했다. 올해는 초기 설계 기준만 먼저 확정하고, 내년부터 친환경 엔진 기술 심사와 금융 보증 협의를 단계별로 진행할 예정이다.`,
        scheduleHighlight: '올해 기본 의향서 교환에 따른 1차 기대감이 반영되고 본계약 협상은 내년까지 이어지는 일정입니다.',
        riskWhatItTells: '도크 슬롯 경합, 초기 후판 원가 연동 조항, 경쟁 조선소 저가 입찰 리스크를 확인합니다.',
        riskSubtitle: `A조선의 초기 선가 조건 및 원가 연동 리스크 조사`,
        riskPostTitle: `A조선, 초기 의향서에 후판 원가 연동 조항 포함… 해외 경쟁사 저가 입찰 경합 리스크는 변수`,
        riskBody: `A 조선은 이번 의향서 협의에서 후판 가격 급등 시 선가를 일부 조정할 수 있는 에스컬레이션(원가 연동) 조항을 기본 조건에 포함시켜 초기 단계의 급격한 원가 훼손 위험을 낮췄다. 다만 해외 경쟁 조선소들이 단가 인하를 앞세워 입찰 경합을 벌이고 있어 수익성 방어 여부가 리스크 요인으로 남아 있다.`,
        riskHighlight: '후판 원가 연동 조항은 확보했으나 경쟁사 저가 입찰에 따른 선가 방어 리스크가 있습니다.'
      });
    } else if (step === 1 && !isLast) {
      isPos = true;
      fTitle = `${variant.clientRegion} 장기 발주 협상, 친환경 설계 검증 및 금융 보증(RG) 조율`;
      fSum = `기술 사양 심사와 선수금 환급보증 발급 일정·한도 리스크가 핵심 변수 (${arcStageLabel})`;
      fBody = `${variant.vesselType} 장기 수주 협상이 기술 사양 검증과 금융 보증(RG) 조율 단계로 넘어갔다. 보증 심사 결과가 나오는 시점과 보증 한도 확보 여부에 따라 협상 진행 속도가 달라질 전망이다.`;

      rate = Number(randFloat(0.04, 0.12).toFixed(3));
      reason = '해외 선사 장기 수주 협상 기술 심사 및 보증 한도 협의 진전이 반영됐습니다.';

      paidPair = createChoicePaidCluePair({
        year: y,
        stock: shipStock,
        arcStageLabel,
        isPositive: isPos,
        scheduleWhatItTells: '금융 보증(RG) 심사 결과 발표 시점과 본계약 서명 목표 일정을 확인합니다.',
        scheduleSubtitle: `A조선의 금융 보증 심사 및 본계약 체결 목표 일정 조사`,
        schedulePostTitle: `A조선, 금융 보증 심사 결과가 하반기에 나온 뒤 본계약 일정을 잡을 예정`,
        scheduleBody: `A 조선은 금융 보증 심사 결과가 하반기에 나온 뒤 본계약 일정을 잡을 예정이다. 협상 중인 발주 규모가 기존 연간 수주액과 맞먹는 대형 선대여서 선박 인도와 대금 정산은 수년에 걸쳐 단계적으로 진행된다.`,
        scheduleHighlight: '하반기 금융 보증 심사 후 본계약 일정을 잡는 단계별 타임라인이 확인됐습니다.',
        riskWhatItTells: '선수금 환급보증(RG) 한도 부족 위험, 후판 원가 상승 및 협상 중단 리스크를 확인합니다.',
        riskSubtitle: `A조선의 선수금 보증 한도 및 협상 결렬 리스크 조사`,
        riskPostTitle: `A조선, 선수금 보증 한도가 부족해 추가 보증기관을 확보하지 못하면 협상이 멈출 수 있어`,
        riskBody: `A 조선의 기존 선수금 보증 한도가 부족해 추가 보증기관을 확보하지 못하면 협상이 멈출 수 있다. 여기에 친환경 엔진 기자재와 후판 원가 상승분 반영 비율을 두고 선주 측과의 선가 이견도 남아 있어 협상 지연 리스크가 존재한다.`,
        riskHighlight: '선수금 보증 한도가 부족해 추가 보증기관을 확보하지 못하면 협상이 멈출 수 있는 리스크가 확인됐습니다.'
      });
    } else if (!isLast) {
      // 4~6년 아크의 추가 중간 단계(step >= 2 && !isLast):
      // 앞선 2단계와 선택형 단서 핵심 사실이 중복되지 않도록 이 연도에는 기존 단일 유료 기사(1개) 방식으로 제공 (요구사항 2번 반영)
      isPos = (step % 2 === 1) ? true : (finalMode !== 'breakdown');
      fTitle = `${variant.clientRegion} 장기 선대 협상, 친환경 추진 계통 상세 설계 및 도크 슬롯 조율`;
      fSum = `선박 인도 슬롯 배정과 기자재 국산화 비중에 따른 수익성 점검 (${arcStageLabel})`;
      fBody = `장기 협상 중인 ${variant.vesselType} 프로젝트가 추진 엔진 상세 설계와 연도별 도크 건조 슬롯 배정 조율 구간을 지나고 있다.`;

      rate = isPos
        ? Number(randFloat(0.04, 0.11).toFixed(3))
        : Number(randFloat(-0.09, -0.04).toFixed(3));
      reason = isPos
        ? '친환경 선박 추진 계통 상세 설계 승인 및 도크 슬롯 배정 완료가 반영됐습니다.'
        : '선박 기자재 납기 조율 및 후판 원가 부담이 반영됐습니다.';

      paidPair = createSingleArcPaidClue({
        year: y,
        stock: shipStock,
        arcStageLabel,
        isPositive: isPos,
        topic: '친환경 선박 상세 설계 및 도크 배정 현황',
        subtitle: `A조선의 ${variant.vesselType} 상세 설계 승인 및 도크 배정 현황 조사`,
        postTitle: isPos
          ? `A조선, 친환경 연료 저장탱크 상세 설계 선급 승인 완료 및 전용 도크 슬롯 확보`
          : `A조선, 핵심 엔진 기자재 납기 병목으로 선박 인도 슬롯 재조정 부담`,
        body: isPos
          ? `A 조선이 ${variant.vesselType}의 연료 탱크 상세 설계에 대해 국제 선급 승인을 마치고 연속 건조를 위한 전용 도크 슬롯 배정을 마무리했다.`
          : `친환경 엔진용 핵심 밸브와 보냉재 납기가 길어지면서 A 조선이 선주 측과 선박 인도 슬롯 순서를 다시 조율하고 있어 단기 공정 부담이 발생했다.`,
        highlightNote: isPos
          ? '상세 설계 선급 승인과 전용 도크 슬롯 확보가 확인됐습니다.'
          : '기자재 납기 병목에 따른 인도 슬롯 재조정 부담이 확인됐습니다.'
      });
    } else {
      // 최종 단계 거래 연도 (본계약 성사 여부, 미래 개장가, 확정 등락률 +900% 등은 내년 개장에 확정되므로 구매 당시 시점의 일정과 리스크만 제공)
      fTitle = `${variant.clientRegion} ${variant.vesselType} 장기 공급 프로젝트 막바지 본계약 협상`;
      fSum = `${durationYears}년간 이어진 대형 선박 장기 협상의 최종 서명 시점과 막바지 선가·보증 리스크 점검 (${durationYears}/${durationYears} 최종 단계)`;
      fBody = `수년간 협상을 거듭해 온 ${variant.clientRegion}의 ${variant.vesselType} 장기 발주 프로젝트가 최종 의사결정 단계에 들어섰다. 선주 이사회 승인 일정과 막바지 선가·보증 리스크에 시장의 이목이 집중되고 있다.`;

      if (finalMode === 'megacontract_900') {
        isPos = true;
        isMegaBoom = true;
        rate = 9.0;
        reason = '대형 장기 공급 계약 체결이 최종 확정되어 +900% 급등이 반영됐습니다.';
      } else if (finalMode === 'standard_win') {
        isPos = true;
        rate = Number(randFloat(0.24, 0.52).toFixed(3));
        reason = '해외 선사 대형 선박 장기 수주 본계약 최종 체결 및 선수금 유입이 반영됐습니다.';
      } else {
        isPos = false;
        rate = Number(randFloat(-0.28, -0.16).toFixed(3));
        reason = '해외 선사 장기 수주 협상 최종 결렬 및 도크 공백·원가 상승 부담으로 주가가 하락했습니다.';
      }

      paidPair = createChoicePaidCluePair({
        year: y,
        stock: shipStock,
        arcStageLabel,
        isPositive: isPos,
        scheduleWhatItTells: '선주 측 최종 이사회 개최 시점, 본계약 서명 및 1차 선수금 입금 일정을 확인합니다.',
        scheduleSubtitle: `A조선의 선주 이사회 최종 승인 및 본계약 서명 일정 조사`,
        schedulePostTitle: `A조선, 연말 선주 측 최종 이사회 직후 내년 개장 전 본계약 결과 및 선수금 일정 확정 예정`,
        scheduleBody: `A 조선과 ${variant.clientRegion}가 ${variant.fleetScale} 건조 협상의 최종 조건안을 선주 측 연말 이사회에 상정하기로 했다. 이사회 승인 여부와 1차 선수금 입금 일정은 내년 개장 직전에 최종 확정되어 발표될 예정이다.`,
        scheduleHighlight: '내년 개장 직전에 수년간 이어진 장기 수주 협상의 최종 결과가 확정되는 일정입니다.',
        riskWhatItTells: '최종 선가 이견, 옵션 물량 취소 가능성, 협상 결렬 시 도크 공백 리스크를 확인합니다.',
        riskSubtitle: `A조선의 막바지 선가 협상 및 도크 공백 리스크 조사`,
        riskPostTitle: `A조선, 막바지 선가·옵션 물량 이견 및 보증 한도 미타결 시 도크 공백 고정비 손실 리스크`,
        riskBody: `최종 계약을 앞두고 선주 측의 옵션 물량 선가 조정 요구와 대규모 선수금 환급보증(RG) 최종 한도 조건이 마지막 쟁점으로 맞서고 있다. 막바지 이견을 좁히지 못해 협상이 결렬될 경우 장기 프로젝트를 위해 비워둔 도크 슬롯에 공백이 생겨 대규모 고정비 손실이 발생할 위험이 있다.`,
        riskHighlight: '막바지 선가·보증 이견으로 협상이 결렬될 경우 비워둔 도크 슬롯의 고정비 손실 리스크가 큽니다.'
      });
    }

    stagesByYear[y] = {
      stepIndex: stageNum,
      totalSteps: durationYears,
      freeArticle: {
        id: `free_${y}_ship_arc`,
        year: y,
        type: 'free',
        industry: '조선',
        hideCompanyName: false,
        relatedStockIds: ['a_ship'],
        title: fTitle,
        summary: fSum,
        body: fBody,
        fallbackTitle: fTitle,
        fallbackSummary: fSum,
        fallbackBody: fBody,
        disclosedFacts: [fTitle, fSum],
        questionOrClue: '일정 단서(심사·계약 시점)와 사업 리스크 단서(선수금 보증 한도·선가 이견) 중 필요한 정보를 선택해 조사하게 한다.',
        arcStageLabel
      },
      outcomesByStock: {
        a_ship: {
          rate,
          isMegaBoom,
          reason,
          signature: `ship_arc:${y}:step${stageNum}:${finalMode}`,
          paidArticles: paidPair
        }
      }
    };
  }

  return {
    arcMeta: {
      arcId: `arc_ship_${startYear}_${finalOpeningYear}`,
      title: `A조선 ${variant.clientRegion} ${variant.vesselType} 프로젝트 (${startYear}~${finalOpeningYear}년 개장, ${durationYears}년 사건)`,
      industry: '조선',
      targetStockIds: ['a_ship'],
      startYear,
      endOpeningYear: finalOpeningYear,
      durationYears,
      finalOutcomeSummary: finalMode === 'megacontract_900'
        ? '초대형 장기 공급 본계약 체결 (+900% 급등)'
        : (finalMode === 'standard_win' ? '장기 선박 수주 본계약 체결 (상승)' : '해외 선사 장기 수주 협상 최종 결렬 (하락)')
    },
    stagesByYear
  };
}

const SEMI_ARC_VARIANTS = [
  {
    fabName: '차세대 서버용 고대역폭 메모리(HBM) 전용 클러스터',
    equipType: '초미세 실리콘관통전극(TSV) 및 증착 장비'
  },
  {
    fabName: '극자외선(EUV) 초미세 D램 신규 메가 팹(Fab)',
    equipType: '차세대 원자층 증착(ALD) 및 식각 장비'
  },
  {
    fabName: 'AI 데이터센터향 3D 낸드·D램 복합 생산 라인',
    equipType: '고종횡비 식각 및 웨이퍼 세정 전공정 장비'
  }
];

/**
 * [다년도 장기 사건 3] A반도체 & B반도체 메모리 증설 및 장비 납품 시차 아크 (2~6년)
 * - 1단계(step 0), 핵심 중간 단계(step 1), 최종 단계(isLast)에는 서로 다른 일정 사실과 리스크 사실이 존재하므로
 *   A반도체와 B반도체 각각에 대해 '일정 단서'와 '사업 리스크 단서' 2종을 제공합니다.
 * - 4~6년 아크의 추가 중간 단계(step >= 2 && !isLast)에는 앞선 단계와 본문 핵심 사실이 중복되지 않도록 기존 단일 기사 방식(1개)으로 제공합니다.
 */
function generateSemiMultiYearArc({ startYear, durationYears, finalSuccess }) {
  const aSemiStock = STOCKS.find((s) => s.id === 'a_semi');
  const bSemiStock = STOCKS.find((s) => s.id === 'b_semi');
  const endTradeYear = startYear + durationYears - 1;
  const finalOpeningYear = endTradeYear + 1;
  const variant = pickOne(SEMI_ARC_VARIANTS);
  const stagesByYear = {};

  for (let step = 0; step < durationYears; step++) {
    const y = startYear + step;
    const isFirst = step === 0;
    const isLast = step === durationYears - 1;
    const stageNum = step + 1;
    const arcStageLabel = `반도체 증설 장기 사건 ${stageNum}/${durationYears}단계`;

    let fTitle = '';
    let fSum = '';
    let fBody = '';

    let aRate = 0;
    let aReason = '';
    let aPos = false;
    let aPair = [];

    let bRate = 0;
    let bReason = '';
    let bPos = true;
    let bPair = [];

    if (isFirst) {
      fTitle = `국내 반도체 업계, ${variant.fabName} 대규모 증설 착수`;
      fSum = `클린룸 착공 일정과 초기 설비비·장비 발주 리스크 점검 (${arcStageLabel})`;
      fBody = `메모리 생산업체가 차세대 수요에 대비해 ${variant.fabName} 대규모 설비 증설에 착수했다. 제조사의 설비 투자 집행 일정·감가상각 리스크와 장비 공급사의 납품 일정·발주 지연 리스크를 구분해 살필 필요가 있다.`;

      aPos = false;
      aRate = Number(randFloat(-0.11, -0.05).toFixed(3));
      aReason = '메모리 공장 증설 초기 설비 투자비 부담이 먼저 반영됐습니다.';

      aPair = createChoicePaidCluePair({
        year: y,
        stock: aSemiStock,
        arcStageLabel,
        isPositive: aPos,
        scheduleWhatItTells: '클린룸 골조 완공 시점, 장비 반입 시기, 실제 웨이퍼 양산 출하 일정을 확인합니다.',
        scheduleSubtitle: `A반도체의 ${variant.fabName} 착공 및 양산 가동 목표 일정 조사`,
        schedulePostTitle: `A반도체, 올해는 클린룸 기초 골조 공사 단계… 실제 웨이퍼 양산 출하는 차기 연도 이후 일정`,
        scheduleBody: `A 반도체가 ${variant.fabName}의 기초 골조 및 클린룸 유틸리티 공사에 착수했다. 전공정 장비 반입과 상업용 웨이퍼 양산 출하 일정은 내년 이후로 잡혀 있어 올해 안에는 신규 라인 매출 발생 일정이 없다.`,
        scheduleHighlight: '장비 반입과 실제 웨이퍼 양산 출하 일정이 모두 차기 연도 이후로 잡혀 있습니다.',
        riskWhatItTells: '대규모 초기 설비 투자비(CAPEX) 선집행과 단기 감가상각·현금흐름 부담 리스크를 확인합니다.',
        riskSubtitle: `A반도체의 초기 설비 투자비 부담 및 수익성 리스크 조사`,
        riskPostTitle: `A반도체, 클린룸 착공에 따른 대규모 설비 선급금 집행으로 단기 영업마진 및 현금흐름 압박 리스크`,
        riskBody: `A 반도체가 신규 팹 인프라 구축을 위해 당초 예산보다 많은 초기 설비 투자비를 일시에 선집행하면서 고정비 부담이 급증했다. 라인 가동 전까지 대규모 자금 유출이 이어져 단기 영업이익률 하락 리스크가 크다.`,
        riskHighlight: '초기 설비 투자비 일시 선집행으로 인해 단기 수익성과 현금흐름이 악화되는 비용 리스크가 확인됐습니다.'
      });

      bPos = true;
      bRate = Number(randFloat(0.11, 0.22).toFixed(3));
      bReason = '국내 메모리 증설 라인용 반도체 장비 공급 계약 및 납품이 반영됐습니다.';

      bPair = createChoicePaidCluePair({
        year: y,
        stock: bSemiStock,
        arcStageLabel,
        isPositive: bPos,
        scheduleWhatItTells: '전공정 장비 발주 계약 시점과 1차 장비 납품·대금 정산 일정을 확인합니다.',
        scheduleSubtitle: `B반도체의 증설 라인용 장비 수주 및 1차 납품 일정 조사`,
        schedulePostTitle: `B반도체, ${variant.equipType} 공급 계약 체결… 내년 개장 전까지 1차 납품 및 대금 정산 완료 일정`,
        scheduleBody: `B 반도체가 국내 메모리 증설 라인용 ${variant.equipType} 초도 물량 공급 계약을 체결했다. 올해 하반기부터 첫 장비 반입을 시작해 내년 개장 전까지 1차 납품 대금 정산이 완료되는 일정으로 진행된다.`,
        scheduleHighlight: '내년 개장 전까지 1차 전공정 장비 납품과 대금 정산이 완료되는 빠른 일정입니다.',
        riskWhatItTells: '핵심 부품 조달 병목, 경쟁 장비사 단가 인하 압박, 납기 지연 지체상금 리스크를 확인합니다.',
        riskSubtitle: `B반도체의 장비 부품 수급 및 납기 지연 리스크 조사`,
        riskPostTitle: `B반도체, 핵심 진공 부품 사전 재고 확보로 지체상금 리스크 낮으나 환율 상승에 따른 원가 부담 상존`,
        riskBody: `B 반도체는 수입 의존도가 높은 초정밀 진공 밸브와 고주파 전원장치 부품을 사전에 비축해 부품 품귀로 인한 납기 지연이나 지체상금 리스크를 낮췄다. 다만 외화 결제 부품 단가 상승이 매출총이익률을 일부 잠식할 변수는 남아 있다.`,
        riskHighlight: '핵심 부품 사전 비축으로 납기 지연 및 지체상금 리스크가 낮다는 점이 확인됐습니다.'
      });
    } else if (step === 1 && !isLast) {
      const midGood = true;
      const bGood = true;

      fTitle = `${variant.fabName} 장비 반입 및 시제품 웨이퍼 수율 테스트 진행`;
      fSum = `시험 가동 일정과 미세공정 초기 수율·후속 발주 리스크 점검 (${arcStageLabel})`;
      fBody = `증설 중인 ${variant.fabName}에 전공정 장비 반입이 이어지고 시제품 웨이퍼 테스트가 시작됐다. 고객사 샘플 인증 일정과 초기 수율 불안정 리스크가 향후 수익성을 가를 전망이다.`;

      aPos = midGood;
      aRate = Number(randFloat(0.05, 0.13).toFixed(3));
      aReason = '증설 메모리 라인 시험 가동 수율 개선 및 고객사 인증 진입이 반영됐습니다.';

      aPair = createChoicePaidCluePair({
        year: y,
        stock: aSemiStock,
        arcStageLabel,
        isPositive: aPos,
        scheduleWhatItTells: '시제품 웨이퍼 테스트 완료 시점과 글로벌 서버 고객사 품질 인증 일정을 확인합니다.',
        scheduleSubtitle: `A반도체의 시험 가동 및 고객사 샘플 인증 일정 조사`,
        schedulePostTitle: `A반도체, 하반기 시제품 웨이퍼 테스트 완료 후 연내 글로벌 서버 고객사 품질 인증 진입 예정`,
        scheduleBody: `A 반도체의 신규 증설 라인이 상반기 장비 셋업을 마치고 하반기 시제품 웨이퍼 테스트를 완료할 예정이다. 이어 연말 전에 글로벌 데이터센터 고객사에 인증용 샘플을 출하하고 공식 품질 인증 일정에 돌입한다.`,
        scheduleHighlight: '하반기 시제품 테스트 완료와 연내 글로벌 고객사 품질 인증 진입 일정이 확정됐습니다.',
        riskWhatItTells: '초미세 공정 수율 불량률, 웨이퍼 폐기 손실, 시운전 원가 부담 리스크를 확인합니다.',
        riskSubtitle: `A반도체의 초기 수율 안정성 및 시운전 원가 리스크 조사`,
        riskPostTitle: `A반도체, 초미세 적층 공정 발열 및 웨이퍼 가장자리 수율 편차에 따른 시운전 원가 부담 리스크`,
        riskBody: `A 반도체의 신규 라인 시운전 과정에서 고속 적층 공정의 발열 제어와 웨이퍼 가장자리(Edge) 수율 편차가 기술적 리스크로 지목됐다. 수율 안정화가 늦어질 경우 시운전용 웨이퍼 폐기 손실과 재가공 비용이 늘어날 위험이 있다.`,
        riskHighlight: '적층 공정 발열과 웨이퍼 가장자리 수율 편차로 시운전 폐기 비용이 늘어날 수 있는 리스크가 있습니다.'
      });

      bPos = bGood;
      bRate = Number(randFloat(0.05, 0.14).toFixed(3));
      bReason = '증설 라인 후속 반도체 장비 납품 및 정산 매출이 반영됐습니다.';

      bPair = createChoicePaidCluePair({
        year: y,
        stock: bSemiStock,
        arcStageLabel,
        isPositive: bPos,
        scheduleWhatItTells: '2차 증설분 후속 장비 반입 시점과 잔금 정산 일정을 확인합니다.',
        scheduleSubtitle: `B반도체의 후속 장비 납품 및 대금 정산 일정 조사`,
        schedulePostTitle: `B반도체, 하반기 2차 증설 라인용 후속 장비 순차 반입 및 연내 잔금 정산 일정 진행`,
        scheduleBody: `B 반도체가 고객사 2차 증설 구역에 투입될 후속 식각·증착 장비를 올해 하반기부터 순차 반입한다. 현장 셋업 완료 후 내년 개장 전까지 2차 물량의 납품 잔금을 정산받는 일정이 잡혀 있다.`,
        scheduleHighlight: '하반기 2차 증설 장비 순차 반입과 내년 개장 전 잔금 정산 일정이 확인됐습니다.',
        riskWhatItTells: '고객사 셋업 지연에 따른 현장 검수(SAT) 보류 및 매출 인식 이월 리스크를 확인합니다.',
        riskSubtitle: `B반도체의 장비 검수 지연 및 수주 공백 리스크 조사`,
        riskPostTitle: `B반도체, 고객사 라인 수율 조정 지연 시 현장 인수 검수(SAT) 보류 및 매출 인식 이월 리스크`,
        riskBody: `B 반도체 장비의 대금 최종 정산은 고객사 클린룸 내 현장 인수 검수(SAT) 통과를 조건으로 하고 있다. 고객사가 초기 라인 수율 안정화를 이유로 검수 승인을 미룰 경우 매출 인식이 차기 연도로 이월되고 재고 관리 고정비가 늘어날 위험이 있다.`,
        riskHighlight: '고객사 수율 조정으로 현장 인수 검수(SAT)가 지연되면 매출 인식이 이월될 리스크가 있습니다.'
      });
    } else if (!isLast) {
      // 4~6년 아크의 추가 중간 단계(step >= 2 && !isLast):
      // 앞선 2단계와 선택형 단서 핵심 사실이 중복되지 않도록 이 연도에는 기존 단일 유료 기사(1개) 방식으로 제공 (요구사항 2번 반영)
      const midGood = (step % 2 === 1) ? true : finalSuccess;
      const bGood = !midGood;

      fTitle = `${variant.fabName} 후공정 패키징 라인 연동 및 고객사 장기 물량 협의`;
      fSum = `첨단 패키징 공정 수율과 장비 라인 가동 추이 점검 (${arcStageLabel})`;
      fBody = `증설 중인 ${variant.fabName}이 전공정과 후공정 첨단 패키징 라인을 연동하는 단계에 들어섰다.`;

      aPos = midGood;
      aRate = midGood ? Number(randFloat(0.05, 0.12).toFixed(3)) : Number(randFloat(-0.09, -0.04).toFixed(3));
      aReason = midGood
        ? '첨단 패키징 연동 수율 안정화 및 서버 고객사 선주문 협의가 반영됐습니다.'
        : '후공정 패키징 기판 수급 병목 및 시운전 비용이 반영됐습니다.';

      aPair = createSingleArcPaidClue({
        year: y,
        stock: aSemiStock,
        arcStageLabel,
        isPositive: aPos,
        topic: '패키징 라인 연동 및 고객사 협의 현황',
        subtitle: `A반도체의 후공정 패키징 연동 수율 및 고객사 협의 현황 조사`,
        postTitle: midGood
          ? `A반도체, 전공정-패키징 통합 라인 시험 수율 목표치 도달 및 서버 고객사 물량 예약`
          : `A반도체, 첨단 패키징용 인터포저 기판 수급 병목으로 통합 시운전 비용 증가`,
        body: midGood
          ? `A 반도체가 신규 웨이퍼 라인과 후공정 패키징 공정을 연결한 통합 테스트에서 목표 수율에 도달하며 서버 고객사들과 선주문 물량 협의를 진행 중이다.`
          : `첨단 패키징에 들어가는 실리콘 인터포저 기판 조달이 지연되면서 A 반도체의 통합 시운전 대기 비용이 늘어나고 있다.`,
        highlightNote: midGood
          ? '통합 패키징 시험 수율 목표 도달과 고객사 물량 예약이 확인됐습니다.'
          : '패키징 기판 조달 병목에 따른 시운전 비용 부담이 확인됐습니다.'
      });

      bPos = bGood;
      bRate = bGood ? Number(randFloat(0.05, 0.12).toFixed(3)) : Number(randFloat(-0.08, -0.03).toFixed(3));
      bReason = bGood
        ? '첨단 패키징용 접합·식각 장비 추가 납품이 반영됐습니다.'
        : '주력 장비 납품 이후 후속 발주 대기 구간 진입이 반영됐습니다.';

      bPair = createSingleArcPaidClue({
        year: y,
        stock: bSemiStock,
        arcStageLabel,
        isPositive: bPos,
        topic: '패키징용 추가 장비 수주 및 납품 현황',
        subtitle: `B반도체의 후공정·패키징 연동 장비 추가 수주 현황 조사`,
        postTitle: bGood
          ? `B반도체, 패키징 공정 연동용 TSV 식각·세정 장비 추가 수주 및 연내 납품`
          : `B반도체, 주력 전공정 장비 납품 일단락 후 차기 발주까지 수주 공백 구간`,
        body: bGood
          ? `B 반도체가 고객사의 패키징 라인 확장에 맞춰 실리콘관통전극(TSV) 식각 및 세정 장비 추가 물량을 수주해 연내 납품을 진행 중이다.`
          : `B 반도체의 전공정 장비 주력 물량 납품이 마무리되면서 고객사의 최종 양산 전환 전까지 단기 신규 수주 공백이 발생했다.`,
        highlightNote: bGood
          ? '패키징 공정용 추가 장비 수주와 연내 납품이 확인됐습니다.'
          : '주력 물량 납품 후 단기 수주 공백 구간임이 확인됐습니다.'
      });
    } else {
      // 최종 단계 거래 연도 (내년 개장에 최종 양산 성패가 반영되므로 구매 시점의 양산 전환 일정과 감가상각·재고 리스크만 제공)
      fTitle = `${variant.fabName} 본격 양산 전환 임박… 글로벌 서버 고객사 물량 배정 협상`;
      fSum = `${durationYears}년간 투자한 신규 메모리 라인의 양산 출하 일정과 수율·재고 과잉 리스크 점검 (${durationYears}/${durationYears} 최종 단계)`;
      fBody = `수년간 대규모 설비 투자가 투입된 ${variant.fabName}이 본격 양산 전환 시점을 맞았다. 내년 개장 전 확정될 글로벌 데이터센터 납품 일정과 막바지 수율·재고 리스크에 시장의 관심이 집중되고 있다.`;

      aPos = finalSuccess;
      bPos = finalSuccess;
      if (finalSuccess) {
        aRate = Number(randFloat(0.28, 0.62).toFixed(3));
        aReason = '신규 증설 메모리 라인 본격 양산 가동 및 데이터센터향 출하 급증이 반영됐습니다.';
        bRate = Number(randFloat(0.08, 0.20).toFixed(3));
        bReason = '고객사 양산 가동률 상승에 따른 유지보수 및 업그레이드 장비 납품이 반영됐습니다.';
      } else {
        aRate = Number(randFloat(-0.25, -0.14).toFixed(3));
        aReason = '증설 메모리 라인 가동률 부진 및 대규모 감가상각비 부담이 반영되어 하락했습니다.';
        bRate = Number(randFloat(-0.18, -0.08).toFixed(3));
        bReason = '메모리 고객사 투자 동결에 따른 후속 장비 발주 보류가 반영되어 하락했습니다.';
      }

      aPair = createChoicePaidCluePair({
        year: y,
        stock: aSemiStock,
        arcStageLabel,
        isPositive: aPos,
        scheduleWhatItTells: '양산 웨이퍼 출하 개시 시점과 글로벌 데이터센터 연간 공급 계약 확정 일정을 확인합니다.',
        scheduleSubtitle: `A반도체의 ${variant.fabName} 양산 출하 및 장기 공급 계약 일정 조사`,
        schedulePostTitle: `A반도체, 연말 양산 가동 전환 후 내년 개장 전 글로벌 데이터센터 연간 공급 물량 확정 예정`,
        scheduleBody: `A 반도체가 ${variant.fabName}의 양산 전환 일정을 연말로 잡고 글로벌 서버 고객사들과 연간 공급 물량 배정 협상을 진행 중이다. 최종 양산 가동률과 장기 공급 계약 규모는 내년 개장 직전에 확정되어 발표된다.`,
        scheduleHighlight: '연말 양산 전환을 거쳐 내년 개장 직전에 연간 공급 물량과 가동률이 최종 확정되는 일정입니다.',
        riskWhatItTells: '대규모 감가상각비 개시 부담, 서버 고객사 재고 조정, 가동률 미달 리스크를 확인합니다.',
        riskSubtitle: `A반도체의 양산 감가상각 부담 및 고객사 재고 조정 리스크 조사`,
        riskPostTitle: `A반도체, 양산 전환 시 대규모 설비 감가상각비 일시 반영… 고객사 재고 조정 시 수익성 급감 리스크`,
        riskBody: `신규 라인이 양산 가동으로 전환되는 즉시 수년간 투입된 설비 투자금이 대규모 감가상각 비용으로 매 분기 반영되기 시작한다. 글로벌 서버 고객사들이 보유 재고 조정을 이유로 초기 발주량을 줄일 경우 손익분기 가동률에 미달해 영업이익이 급감할 위험이 있다.`,
        riskHighlight: '양산 전환과 동시에 대규모 감가상각비가 반영되므로 초기 가동률 미달 시 수익성 하락 리스크가 큽니다.'
      });

      bPair = createChoicePaidCluePair({
        year: y,
        stock: bSemiStock,
        arcStageLabel,
        isPositive: bPos,
        scheduleWhatItTells: '양산 라인 유지보수 부품 공급 일정과 후속 공정 업그레이드 발주 일정을 확인합니다.',
        scheduleSubtitle: `B반도체의 양산 유지보수 계약 및 추가 증설 발주 일정 조사`,
        schedulePostTitle: `B반도체, 고객사 연말 양산 전환에 맞춰 내년 개장 전 유지보수 및 후속 장비 발주 일정 결정 예정`,
        scheduleBody: `A 반도체의 신규 라인이 연말 양산 전환 단계에 들어서면서 B 반도체의 소모성 유지보수 파츠 공급 계약과 추가 업그레이드 장비 발주 일정이 내년 개장 직전에 확정될 예정이다.`,
        scheduleHighlight: '고객사의 연말 양산 전환 직후인 내년 개장 전에 유지보수 및 후속 장비 발주 일정이 확정됩니다.',
        riskWhatItTells: '고객사 감산 전환 시 후속 장비 발주 동결 및 단가 인하 압박 리스크를 확인합니다.',
        riskSubtitle: `B반도체의 고객사 설비 투자 동결 및 발주 보류 리스크 조사`,
        riskPostTitle: `B반도체, 메모리 고객사 가동률 저하 및 설비 투자 동결 시 후속 라인 장비 발주 전면 보류 리스크`,
        riskBody: `메모리 제조 고객사가 신규 라인의 초기 가동률과 시황을 보고 추가 설비 투자(CAPEX) 규모를 조정할 방침이다. 고객사가 감산이나 투자 동결을 결정할 경우 B 반도체가 기대했던 후속 라인 장비 발주가 전면 보류되고 부품 단가 인하 압박이 커질 위험이 있다.`,
        riskHighlight: '고객사가 설비 투자를 동결할 경우 후속 장비 발주가 전면 보류될 수 있는 리스크가 확인됐습니다.'
      });
    }

    stagesByYear[y] = {
      stepIndex: stageNum,
      totalSteps: durationYears,
      freeArticle: {
        id: `free_${y}_semi_arc`,
        year: y,
        type: 'free',
        industry: '반도체',
        hideCompanyName: false,
        relatedStockIds: ['a_semi', 'b_semi'],
        title: fTitle,
        summary: fSum,
        body: fBody,
        fallbackTitle: fTitle,
        fallbackSummary: fSum,
        fallbackBody: fBody,
        disclosedFacts: [fTitle, fSum],
        questionOrClue: 'A반도체·B반도체 각각 일정 단서와 사업 리스크 단서 중 필요한 정보를 선택해 설비비 반영 시점과 장비 납품 리스크를 추리하게 한다.',
        arcStageLabel
      },
      outcomesByStock: {
        a_semi: {
          rate: aRate,
          isMegaBoom: false,
          reason: aReason,
          signature: `semi_arc:${y}:a_semi:step${stageNum}:${aPos ? 'pos' : 'neg'}`,
          paidArticles: aPair
        },
        b_semi: {
          rate: bRate,
          isMegaBoom: false,
          reason: bReason,
          signature: `semi_arc:${y}:b_semi:step${stageNum}:${bPos ? 'pos' : 'neg'}`,
          paidArticles: bPair
        }
      }
    };
  }

  return {
    arcMeta: {
      arcId: `arc_semi_${startYear}_${finalOpeningYear}`,
      title: `${variant.fabName} 및 장비 납품 시차 프로젝트 (${startYear}~${finalOpeningYear}년 개장, ${durationYears}년 사건)`,
      industry: '반도체',
      targetStockIds: ['a_semi', 'b_semi'],
      startYear,
      endOpeningYear: finalOpeningYear,
      durationYears,
      finalOutcomeSummary: finalSuccess
        ? '초기 설비비 선집행(B반도체 장비 수주 선반영) 후 양산 가동률 95% 달성으로 A반도체 대규모 이익 회수'
        : '초기 설비비 집행 후 글로벌 재고 조정으로 양산 가동률 부진 및 후속 장비 발주 보류'
    },
    stagesByYear
  };
}

/**
 * 매 판마다 새로운 시세 흐름과 2~6년 다년도 장기 연쇄 사건(일정/리스크 선택형 유료 단서 포함)·단기 사건·기사를 생성
 */
function generateDynamicScenario(excludedSignatures = []) {
  const scenarioId = `scenario_dyn_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const excludedSet = new Set(Array.isArray(excludedSignatures) ? excludedSignatures : []);
  const eventSignatures = [];

  const aOwnsObesity = Math.random() < 0.5;
  const obesityOwnerId = aOwnsObesity ? 'a_bio' : 'b_bio';
  const vaccineOwnerId = aOwnsObesity ? 'b_bio' : 'a_bio';

  // 2~6년 길이의 다년도 장기 연쇄 사건 아크 3종
  // 초반(2011년)부터 선택형 유료 단서(일정 단서 vs 사업 리스크 단서)를 즉시 경험할 수 있도록
  // 조선·바이오 아크는 2011~2012년에 시작하고 반도체 아크는 2011~2013년에 시작하도록 배치합니다.
  const arcLengths = shuffle([3, 4, 5, 6]);
  const bioDuration = arcLengths[0];
  const shipDuration = arcLengths[1];
  const semiDuration = arcLengths[2];

  const bioStartYear = 2011;
  const shipStartYear = 2011;
  const semiStartYear = randInt(2011, Math.min(2013, 2020 - semiDuration));

  const shipFinalMode = pickOne(['megacontract_900', 'standard_win', 'breakdown']);
  const semiFinalSuccess = Math.random() < 0.55;

  const bioArc = generateBioMultiYearArc({
    startYear: bioStartYear,
    durationYears: bioDuration,
    obesityOwnerId,
    vaccineOwnerId
  });
  const shipArc = generateShipMultiYearArc({
    startYear: shipStartYear,
    durationYears: shipDuration,
    finalMode: shipFinalMode
  });
  const semiArc = generateSemiMultiYearArc({
    startYear: semiStartYear,
    durationYears: semiDuration,
    finalSuccess: semiFinalSuccess
  });

  const multiYearArcs = [bioArc.arcMeta, shipArc.arcMeta, semiArc.arcMeta];

  const pricesByYear = {};
  const openingReasonsByYear = {};
  const articlesByYear = {
    2010: { free: [], paid: [] }
  };

  // 2010년 첫 거래 시작가 동적 생성
  pricesByYear[2010] = {};
  for (const stock of STOCKS) {
    const [minP, maxP] = stock.basePriceRange;
    const steps = Math.floor((maxP - minP) / 500);
    pricesByYear[2010][stock.id] = minP + randInt(0, steps) * 500;
  }

  // 2011년 첫 개장 시세 생성 (상승 4~6종목, 하락 4~6종목 혼합)
  const shuffled2011 = shuffle(STOCKS.map((s) => s.id));
  const upSet2011 = new Set(shuffled2011.slice(0, randInt(4, 6)));

  pricesByYear[2011] = {};
  openingReasonsByYear[2011] = {};

  for (const stock of STOCKS) {
    const isUp = upSet2011.has(stock.id);
    const absRate = randFloat(0.04, 0.18);
    const signedRate = isUp ? absRate : -absRate;
    const prevP = pricesByYear[2010][stock.id];
    let nextP = Math.max(1, Math.round((prevP * (1 + signedRate)) / 10) * 10);
    if (nextP === prevP) {
      nextP = isUp ? prevP + 500 : Math.max(1, prevP - 500);
    }
    pricesByYear[2011][stock.id] = nextP;
    const reasonPool = isUp ? OPENING_2011_REASONS[stock.id].up : OPENING_2011_REASONS[stock.id].down;
    openingReasonsByYear[2011][stock.id] = pickOne(reasonPool);
  }

  const lastUsedEventKeyByStock = {};

  // 2011~2019년 거래 연도별 장기 아크 단계(선택형 유료 단서 2종) + 단년 사건(유료 단서 1종) 결합
  for (let tradeYear = 2011; tradeYear <= 2019; tradeYear++) {
    const openingYear = tradeYear + 1;
    pricesByYear[openingYear] = {};
    openingReasonsByYear[openingYear] = {};

    const yearOutcomesByStock = {};
    const arcFreeArticles = [];
    const singleFreeArticles = [];

    const bioStage = bioArc.stagesByYear[tradeYear];
    if (bioStage) {
      arcFreeArticles.push(bioStage.freeArticle);
      Object.assign(yearOutcomesByStock, bioStage.outcomesByStock);
      for (const out of Object.values(bioStage.outcomesByStock)) {
        eventSignatures.push(out.signature);
      }
    }

    const shipStage = shipArc.stagesByYear[tradeYear];
    if (shipStage) {
      arcFreeArticles.push(shipStage.freeArticle);
      Object.assign(yearOutcomesByStock, shipStage.outcomesByStock);
      for (const out of Object.values(shipStage.outcomesByStock)) {
        eventSignatures.push(out.signature);
      }
    }

    const semiStage = semiArc.stagesByYear[tradeYear];
    if (semiStage) {
      arcFreeArticles.push(semiStage.freeArticle);
      Object.assign(yearOutcomesByStock, semiStage.outcomesByStock);
      for (const out of Object.values(semiStage.outcomesByStock)) {
        eventSignatures.push(out.signature);
      }
    }

    for (const stock of STOCKS) {
      if (yearOutcomesByStock[stock.id]) continue;

      const templates = SINGLE_YEAR_TEMPLATES[stock.id];
      const nonRepeatedTpls = templates.filter((t) => t.eventKey !== lastUsedEventKeyByStock[stock.id]);
      const tpl = pickOne(nonRepeatedTpls.length > 0 ? nonRepeatedTpls : templates);
      lastUsedEventKeyByStock[stock.id] = tpl.eventKey;

      const unvisited = tpl.outcomes.filter(
        (o) => !excludedSet.has(`${tradeYear}:${stock.id}:${o.outcomeId}`)
      );
      const chosenOutcome = pickOne(unvisited.length > 0 ? unvisited : tpl.outcomes);
      const [minR, maxR] = chosenOutcome.rateRange;
      const rate = Number(randFloat(minR, maxR).toFixed(3));
      const sig = `${tradeYear}:${stock.id}:${chosenOutcome.outcomeId}`;
      eventSignatures.push(sig);

      singleFreeArticles.push({
        id: `free_${tradeYear}_${stock.id}`,
        year: tradeYear,
        type: 'free',
        industry: tpl.industry,
        hideCompanyName: false,
        relatedStockIds: [stock.id],
        title: tpl.freeTitle,
        summary: tpl.freeSummary,
        body: tpl.freeBody,
        fallbackTitle: tpl.freeTitle,
        fallbackSummary: tpl.freeSummary,
        fallbackBody: tpl.freeBody,
        disclosedFacts: [tpl.freeTitle, tpl.freeSummary],
        questionOrClue: `${stock.name}의 ${tpl.paidTopic}과 다음 개장 반영 시점을 추리하게 한다.`
      });

      const singlePaidObj = {
        id: `paid_${tradeYear}_${stock.id}`,
        year: tradeYear,
        type: 'paid',
        stockId: stock.id,
        stockName: stock.name,
        industry: tpl.industry,
        hasChoicePair: false,
        choiceGroup: null,
        clueType: 'single',
        clueTypeLabel: '단일 단서',
        topic: tpl.paidTopic,
        preTitle: `${stock.name} · ${tpl.paidTopic}`,
        whatItTells: `${stock.name}의 ${tradeYear}년 ${tpl.paidTopic} 및 실적 반영 조건을 확인합니다.`,
        subtitle: `${stock.name}의 ${tradeYear}년 ${tpl.paidTopic} 및 실적 반영 시점 조사`,
        postTitle: chosenOutcome.paidPostTitle,
        body: chosenOutcome.paidBody,
        fallbackPostTitle: chosenOutcome.paidPostTitle,
        fallbackBody: chosenOutcome.paidBody,
        highlightNote: chosenOutcome.paidHighlight,
        isPositive: chosenOutcome.isPositive,
        disclosedFacts: [chosenOutcome.paidPostTitle, chosenOutcome.paidBody],
        questionOrClue: chosenOutcome.paidHighlight
      };

      yearOutcomesByStock[stock.id] = {
        rate,
        isMegaBoom: false,
        reason: chosenOutcome.openingReason,
        signature: sig,
        paidArticles: [singlePaidObj]
      };
    }

    // 한 해에 상승 종목과 하락 종목이 모두 최소 3개 이상 섞이도록 보정
    const allIds = STOCKS.map((s) => s.id);
    const posIds = allIds.filter((id) => yearOutcomesByStock[id].rate > 0);
    const negIds = allIds.filter((id) => yearOutcomesByStock[id].rate < 0);

    if (posIds.length < 3 || negIds.length < 3) {
      const needPos = posIds.length < 3;
      const singleStockIds = allIds.filter(
        (id) =>
          !yearOutcomesByStock[id].isMegaBoom &&
          !(bioStage && (id === 'a_bio' || id === 'b_bio')) &&
          !(shipStage && id === 'a_ship') &&
          !(semiStage && (id === 'a_semi' || id === 'b_semi')) &&
          (needPos ? yearOutcomesByStock[id].rate < 0 : yearOutcomesByStock[id].rate > 0)
      );
      const deficit = 3 - (needPos ? posIds.length : negIds.length);
      const flipTargets = shuffle(singleStockIds).slice(0, deficit);

      for (const stockId of flipTargets) {
        const tpl = SINGLE_YEAR_TEMPLATES[stockId][0];
        const desired = tpl.outcomes.find((o) => o.isPositive === needPos);
        if (desired) {
          const [minR, maxR] = desired.rateRange;
          const rate = Number(randFloat(minR, maxR).toFixed(3));
          const stockMeta = STOCKS.find((s) => s.id === stockId);
          yearOutcomesByStock[stockId] = {
            rate,
            isMegaBoom: false,
            reason: desired.openingReason,
            signature: `${tradeYear}:${stockId}:${desired.outcomeId}`,
            paidArticles: [
              {
                id: `paid_${tradeYear}_${stockId}`,
                year: tradeYear,
                type: 'paid',
                stockId,
                stockName: stockMeta.name,
                industry: tpl.industry,
                hasChoicePair: false,
                choiceGroup: null,
                clueType: 'single',
                clueTypeLabel: '단일 단서',
                topic: tpl.paidTopic,
                preTitle: `${stockMeta.name} · ${tpl.paidTopic}`,
                whatItTells: `${stockMeta.name}의 ${tradeYear}년 ${tpl.paidTopic} 및 실적 반영 조건을 확인합니다.`,
                subtitle: `${stockMeta.name}의 ${tradeYear}년 ${tpl.paidTopic} 및 실적 반영 시점 조사`,
                postTitle: desired.paidPostTitle,
                body: desired.paidBody,
                fallbackPostTitle: desired.paidPostTitle,
                fallbackBody: desired.paidBody,
                highlightNote: desired.paidHighlight,
                isPositive: desired.isPositive,
                disclosedFacts: [desired.paidPostTitle, desired.paidBody],
                questionOrClue: desired.paidHighlight
              }
            ]
          };
        }
      }
    }

    for (const stock of STOCKS) {
      const prevPrice = pricesByYear[tradeYear][stock.id];
      const outcome = yearOutcomesByStock[stock.id];
      let nextPrice = Math.max(1, Math.round(prevPrice * (1 + outcome.rate)));
      if (nextPrice === prevPrice) {
        nextPrice = outcome.rate >= 0 ? prevPrice + 100 : Math.max(1, prevPrice - 100);
      }
      pricesByYear[openingYear][stock.id] = nextPrice;
      openingReasonsByYear[openingYear][stock.id] = outcome.reason;
    }

    const combinedFree5 = shuffle([
      ...arcFreeArticles,
      ...shuffle(singleFreeArticles)
    ].slice(0, 5));

    // 종목별 유료 기사 목록 펼치기 (장기 사건 종목은 [일정 단서, 사업 리스크 단서] 2개, 일반 종목은 1개)
    const paidList = STOCKS.flatMap((s) => yearOutcomesByStock[s.id].paidArticles || []);

    articlesByYear[tradeYear] = {
      free: combinedFree5,
      paid: paidList
    };
  }

  return {
    id: scenarioId,
    version: 'v5.0-choice-paid-clues',
    title: '동적 다년도(2~6년) 장기 사건 · 선택형 유료 단서 시나리오',
    majorEvents: eventSignatures,
    multiYearArcs,
    bioProjectOwners: {
      obesityProject: obesityOwnerId,
      vaccineProject: vaccineOwnerId
    },
    pricesByYear,
    openingReasonsByYear,
    articlesByYear
  };
}

/**
 * 기획서 7쪽 가격표 및 16쪽 기사 원문 검증 전용 시나리오 (verify.js 수식 검증용으로만 분리)
 */
function createVerificationScenarioP7() {
  return {
    id: 'scenario_verification_p7',
    version: 'v1.0-verification-only',
    title: '기획서 7쪽·16쪽 수식 검증 전용 시나리오',
    majorEvents: ['verify_p7_2011_2012'],
    multiYearArcs: [],
    bioProjectOwners: {
      obesityProject: 'a_bio',
      vaccineProject: 'b_bio'
    },
    pricesByYear: {
      2010: {
        a_bio: 22000,
        b_bio: 19000,
        a_enter: 18500,
        b_enter: 15000,
        a_semi: 32000,
        b_semi: 23000,
        a_food: 10500,
        a_game: 13000,
        a_ship: 19000,
        a_air: 16000
      },
      2011: {
        a_bio: 24000,
        b_bio: 18000,
        a_enter: 20000,
        b_enter: 16000,
        a_semi: 30000,
        b_semi: 25000,
        a_food: 10000,
        a_game: 14000,
        a_ship: 22000,
        a_air: 15000
      },
      2012: {
        a_bio: 26400,
        b_bio: 17460,
        a_enter: 22000,
        b_enter: 15680,
        a_semi: 28500,
        b_semi: 28000,
        a_food: 10800,
        a_game: 13020,
        a_ship: 22660,
        a_air: 15600
      }
    },
    openingReasonsByYear: {
      2011: {
        a_bio: '대사질환 연구 인력 확충 및 파이프라인 기대감이 반영됐습니다.',
        b_bio: '초기 후보물질 탐색 비용 지출로 소폭 하락했습니다.',
        a_enter: '음반 판매 호조와 공연 수요 회복세가 반영됐습니다.',
        b_enter: '드라마 제작 편수 확대 및 방영권 매출 증가가 반영됐습니다.',
        a_semi: 'PC용 메모리 현물 가격 조정으로 단기 실적이 둔화됐습니다.',
        b_semi: '반도체 공정 미세화에 따른 장비 발주 증가가 반영됐습니다.',
        a_food: '원곡 재고 단가 부담으로 마진이 소폭 축소됐습니다.',
        a_game: '모바일 신작 개발 진척 및 해외 서비스 기대감이 반영됐습니다.',
        a_ship: '글로벌 해상 물동량 회복과 대형 선박 수주 문의 증가가 반영됐습니다.',
        a_air: '국제 유가 상승에 따른 항공유 비용 부담이 반영됐습니다.'
      },
      2012: {
        a_bio: '비만 치료제 임상 초기 일정 순항이 반영됐습니다.',
        b_bio: '초기 연구비 지출이 반영됐습니다.',
        a_enter: '추가 공연 수익 반영으로 +10% 상승했습니다.',
        b_enter: '신작 드라마 선투입 제작비 부담이 반영됐습니다.',
        a_semi: '메모리 공장 증설 초기 설비비 부담이 반영됐습니다.',
        b_semi: '장비 계약 반영으로 +12% 상승했습니다.',
        a_food: '곡물 도매가 하락에 따른 원가 절감이 반영됐습니다.',
        a_game: '출시 일정 지연으로 −7% 하락했습니다.',
        a_ship: '해외 선사 수주 협상 진전이 반영됐습니다.',
        a_air: '국제선 여객 탑승률 상승이 반영됐습니다.'
      }
    },
    articlesByYear: {
      2010: { free: [], paid: [] },
      2011: {
        free: [
          {
            id: 'free_2011_1',
            year: 2011,
            type: 'free',
            industry: '엔터',
            relatedStockIds: ['a_enter', 'a_air'],
            title: '해외 공연 수요 회복에 추가 투어 검토',
            summary: '주요 도시 티켓 판매 호조… 현지 공연장 대관료와 운송료도 상승',
            body: '주요 도시의 티켓 판매가 예상을 웃돌자 기획사들이 추가 공연을 검토하고 있다. 현지 공연장 대관료와 장비 운송료도 지난해보다 올랐다.'
          },
          {
            id: 'free_2011_2',
            year: 2011,
            type: 'free',
            industry: '식품',
            relatedStockIds: ['a_food'],
            title: '곡물 도매가 3분기 연속 하락',
            summary: '올해 공급가를 갱신하는 가공업체는 낮아진 가격을 새 계약에 반영 가능',
            body: '주요 곡물의 도매가격이 3분기 연속 낮아졌다. 올해 공급가를 갱신하는 가공업체는 낮아진 가격을 새 계약에 반영할 수 있다.'
          },
          {
            id: 'free_2011_3',
            year: 2011,
            type: 'free',
            industry: '게임',
            relatedStockIds: ['a_game'],
            title: '모바일 게임 해외 사전 예약 개시',
            summary: '일부 해외 시장에서 사전 예약 시작… 정식 출시 날짜는 미공개',
            body: '국내 모바일 게임 제작사가 일부 해외 시장에서 사전 예약을 받기 시작했다. 정식 출시 날짜는 아직 공개되지 않았다.'
          },
          {
            id: 'free_2011_4',
            year: 2011,
            type: 'free',
            industry: '조선',
            relatedStockIds: ['a_ship'],
            title: '조선업계 대형 선박 수주 협상',
            summary: '해외 선사와 대형 선박 계약 협상 중… 인도와 대금 지급은 수년 소요 전망',
            body: '국내 조선업계가 해외 선사와 대형 선박 계약을 협상 중이다. 선박 인도와 최종 대금 지급은 수년에 걸칠 전망이다.'
          },
          {
            id: 'free_2011_5',
            year: 2011,
            type: 'free',
            industry: '반도체',
            relatedStockIds: ['a_semi', 'b_semi'],
            title: '국내 메모리 공장 증설 검토',
            summary: '설비 증설 검토 중… 신규 장비 발주와 공장 가동 시점은 미정',
            body: '메모리 생산업체가 국내 공장의 설비 증설을 검토하고 있다. 신규 장비 발주와 공장 가동 시점은 미정이다.'
          }
        ],
        paid: [
          {
            id: 'paid_2011_a_enter',
            year: 2011,
            type: 'paid',
            stockId: 'a_enter',
            stockName: 'A엔터',
            industry: '엔터',
            hasChoicePair: false,
            clueType: 'single',
            clueTypeLabel: '단일 단서',
            topic: '정산 조건',
            preTitle: 'A엔터 · 정산 조건',
            whatItTells: '추가 공연 대관료 분담 및 티켓 매출 정산 조건을 확인합니다.',
            subtitle: '추가 공연 대관료 분담 및 티켓 매출 정산 조건 조사',
            postTitle: '현지 주최 측 추가 공연 대관료 70% 부담 확정',
            body: '현지 주최 측이 추가 공연 대관료의 70%를 부담하기로 했다. A 엔터는 티켓 매출 일부를 정산받는다.',
            highlightNote: '대관료 비용 부담 완화로 추가 공연 수익이 내년 개장에 즉시 반영될 예정입니다.',
            isPositive: true
          },
          {
            id: 'paid_2011_a_game',
            year: 2011,
            type: 'paid',
            stockId: 'a_game',
            stockName: 'A게임',
            industry: '게임',
            hasChoicePair: false,
            clueType: 'single',
            clueTypeLabel: '단일 단서',
            topic: '출시 준비',
            preTitle: 'A게임 · 출시 준비',
            whatItTells: '해외 사전 예약 규모와 주요 출시 지역 심사 현황을 확인합니다.',
            subtitle: '해외 사전 예약 규모와 주요 출시 지역 심사 진행 상황',
            postTitle: '해외 사전 예약 호조이나 주요 출시 지역 심사 미완료',
            body: '해외 사전 예약은 예상보다 많았다. 주요 출시 지역의 심사가 끝나지 않아 올해 매출 반영은 어려울 전망이다.',
            highlightNote: '출시 일정이 지연되면서 단기 매출 공백이 예상됩니다.',
            isPositive: false
          },
          {
            id: 'paid_2011_b_semi',
            year: 2011,
            type: 'paid',
            stockId: 'b_semi',
            stockName: 'B반도체',
            industry: '반도체',
            hasChoicePair: false,
            clueType: 'single',
            clueTypeLabel: '단일 단서',
            topic: '발주 진행',
            preTitle: 'B반도체 · 발주 진행',
            whatItTells: '국내 메모리 증설 라인용 장비 공급 계약 및 첫 납품 일정을 확인합니다.',
            subtitle: '국내 메모리 증설 라인용 장비 공급 계약 및 첫 납품 일정',
            postTitle: '국내 증설 라인용 장비 공급 계약 체결 완료',
            body: 'B 반도체가 국내 증설 라인용 장비의 공급 계약을 체결했다. 첫 납품은 내년 개장 전까지 예정돼 있다.',
            highlightNote: '첫 납품 대금이 내년 개장 전 실적에 반영될 예정입니다.',
            isPositive: true
          }
        ]
      }
    }
  };
}

module.exports = {
  STOCKS,
  generateDynamicScenario,
  createVerificationScenarioP7
};
