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
const {
  extendSingleFreeArticle,
  extendSinglePaidArticle,
  getArcStageType,
  extendArcFreeBody,
  extendArcPaidList
} = require('./articleExtensions');
const {
  EXTRA_SINGLE_YEAR_TEMPLATES,
  EXTRA_ARC_MIDDLE_STAGES
} = require('./singleYearTemplatesExtra');

const STOCKS = [
  {
    id: 'a_bio',
    name: 'A바이오',
    displayName: 'A 바이오',
    badge: '바',
    industry: '바이오',
    publicBusiness: '신약 연구·개발',
    description: '대사질환 및 면역 신약 파이프라인 연구·개발',
    basePriceRange: [18000000, 28000000]
  },
  {
    id: 'b_bio',
    name: 'B바이오',
    displayName: 'B 바이오',
    badge: '바',
    industry: '바이오',
    publicBusiness: '신약 연구·개발',
    description: '합성신약 및 바이오 의약품 연구·개발',
    basePriceRange: [14000000, 23000000]
  },
  {
    id: 'a_enter',
    name: 'A엔터',
    displayName: 'A 엔터',
    badge: '엔',
    industry: '엔터',
    publicBusiness: '아티스트 기획·공연·음반',
    description: '글로벌 콘서트 투어 기획 및 음반 제작',
    basePriceRange: [15000000, 25000000]
  },
  {
    id: 'b_enter',
    name: 'B엔터',
    displayName: 'B 엔터',
    badge: '엔',
    industry: '엔터',
    publicBusiness: '영화·드라마 제작 및 판권 판매',
    description: '텐트폴 드라마·영화 제작 및 글로벌 OTT 판권 공급',
    basePriceRange: [12000000, 21000000]
  },
  {
    id: 'a_semi',
    name: 'A반도체',
    displayName: 'A 반도체',
    badge: '반',
    industry: '반도체',
    publicBusiness: '메모리 제조',
    description: 'D램 및 낸드플래시 메모리 반도체 생산',
    basePriceRange: [24000000, 36000000]
  },
  {
    id: 'b_semi',
    name: 'B반도체',
    displayName: 'B 반도체',
    badge: '반',
    industry: '반도체',
    publicBusiness: '반도체 장비 공급',
    description: '반도체 전공정 증착·식각 설비 제작 및 납품',
    basePriceRange: [19000000, 30000000]
  },
  {
    id: 'a_food',
    name: 'A식품',
    displayName: 'A 식품',
    badge: '식',
    industry: '식품',
    publicBusiness: '곡물 기반 가공식품',
    description: '제분·사료·간편식 제조 및 국내외 식품 유통',
    basePriceRange: [8000000, 15000000]
  },
  {
    id: 'a_game',
    name: 'A게임',
    displayName: 'A 게임',
    badge: '게',
    industry: '게임',
    publicBusiness: '모바일 게임 개발·서비스',
    description: '모바일 RPG 개발 및 글로벌 라이브 서비스',
    basePriceRange: [11000000, 19000000]
  },
  {
    id: 'a_ship',
    name: 'A조선',
    displayName: 'A 조선',
    badge: '조',
    industry: '조선',
    publicBusiness: '대형 선박 건조',
    description: '초대형 컨테이너선 및 LNG 운반선 건조·수출',
    basePriceRange: [16000000, 26000000]
  },
  {
    id: 'a_air',
    name: 'A항공',
    displayName: 'A 항공',
    badge: '항',
    industry: '항공',
    publicBusiness: '국제선 여객 운송',
    description: '중·단거리 및 장거리 국제선 여객·화물 항공 운송',
    basePriceRange: [12000000, 20000000]
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
      freeTitle: '해외 공연 수요 증가에 월드투어 추가 편성 검토',
      freeSummary: '주요 도시 예매율 확인… 현지 공연장 대관료와 장비 운송료 분담 조건 미확정',
      freeBody: [
        '글로벌 주요 도시의 콘서트 티켓 판매가 예상을 웃돌면서 국내 기획사들이 월드투어 추가 공연 편성을 검토하고 있다.',
        '해외 현지 공연장 섭외와 일정 조율이 시작됐으며, 추가 회차 편성 시 티켓 매출 정산 구조가 함께 논의되는 단계다.',
        '다만 현지 대형 공연장 대관료와 무대 장비 항공 운송료가 지난해보다 크게 오른 상태여서, 프로모터와의 비용 분담 비율이 확정되지 않은 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '투어 대관료 정산 조건',
      outcomes: [
        {
          outcomeId: 'tour_promoter_covers_70',
          isPositive: true,
          rateRange: [0.09, 0.24],
          paidPostTitle: 'A엔터, 현지 주최 측과 추가 공연 대관료 70% 분담 계약 체결',
          paidBody: [
            'A 엔터가 해외 추가 투어 편성을 앞두고 현지 프로모터와의 비용 분담 협의를 마무리했다.',
            '현지 주최 측이 추가 공연 대관료의 70%를 부담하고, A 엔터는 미니멈 개런티와 티켓 매출 일부를 정산받는 조건으로 계약을 마쳤다.',
            '공연 일정과 정산 기준이 확정되면서 올해 추가 회차의 고정비 부담이 크게 줄어든 구조다.'
          ].join('\n\n'),
          paidHighlight: '현지 주최 측의 대관료 70% 분담과 미니멈 개런티 정산 조건이 확인됐습니다.',
          openingReason: '현지 주최 측 대관료 70% 분담 및 해외 투어 추가 공연 수익이 반영됐습니다.'
        },
        {
          outcomeId: 'tour_cost_overrun',
          isPositive: false,
          rateRange: [-0.18, -0.07],
          paidPostTitle: 'A엔터, 현지 대관료·항공 운송비 상승분 자체 부담 조건으로 투어 진행',
          paidBody: [
            'A 엔터가 월드투어 추가 회차 일정을 잡는 과정에서 현지 공연장 대관료와 무대 장비 항공 운송비가 당초 예산보다 크게 올랐다.',
            '현지 프로모터와의 비용 분담 협의가 결론을 내지 못하면서 상승한 대관료와 운송비 대부분을 A 엔터가 자체 부담하는 조건으로 진행 중이다.',
            '추가 티켓 판매가 이뤄지더라도 선집행되는 투어 고정비 회수 부담이 남아 있다.'
          ].join('\n\n'),
          paidHighlight: '대관료·운송비 상승분을 자체 부담하는 계약 구조가 확인됐습니다.',
          openingReason: '해외 공연 대관료 및 장비 운송비 급등 부담이 반영되어 하락했습니다.'
        }
      ]
    },
    {
      eventKey: 'enter_album_merch_platform',
      industry: '엔터',
      freeTitle: '엔터 업계, 정규 앨범 발매 및 팬덤 플랫폼 굿즈 직판 확대',
      freeSummary: '음반 출하와 자체 커머스 굿즈 직판 추진… 해외 물류비와 재고 관리 조건 점검',
      freeBody: [
        '국내 기획사들이 주력 아티스트의 정규 앨범 발매 일정에 맞춰 글로벌 팬덤 플랫폼을 통한 굿즈(MD) 직판 사업을 확대하고 있다.',
        '초기 선주문 물량 확보와 함께 해외 직접 배송망 개편 작업이 진행 중이며, 디지털 콘텐츠와 투어 상품 비중 조정이 함께 이뤄지고 있다.',
        '다만 대량 제작한 시즌 굿즈의 재고 소진 속도와 항공 물류 단가 부담이 남아 있어 실제 정산 조건 확인이 필요하다.'
      ].join('\n\n'),
      paidTopic: '음반·MD 정산 및 물류비',
      outcomes: [
        {
          outcomeId: 'merch_high_margin_hit',
          isPositive: true,
          rateRange: [0.10, 0.23],
          paidPostTitle: 'A엔터, 주력 그룹 신보 선주문 자체 최고치 및 디지털 MD 비중 확대',
          paidBody: [
            'A 엔터 주력 그룹의 정규 앨범 선주문 물량이 기존 최고 기록을 경신하며 초도 출하 일정이 확정됐다.',
            '원가 비중이 낮은 디지털 콘텐츠와 투어 응원봉 물량이 조기 소진되면서 팬덤 커머스 정산 구조가 안정적으로 유지되고 있다.',
            '해외 배송 물량은 사전 계약 단가로 처리돼 추가 물류비 부담도 제한적인 상태다.'
          ].join('\n\n'),
          paidHighlight: '음반 선주문 물량 확보와 저원가 디지털 MD 조기 소진이 확인됐습니다.',
          openingReason: '주력 아티스트 정규 앨범 흥행 및 글로벌 팬덤 MD 고마진 매출이 반영됐습니다.'
        },
        {
          outcomeId: 'merch_inventory_writeoff',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'A엔터, 해외 배송망 개편 물류비 증가 및 시즌 굿즈 미판매 재고 누적',
          paidBody: [
            'A 엔터가 글로벌 팬덤 커머스 직판 배송망을 개편하는 과정에서 항공 물류 단가가 계약 당시보다 높아졌다.',
            '여기에 대량 선제작한 시즌 기획 굿즈 일부가 미판매 상태로 남아 재고 평가 충당금 설정 여부가 검토되고 있다.',
            '연말 정산 전까지 잔여 재고 처분과 물류비 정산 부담이 남아 있는 조건이다.'
          ].join('\n\n'),
          paidHighlight: '해외 항공 물류비 증가와 미판매 굿즈 재고 충당금 검토 조건이 확인됐습니다.',
          openingReason: '팬덤 커머스 해외 물류비 증가 및 시즌 MD 재고 평가손실이 반영됐습니다.'
        }
      ]
    },
    {
      eventKey: 'enter_artist_renewal_ip',
      industry: '엔터',
      freeTitle: '엔터 업계, 간판 아티스트 전속계약 재계약 협상 시즌 진입',
      freeSummary: '핵심 매출원 전속계약 만료 도래… 재계약 타결 시점과 수익 배분율 조건 조율 중',
      freeBody: [
        '엔터 업계의 핵심 매출을 담당하는 간판 아티스트들의 전속계약 만료 시점이 다가오면서 재계약 협상이 본격화됐다.',
        '기획사들은 완전체 활동 일정과 글로벌 브랜드 광고 계약을 연계해 재계약 조건을 조율하고 있다.',
        '다만 아티스트 측의 정산 비율 상향 요구와 계약금 규모를 두고 이견이 남을 경우 하반기 활동 일정이 순연될 수 있는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '전속계약 재계약 조건',
      outcomes: [
        {
          outcomeId: 'renewal_full_group_success',
          isPositive: true,
          rateRange: [0.11, 0.26],
          paidPostTitle: 'A엔터, 간판 그룹 전원 재계약 합의 및 하반기 글로벌 광고 계약 확정',
          paidBody: [
            'A 엔터의 핵심 매출 비중을 차지하는 간판 그룹 멤버 전원이 전속계약 재계약 조건에 합의했다.',
            '재계약 타결에 따라 하반기 완전체 활동 일정과 글로벌 브랜드 광고 계약이 공백 없이 예정대로 진행된다.',
            '기존 정산 구조의 큰 변동 없이 차기 투어 일정까지 연계 계약이 마무리됐다.'
          ].join('\n\n'),
          paidHighlight: '전원 재계약 합의와 하반기 완전체 활동·광고 일정 확정이 확인됐습니다.',
          openingReason: '간판 아티스트 전원 재계약 타결 및 글로벌 광고 수익 유입이 반영됐습니다.'
        },
        {
          outcomeId: 'renewal_bonus_burden',
          isPositive: false,
          rateRange: [-0.17, -0.07],
          paidPostTitle: 'A엔터, 재계약 협상 장기화로 완전체 컴백 순연 및 정산 비율 상향 요구',
          paidBody: [
            'A 엔터가 간판 아티스트와의 전속계약 재계약 조건을 두고 장기간 조율을 이어가고 있다.',
            '협상이 길어지면서 하반기 예정했던 완전체 앨범 발매와 투어 일정이 뒤로 미뤄진 상태다.',
            '아티스트 측이 기존보다 높은 수익 정산 비율을 요구하고 있어 원가 구조 부담 조건이 남아 있다.'
          ].join('\n\n'),
          paidHighlight: '협상 장기화에 따른 컴백 일정 순연과 정산 비율 상향 요구 조건이 확인됐습니다.',
          openingReason: '재계약 협상에 따른 완전체 활동 공백 및 정산 비용 증가가 반영됐습니다.'
        }
      ]
    }
  ],

  b_enter: [
    {
      eventKey: 'b_enter_ott_series',
      industry: '엔터',
      freeTitle: '글로벌 OTT, 국내 제작사와 텐트폴 드라마 판권 협상 진행',
      freeSummary: '대작 시리즈 제작비 선투입 완료… 마스터본 납품 시점과 판권 정산 일정이 조건',
      freeBody: [
        '글로벌 OTT 플랫폼들이 국내 드라마 제작사들과 시즌제 텐트폴 작품의 해외 판권 공급 계약을 논의하고 있다.',
        '국내 제작사들은 이미 대규모 제작비를 선투입해 촬영과 후반 작업을 진행 중이며, 최종 마스터본 납품 시점에 맞춰 대금이 정산되는 구조다.',
        '다만 후반 시각효과(CG) 공정 일정이 지연되면 판권 대금 정산이 차기 연도로 이월될 수 있는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '판권 계약 및 정산 일정',
      outcomes: [
        {
          outcomeId: 'ott_upfront_settlement',
          isPositive: true,
          rateRange: [0.09, 0.25],
          paidPostTitle: 'B엔터, 글로벌 OTT 대작 마스터본 납품 완료 및 연내 일괄 정산 확정',
          paidBody: [
            'B 엔터가 제작한 대작 드라마가 후반 작업을 마치고 글로벌 OTT 플랫폼에 최종 마스터본 납품을 완료했다.',
            '계약 조건에 따라 선투입된 제작비와 해외 판권 대금이 다음 개장 전 일괄 정산되는 일정이 확정됐다.',
            '추가 재촬영이나 납품 보완 요구 없이 검수가 마무리된 상태다.'
          ].join('\n\n'),
          paidHighlight: 'OTT 마스터본 납품 완료와 연내 판권 대금 일괄 정산 일정이 확인됐습니다.',
          openingReason: '글로벌 OTT 드라마 납품 완료 및 판권 정산 수익이 반영됐습니다.'
        },
        {
          outcomeId: 'ott_production_cost_delay',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'B엔터, 대작 드라마 후반 CG 작업 지연으로 OTT 납품·정산 시점 이월',
          paidBody: [
            'B 엔터가 대규모 제작비를 선집행한 텐트폴 드라마의 후반 시각효과(CG) 공정이 예정보다 길어지고 있다.',
            '최종 마스터본 납품이 지연되면서 글로벌 OTT 판권 대금 정산 시점도 차기 연도 이후로 이월될 가능성이 커졌다.',
            '올해는 판권 정산 없이 선투입 제작비와 추가 후반 작업비만 먼저 반영되는 조건이다.'
          ].join('\n\n'),
          paidHighlight: '후반 작업 지연으로 인한 납품·정산 이월과 선투입 제작비 부담 조건이 확인됐습니다.',
          openingReason: '드라마 선투입 제작비 부담과 판권 정산 일정 지연이 반영됐습니다.'
        }
      ]
    },
    {
      eventKey: 'b_enter_theatrical_movie_release',
      industry: '엔터',
      freeTitle: '성수기 극장가, 대작 영화 개봉 및 해외 부가판권 협상 개시',
      freeSummary: '텐트폴 신작 개봉 돌입… 상영관 확보 추이와 해외·VOD 선판매 계약 여부가 변수',
      freeBody: [
        '영상 제작·배급사들이 성수기 극장가에 대규모 제작비가 투입된 텐트폴 신작 영화를 선보였다.',
        '극장 관객 동원뿐 아니라 아시아 주요국 방영권과 VOD 부가 판권 선판매 계약이 제작비 회수의 핵심 경로로 작동하고 있다.',
        '다만 경쟁작과의 상영관 확보 경쟁이 치열해 초기 좌석점유율이 손익분기점에 못 미칠 경우 마케팅비 회수 부담이 남는 조건이다.'
      ].join('\n\n'),
      paidTopic: '예매율 추이 및 부가판권 계약',
      outcomes: [
        {
          outcomeId: 'movie_boxoffice_hit',
          isPositive: true,
          rateRange: [0.10, 0.24],
          paidPostTitle: 'B엔터, 배급 신작 개봉 첫 주 손익분기점 근접 및 아시아 판권 선판매 체결',
          paidBody: [
            'B 엔터가 투자·배급한 성수기 신작 영화가 개봉 첫 주 높은 좌석점유율을 기록하며 손익분기점에 빠르게 근접했다.',
            '동시에 아시아 주요국 방영권 선판매 계약이 성사되면서 순제작비의 상당 부분을 조기에 확보했다.',
            '추가 마케팅 비용 투입 없이 극장 상영과 부가 판권 정산이 이어지는 구조다.'
          ].join('\n\n'),
          paidHighlight: '초기 좌석점유율 호조와 아시아 판권 선판매를 통한 제작비 조기 확보가 확인됐습니다.',
          openingReason: '투자·제작 영화의 극장 흥행 돌파 및 해외 판권 완판 수익이 반영됐습니다.'
        },
        {
          outcomeId: 'movie_bep_miss',
          isPositive: false,
          rateRange: [-0.18, -0.07],
          paidPostTitle: 'B엔터, 주력 개봉작 상영관 축소 및 마케팅비 회수 미달 구간 진입',
          paidBody: [
            'B 엔터가 대규모 홍보·마케팅비를 투입해 개봉한 주력 신작 영화가 경쟁작에 밀려 개봉 2주 차부터 상영관 수가 줄어들고 있다.',
            '해외 부가 판권 선판매도 일부 지역에 그쳐 총제작비와 마케팅비 손익분기점 달성이 어려운 흐름이다.',
            '미회수 제작비에 대한 상각 처리 부담이 남아 있는 조건이다.'
          ].join('\n\n'),
          paidHighlight: '상영관 축소와 부가판권 미진으로 제작비 미회수 상각 조건이 확인됐습니다.',
          openingReason: '주력 영화 관객 수 부진에 따른 제작비 미회수 상각 손실이 반영됐습니다.'
        }
      ]
    }
  ],

  a_food: [
    {
      eventKey: 'food_grain_wholesale_contract',
      industry: '식품',
      freeTitle: '국제 곡물 도매가 변동과 가공식품 원료 공급 재계약 시점 도래',
      freeSummary: '주요 곡물 도매가 조정… 업체별 기존 장기계약 만료 시점과 재고 소진 속도가 변수',
      freeBody: [
        '국제 곡물 도매가격이 움직이면서 국내 가공식품 제조업체들의 원료 공급 계약 갱신 시점이 다가왔다.',
        '업계에서는 기존 공급 계약이 만료되는 업체부터 새 도매 단가를 하반기 제조 원가에 반영할 수 있을 것으로 보고 있다.',
        '다만 과거 고점에 체결한 장기 원곡 계약 잔여 물량이 남아 있거나 포장재·물류비가 동시에 오른 경우 단가 인하 효과가 지연되는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '원가 계약 및 재고 현황',
      outcomes: [
        {
          outcomeId: 'grain_cost_drop_applied',
          isPositive: true,
          rateRange: [0.08, 0.20],
          paidPostTitle: 'A식품, 기존 원료 계약 만료로 낮아진 곡물 도매가 신규 계약에 반영',
          paidBody: [
            '주요 곡물의 도매가격이 낮아진 시점에 A 식품의 기존 원료 장기 공급 계약이 만료됐다.',
            'A 식품은 낮아진 시세를 기준으로 신규 원료 공급 계약을 체결해 하반기 제조 원가부터 즉시 새 단가를 적용받는다.',
            '기존 고가 재고도 대부분 소진돼 원가 반영 시차가 짧은 구조다.'
          ].join('\n\n'),
          paidHighlight: '기존 계약 만료로 낮아진 곡물 도매가가 하반기 제조 원가에 즉시 반영되는 구조가 확인됐습니다.',
          openingReason: '곡물 도매가 하락에 따른 신규 원료 계약 원가 절감이 반영됐습니다.'
        },
        {
          outcomeId: 'grain_high_cost_locked',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'A식품, 과거 고가 원료 장기계약 잔여 물량으로 단가 인하 반영 지연',
          paidBody: [
            '국제 곡물 도매가격이 낮아졌으나 A 식품은 과거 고점에 맺은 원곡 장기 공급 계약 물량이 아직 상당량 남아 있다.',
            '잔여 계약 물량을 우선 소진해야 하는 조건 때문에 올해 제조 원가에는 낮아진 도매가가 반영되기 어렵다.',
            '여기에 포장재와 국내 운송 물류비 부담도 함께 이어지고 있는 상태다.'
          ].join('\n\n'),
          paidHighlight: '과거 고가 장기계약 잔여 물량 소진 전까지 원가 인하가 반영되지 않는 조건이 확인됐습니다.',
          openingReason: '고가 원료 재고 부담 및 물류·포장 원가 상승이 반영되어 하락했습니다.'
        }
      ]
    },
    {
      eventKey: 'food_kfood_overseas_export',
      industry: '식품',
      freeTitle: '국내 식품업계, 북미·유럽 대형 유통망 입점 및 수출 라인 증편',
      freeSummary: '간편식·면류 해외 대형마트 입점 추진… 초기 매대 수수료와 재발주 속도가 조건',
      freeBody: [
        '국내 식품업체들이 북미와 유럽 주류 대형마트 채널에 간편식과 면류 제품 입점을 추진하고 있다.',
        '일부 업체는 수출 전용 생산 라인을 증편하며 본사 직매입 형태의 공급 계약 협상에 들어갔다.',
        '다만 해외 유통망 진입 초기에 매대 입점 수수료와 현지 시식 판촉비를 먼저 집행해야 하는 경우가 많아, 재발주 속도가 조건으로 남아 있다.'
      ].join('\n\n'),
      paidTopic: '해외 유통망 입점 및 판촉비',
      outcomes: [
        {
          outcomeId: 'kfood_costco_walmart_hit',
          isPositive: true,
          rateRange: [0.10, 0.24],
          paidPostTitle: 'A식품, 북미 대형 유통 체인 본사 직매입 입점 계약 및 수출 라인 증편',
          paidBody: [
            'A 식품의 주력 간편식과 면류가 북미 대형 유통 체인 본사와의 직매입 입점 계약을 체결했다.',
            '초기 매대 입점 수수료 면제 조건이 포함됐으며, 초도 물량 출하에 맞춰 국내 수출 전용 생산 라인도 증편 가동에 들어갔다.',
            '현지 판촉비 선집행 부담이 낮은 구조로 수출 물량이 공급되고 있다.'
          ].join('\n\n'),
          paidHighlight: '입점 수수료 면제 조건의 북미 대형 유통 체인 직매입 계약이 확인됐습니다.',
          openingReason: '북미·유럽 대형 유통망 전 지점 입점 및 고마진 수출 급증이 반영됐습니다.'
        },
        {
          outcomeId: 'kfood_promo_fee_burden',
          isPositive: false,
          rateRange: [-0.15, -0.05],
          paidPostTitle: 'A식품, 해외 유통망 초기 매대 수수료·판촉비 선집행 및 재발주 지연',
          paidBody: [
            'A 식품이 북미·유럽 대형 유통망 진입을 위해 초기 매대 입점 수수료와 현지 시식 판촉비를 먼저 지출했다.',
            '그러나 초도 진열 이후 현지 소비자의 재발주 속도가 계획보다 더뎌 추가 선적 물량이 아직 확정되지 않았다.',
            '선집행된 입점·물류 수수료를 회수하기까지 시간이 더 필요한 조건이다.'
          ].join('\n\n'),
          paidHighlight: '초기 입점 수수료·판촉비 선집행과 현지 재발주 지연 조건이 확인됐습니다.',
          openingReason: '해외 유통망 초기 입점 수수료 및 판촉비 부담 증가가 반영됐습니다.'
        }
      ]
    }
  ],

  a_game: [
    {
      eventKey: 'game_overseas_launch_review',
      industry: '게임',
      freeTitle: '국내 모바일 게임 신작, 해외 주요 시장 사전 예약 개시',
      freeSummary: '해외 사전 예약자 모집 시작… 주요 출시 지역 등급 심사 완료 시점은 미확정',
      freeBody: [
        '국내 모바일 게임 제작사가 주력 신작 타이틀의 해외 주요 시장 사전 예약자 모집에 돌입했다.',
        '사전 예약 초기 유입 지표는 빠르게 늘고 있으며, 개발사는 연내 글로벌 동시 서비스를 목표로 현지화 작업을 마무리하고 있다.',
        '다만 주요 매출 비중이 큰 핵심 출시 지역의 등급 심사가 아직 완료되지 않은 경우 연내 정식 출시와 매출 집계가 미뤄질 수 있는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '출시 준비 및 심사 현황',
      outcomes: [
        {
          outcomeId: 'game_review_delayed',
          isPositive: false,
          rateRange: [-0.19, -0.07],
          paidPostTitle: 'A게임, 해외 사전 예약 유입 확인… 주요 출시 지역 등급 심사 미완료',
          paidBody: [
            'A 게임의 모바일 신작 해외 사전 예약자 수는 내부 목표치를 웃도는 수준으로 집계됐다.',
            '그러나 핵심 매출 비중을 차지하는 주요 출시 지역의 서비스 등급 심사가 아직 끝나지 않아 보완 자료를 추가 제출한 상태다.',
            '심사 완료 일정이 확정되지 않아 올해 안에 정식 출시와 초기 결제 매출을 반영하기 어려운 조건이다.'
          ].join('\n\n'),
          paidHighlight: '사전 예약은 목표를 웃돌았으나 주요 지역 등급 심사 미완료로 연내 출시가 어려운 조건입니다.',
          openingReason: '주요 출시 지역 심사 지연에 따른 정식 출시 연기가 반영됐습니다.'
        },
        {
          outcomeId: 'game_global_hit_launch',
          isPositive: true,
          rateRange: [0.12, 0.30],
          paidPostTitle: 'A게임, 주요 출시 지역 등급 심사 통과 및 연내 글로벌 동시 출시 확정',
          paidBody: [
            'A 게임의 주력 모바일 신작이 해외 주요 출시 지역의 서비스 등급 심사를 모두 통과했다.',
            '이에 따라 올해 안에 글로벌 동시 정식 서비스를 개시하고 초기 결제 매출을 정상 집계하는 일정이 확정됐다.',
            '사전 예약자 유입과 서버 부하 점검도 출시 일정에 맞춰 마무리된 상태다.'
          ].join('\n\n'),
          paidHighlight: '주요 지역 등급 심사 통과로 연내 글로벌 정식 출시와 매출 집계 일정이 확정됐습니다.',
          openingReason: '모바일 신작 해외 정식 출시 흥행과 초기 결제 매출 급증이 반영됐습니다.'
        }
      ]
    },
    {
      eventKey: 'game_pc_console_crossplay',
      industry: '게임',
      freeTitle: '게임 업계, 주력 타이틀 대형 확장팩 업데이트 및 자체 PC 런처 도입',
      freeSummary: '확장팩 업데이트와 자체 결제 런처 가동… 서버 안정성과 이용자 결제 비중이 조건',
      freeBody: [
        '국내 게임사가 주력 라이브 타이틀의 대형 확장팩 업데이트와 함께 앱마켓을 거치지 않는 자체 PC 결제 런처를 도입했다.',
        '자체 PC 런처 결제 비중이 높아지면 외부 플랫폼 수수료 부담을 줄일 수 있어 업계가 결제 전환 추이를 주시하고 있다.',
        '다만 업데이트 직후 트래픽 집중에 따른 서버 접속 장애나 과금 밸런스 불만이 생길 경우 이용자 이탈과 환불이 발생할 수 있는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '자체 결제 비중 및 서버 현황',
      outcomes: [
        {
          outcomeId: 'crossplay_pc_margin_boom',
          isPositive: true,
          rateRange: [0.11, 0.28],
          paidPostTitle: 'A게임, 확장팩 복귀 이용자 증가 및 자체 PC 런처 결제 비중 절반 돌파',
          paidBody: [
            'A 게임의 주력 타이틀 확장팩 업데이트 직후 휴면 이용자 복귀 지표가 뚜렷하게 늘어났다.',
            '특히 외부 앱마켓 수수료가 없는 자체 PC 런처 결제 비중이 전체 결제의 절반을 넘어선 것으로 집계됐다.',
            '대규모 서버 장애 없이 트래픽이 안정적으로 유지되며 플랫폼 수수료 절감 효과가 반영되는 구조다.'
          ].join('\n\n'),
          paidHighlight: '휴면 이용자 복귀와 수수료 없는 자체 PC 런처 결제 비중 확대가 확인됐습니다.',
          openingReason: '확장팩 흥행 및 자체 PC 결제 비중 확대에 따른 수수료 절감이 반영됐습니다.'
        },
        {
          outcomeId: 'crossplay_server_issue_refund',
          isPositive: false,
          rateRange: [-0.18, -0.07],
          paidPostTitle: 'A게임, 확장팩 업데이트 직후 서버 접속 장애 반복 및 환불 요청 증가',
          paidBody: [
            'A 게임의 대규모 확장팩 업데이트 이후 주말 피크 시간대 서버 대기열과 접속 끊김 장애가 반복되고 있다.',
            '여기에 신규 과금 아이템 밸런스를 둘러싼 이용자 불만이 커지면서 결제 환불 요청이 늘어난 상태다.',
            '긴급 서버 증설과 보상 지급이 진행 중이어서 단기 결제 지표 둔화 조건이 남아 있다.'
          ].join('\n\n'),
          paidHighlight: '업데이트 직후 서버 접속 장애 반복과 과금 환불 요청 증가 조건이 확인됐습니다.',
          openingReason: '업데이트 초기 서버 장애 및 이용자 이탈에 따른 매출 둔화가 반영됐습니다.'
        }
      ]
    }
  ],

  a_semi: [
    {
      eventKey: 'semi_ddr_contract_price',
      industry: '반도체',
      freeTitle: '글로벌 클라우드 기업 서버 교체 주기 도래… 메모리 고정거래가 협상',
      freeSummary: '북미 데이터센터 서버 발주 협의 진행… 고객사 자체 재고 소진 여부가 단가 변수',
      freeBody: [
        '글로벌 클라우드 사업자들의 서버 교체 시점이 도래하면서 국내 메모리 제조사들과의 분기 고정거래가격 협상이 진행 중이다.',
        '데이터센터용 고용량 서버 D램과 낸드플래시 수요 협의가 중심이며, 분기별 출하 단가와 물량 배정이 함께 논의되고 있다.',
        '다만 클라우드 고객사들이 자체 보유 재고 소진을 우선할 경우 신규 발주가 이월되고 단가 협상이 불리해질 수 있는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '고정거래가격 및 재고 추이',
      outcomes: [
        {
          outcomeId: 'ddr_price_rebound_win',
          isPositive: true,
          rateRange: [0.11, 0.26],
          paidPostTitle: 'A반도체, 서버용 메모리 고정거래가격 인상 협의 근접 및 재고 일수 축소',
          paidBody: [
            'A 반도체가 주요 북미 클라우드 고객사들과의 분기 협상에서 서버용 메모리 고정거래가격 인상 조건에 근접했다.',
            '출하 물량이 정상화되면서 공장 내 보유 메모리 재고 일수도 빠르게 줄어드는 추세다.',
            '고부가 서버용 제품 비중이 높아지며 분기 정산 단가가 개선되는 구조다.'
          ].join('\n\n'),
          paidHighlight: '서버용 메모리 고정거래가격 인상 협의와 보유 재고 일수 축소가 확인됐습니다.',
          openingReason: '서버용 메모리 고정거래가격 인상 타결 및 재고 정상화가 반영됐습니다.'
        },
        {
          outcomeId: 'ddr_inventory_valuation_loss',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'A반도체, 클라우드 고객사 발주 이월로 출하 단가 조정 및 재고 누적',
          paidBody: [
            '주요 클라우드 고객사들이 자체 보유 메모리 재고를 먼저 소진하기로 하면서 A 반도체에 대한 신규 서버 발주를 미뤘다.',
            '발주 이월로 분기 고정거래가격 협상에서 단가 인하 압박이 커졌고 공장 내 재고 물량도 누적되는 상태다.',
            '재고 소진이 지연될 경우 연말 재고평가손실 반영 조건이 남아 있다.'
          ].join('\n\n'),
          paidHighlight: '고객사 발주 이월과 단가 인하 압박, 공장 내 재고 누적 조건이 확인됐습니다.',
          openingReason: '고객사 발주 이월에 따른 메모리 단가 하락 및 재고평가손실이 반영됐습니다.'
        }
      ]
    }
  ],

  b_semi: [
    {
      eventKey: 'b_semi_nextgen_etcher_qual',
      industry: '반도체',
      freeTitle: '반도체 장비업계, 초미세 전공정 국산화 장비 품질(Qual) 테스트 진행',
      freeSummary: '외산 장비 대체 국산화 테스트 진입… 가혹 조건 내구성 통과와 초도 발주 시점이 변수',
      freeBody: [
        '국내 반도체 장비업계가 외산 의존도가 높았던 초미세 전공정 식각·증착 장비의 국산화 품질(Qual) 테스트를 진행하고 있다.',
        '고객사 양산 라인에 채택될 경우 기존 외산 장비 물량을 대체하는 초도 발주 품의로 이어질 수 있어 업계의 관심이 크다.',
        '다만 가혹 조건 연속 운전 테스트에서 챔버 부품 내구성 보완 요청이 나올 경우 재설계와 납품 이월이 불가피한 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '국산화 장비 퀄 테스트 현황',
      outcomes: [
        {
          outcomeId: 'qual_test_passed_mass_order',
          isPositive: true,
          rateRange: [0.12, 0.27],
          paidPostTitle: 'B반도체, 차세대 증착 장비 고객사 품질 기준 충족 및 연내 초도 발주 품의',
          paidBody: [
            'B 반도체가 개발한 차세대 원자층 증착 장비가 고객사 양산 테스트 공정의 품질 기준을 충족했다.',
            '품질 인증 마무리와 함께 고객사 내부에서 연내 초도 양산 라인 투입용 발주 품의 절차가 진행 중이다.',
            '국산화 장비의 첫 양산 납품 일정이 올해 안에 가시화된 상태다.'
          ].join('\n\n'),
          paidHighlight: '고객사 품질 기준 충족과 연내 초도 양산 발주 품의 진행이 확인됐습니다.',
          openingReason: '차세대 국산화 반도체 장비 양산 품질 테스트 통과 및 초도 수주가 반영됐습니다.'
        },
        {
          outcomeId: 'qual_test_redesign_delay',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'B반도체, 신규 장비 챔버 내구성 보완 요청으로 초도 납품 차기 연도 순연',
          paidBody: [
            'B 반도체의 국산화 신규 장비가 고객사 가혹 조건 연속 운전 테스트에서 챔버 부품 내구성 보완 요청을 받았다.',
            '이에 따라 핵심 부품 재설계와 재시험 작업에 들어가면서 초도 납품 일정이 내년 이후로 미뤄졌다.',
            '올해는 장비 수주 매출 없이 추가 시제품 개발·재설계 비용만 먼저 집행되는 조건이다.'
          ].join('\n\n'),
          paidHighlight: '챔버 내구성 보완 재설계로 초도 납품이 차기 연도로 순연되는 조건이 확인됐습니다.',
          openingReason: '신규 반도체 장비 품질 보완 재설계 비용 및 납품 지연이 반영됐습니다.'
        }
      ]
    }
  ],

  a_ship: [
    {
      eventKey: 'ship_steel_plate_heavy_tail',
      industry: '조선',
      freeTitle: '조선업계, 선박용 후판 단가 협상 및 인도 선박 잔금 정산 진행',
      freeSummary: '철강사와 후판 공급 단가 협의 중… 건조 막바지 선박 잔금 회수 일정과 충당금 여부 점검',
      freeBody: [
        '선박 건조 원가의 큰 비중을 차지하는 선박용 후판의 반기 공급 단가 협상이 철강사와 조선사 간에 진행 중이다.',
        '동시에 건조 막바지 단계에 들어선 선박들의 최종 인도 대금(헤비테일) 정산 일정도 올해 하반기에 몰려 있다.',
        '다만 원자재 가격 변동으로 철강사의 후판 인상 요구가 관철될 경우 기수주 선박에 대해 공사손실충당금을 추가 설정해야 하는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '후판 단가 협상 및 잔금 일정',
      outcomes: [
        {
          outcomeId: 'steel_drop_heavytail_inflow',
          isPositive: true,
          rateRange: [0.10, 0.23],
          paidPostTitle: 'A조선, 후판 단가 인하 방향 공감대 및 하반기 선박 인도 잔금 예정대로 회수',
          paidBody: [
            'A 조선이 주요 철강사와의 반기 협상에서 선박용 후판 공급 단가를 인하하는 방향에 공감대를 형성했다.',
            '또한 건조 막바지인 대형 선박들의 선주 검수가 순조롭게 끝나 최종 인도 잔금이 예정 일정대로 연내 회수된다.',
            '건조 원가 부담 완화와 인도 대금 유입이 같은 해에 맞물리는 일정이다.'
          ].join('\n\n'),
          paidHighlight: '후판 단가 인하 협의와 하반기 선박 인도 잔금의 정상 회수 일정이 확인됐습니다.',
          openingReason: '선박용 후판 단가 인하에 따른 원가 절감 및 인도 대금 유입이 반영됐습니다.'
        },
        {
          outcomeId: 'steel_hike_provision_loss',
          isPositive: false,
          rateRange: [-0.17, -0.06],
          paidPostTitle: 'A조선, 철강사 후판 인상 요구 강경… 기수주 선박 공사손실충당금 검토',
          paidBody: [
            '철광석 등 원자재 가격 부담을 이유로 철강사가 선박용 후판 단가 인상을 강하게 요구하고 있다.',
            '후판 단가 인상이 불가피해지면서 A 조선은 과거 저선가로 수주한 선박 물량에 대해 공사손실충당금을 추가로 쌓아야 하는 상황에 놓였다.',
            '인도 잔금이 들어오더라도 원가 상승분 충당금 반영 부담이 남아 있는 조건이다.'
          ].join('\n\n'),
          paidHighlight: '후판 단가 인상 압박에 따른 기수주 선박 공사손실충당금 설정 조건이 확인됐습니다.',
          openingReason: '후판 가격 인상에 따른 공사손실충당금 비용 반영으로 하락했습니다.'
        }
      ]
    }
  ],

  a_air: [
    {
      eventKey: 'air_route_expansion_fuel',
      industry: '항공',
      freeTitle: '항공업계, 단거리 국제선 여객 노선 증편 및 항공유 단가 점검',
      freeSummary: '해외 공연·관광 수요에 국제선 증편 검토… 노선 예약률과 항공유 헤지 계약 여부가 변수',
      freeBody: [
        '해외 공연 관람객과 단거리 여행 수요가 늘어나면서 항공사들이 주요 국제선 여객 노선 증편을 검토하고 있다.',
        '성수기 좌석 공급 확대와 함께 항공유 단가 변동에 대비한 유류비 헤지 계약 비중이 운항 손익의 핵심 요소로 꼽힌다.',
        '다만 신규 증편 노선의 초기 예약률이 손익분기점에 못 미치거나 항공유 단가가 크게 오를 경우 운항 고정비 부담이 커지는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '노선 예약률 및 유류비 현황',
      outcomes: [
        {
          outcomeId: 'air_load_factor_surge',
          isPositive: true,
          rateRange: [0.07, 0.19],
          paidPostTitle: 'A항공, 단거리 국제선 예약률 높은 수준 유지 및 항공유 사전 헤지 확보',
          paidBody: [
            '해외 공연과 단거리 여행 수요가 이어지면서 A 항공의 주력 국제선 노선 예약률이 높은 수준을 유지하고 있다.',
            '여기에 올해 소요 물량 상당 부분에 대해 사전 항공유 헤지 계약을 확보해 유류비 변동 폭을 제한해 둔 상태다.',
            '증편 노선의 좌석 소진과 원가 방어 구조가 동시에 확인됐다.'
          ].join('\n\n'),
          paidHighlight: '단거리 국제선 예약률 유지와 사전 항공유 헤지 계약 확보가 확인됐습니다.',
          openingReason: '국제선 노선 탑승률 상승과 여객 운임 수익 개선이 반영됐습니다.'
        },
        {
          outcomeId: 'air_fuel_cost_spike',
          isPositive: false,
          rateRange: [-0.16, -0.06],
          paidPostTitle: 'A항공, 신규 증편 노선 초기 예약률 저조 및 항공유 단가 상승 부담',
          paidBody: [
            'A 항공이 여객 수요 회복을 겨냥해 신규 국제선 노선을 증편했으나 일부 노선의 초기 예약률이 손익분기점을 밑돌고 있다.',
            '같은 시기 국제 항공유 단가가 오르면서 사전 헤지 비중이 낮은 구간의 운항 원가 부담이 커진 상태다.',
            '비수기 좌석 할인 프로모션까지 겹치며 노선 고정비 회수 부담이 남아 있다.'
          ].join('\n\n'),
          paidHighlight: '신규 증편 노선 초기 예약률 부진과 항공유 단가 상승 부담 조건이 확인됐습니다.',
          openingReason: '항공유 가격 상승과 신규 증편 노선 고정비 부담이 반영되어 하락했습니다.'
        }
      ]
    },
    {
      eventKey: 'air_cargo_semiconductor_freight',
      industry: '항공',
      freeTitle: '글로벌 IT·반도체 긴급 항공 화물 수송 수요와 장거리 노선 운항',
      freeSummary: '미주·유럽 노선 화물 수송 문의 증가… 전세기 계약과 기재 중정비·리스료가 변수',
      freeBody: [
        '글로벌 IT 신제품 출시와 반도체 장비 긴급 수송 수요가 겹치면서 장거리 노선 항공 화물 운임이 움직이고 있다.',
        '항공사들은 화물 전용기 편성과 장거리 여객기 하부 화물칸 적재율 확대 방안을 검토 중이다.',
        '다만 장거리 기재의 엔진 중정비 일정이 집중되거나 환율 상승으로 외화 항공기 리스료 지출이 늘어날 수 있는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '항공 화물 운임 및 정비비',
      outcomes: [
        {
          outcomeId: 'cargo_yield_boom',
          isPositive: true,
          rateRange: [0.09, 0.22],
          paidPostTitle: 'A항공, 미주·유럽 노선 IT·반도체 화물 전세기 장기 편성 계약 가동',
          paidBody: [
            'A 항공이 글로벌 IT·반도체 화주들과 미주·유럽 노선 고운임 화물 전세기 장기 편성 계약을 체결했다.',
            '하반기 전세기 가동과 함께 장거리 노선 화물 적재율과 운임 단가가 동시에 높은 수준으로 고정됐다.',
            '추가 기재 도입 없이 기존 화물기 가동률을 높이는 구조로 운항이 진행된다.'
          ].join('\n\n'),
          paidHighlight: '미주·유럽 노선 고운임 IT·반도체 화물 전세기 장기 편성 계약이 확인됐습니다.',
          openingReason: '미주·유럽 노선 고운임 IT·반도체 항공 화물 매출 급증이 반영됐습니다.'
        },
        {
          outcomeId: 'lease_maintenance_cost_surge',
          isPositive: false,
          rateRange: [-0.15, -0.05],
          paidPostTitle: 'A항공, 장거리 기재 엔진 중정비 일정 집중 및 외화 리스료 지출 확대',
          paidBody: [
            'A 항공의 주력 장거리 기재 엔진 중정비 일정이 올해 하반기에 집중 배정되면서 대규모 정비비 지출이 예정됐다.',
            '정비 기간 중 일부 기재 운항이 제한되는 데다 환율 상승으로 외화 표시 항공기 리스료 부담도 늘어난 상태다.',
            '화물 운임이 유지되더라도 정비비와 리스료 지출이 먼저 반영되는 조건이다.'
          ].join('\n\n'),
          paidHighlight: '하반기 엔진 중정비 일정 집중과 외화 항공기 리스료 증가 조건이 확인됐습니다.',
          openingReason: '항공기 엔진 중정비 비용 및 외화 리스료 부담 증가가 반영됐습니다.'
        }
      ]
    }
  ],

  a_bio: [
    {
      eventKey: 'bio_pipeline_general_a',
      industry: '바이오',
      freeTitle: '바이오 업계, 후속 면역·항암 후보물질 해외 특허 출원 및 임상 시료 준비',
      freeSummary: '후속 파이프라인 특허 심사 진행… 기술료 정산 시점과 위탁생산비 선집행 여부가 변수',
      freeBody: [
        '국내 바이오 업체들이 주력 과제 외에 후속 신약 파이프라인의 해외 물질특허 출원과 초기 임상 시료 준비를 병행하고 있다.',
        '해외 특허 등록이 완료되면 공동연구 파트너사로부터 초기 마일스톤 기술료를 수령하는 계약 구조가 일반적이다.',
        '다만 기술료 정산 없이 임상 시료 위탁생산 비용을 먼저 집행해야 하는 경우 단기 연구비 지출 부담이 커지는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '후속 파이프라인 연구 현황',
      outcomes: [
        {
          outcomeId: 'bio_a_patent_milestone',
          isPositive: true,
          rateRange: [0.08, 0.22],
          paidPostTitle: 'A바이오, 후속 파이프라인 해외 물질특허 등록 완료 및 초기 기술료 정산 일정',
          paidBody: [
            'A 바이오가 개발 중인 후속 면역·항암 후보물질의 해외 주요국 물질특허 심사 등록이 완료 단계에 들어섰다.',
            '특허 등록 조건이 충족되면서 공동연구 파트너사로부터 초기 마일스톤 기술료가 연내 정산될 예정이다.',
            '별도의 대규모 추가 설비 투자 없이 계약상 기술료가 유입되는 일정이다.'
          ].join('\n\n'),
          paidHighlight: '해외 물질특허 등록과 공동연구 초기 마일스톤 기술료의 연내 정산 일정이 확인됐습니다.',
          openingReason: '후속 신약 파이프라인 특허 등록 및 마일스톤 기술료 유입이 반영됐습니다.'
        },
        {
          outcomeId: 'bio_a_rd_cost_expand',
          isPositive: false,
          rateRange: [-0.15, -0.05],
          paidPostTitle: 'A바이오, 후속 후보물질 임상 시료 위탁생산비 선집행 구간 진입',
          paidBody: [
            'A 바이오가 차기 후보물질의 초기 임상 시료를 확보하기 위해 외부 위탁생산(CDMO) 비용을 올해 먼저 집행했다.',
            '해외 특허 심사 결과가 아직 나오지 않아 파트너사 기술료 유입은 내년 이후로 미뤄진 상태다.',
            '올해는 기술료 정산 없이 연구개발비와 시료 생산비 지출만 먼저 반영되는 조건이다.'
          ].join('\n\n'),
          paidHighlight: '기술료 유입 없이 임상 시료 위탁생산비가 선집행되는 비용 조건이 확인됐습니다.',
          openingReason: '임상 시료 생산 및 연구개발비 선집행 부담이 반영됐습니다.'
        }
      ]
    }
  ],

  b_bio: [
    {
      eventKey: 'bio_pipeline_general_b',
      industry: '바이오',
      freeTitle: '바이오 의약품 원료 위탁생산(CMO), 글로벌 제약사 품질 실사 진행',
      freeSummary: '해외 제약사 현장 품질 실사 착수… 초도 물량 선적 시점과 무균 공정 보완 여부가 변수',
      freeBody: [
        '바이오 의약품 원료 공급과 위탁생산(CMO) 시장을 두고 글로벌 제약사들의 현장 품질 실사가 이어지고 있다.',
        '현장 실사를 통과하면 상업용 초도 물량 선적 일정이 확정되며 공장 가동률 제고로 이어질 수 있다.',
        '다만 무균 공정 추가 밸리데이션 요구가 나올 경우 설비 보완 비용이 발생하고 초도 출하 일정이 이월되는 조건이 남아 있다.'
      ].join('\n\n'),
      paidTopic: '품질 실사 및 공급 일정',
      outcomes: [
        {
          outcomeId: 'bio_b_cmo_batch_approved',
          isPositive: true,
          rateRange: [0.08, 0.21],
          paidPostTitle: 'B바이오, 해외 제약사 현장 품질 실사 통과 및 하반기 초도 물량 선적 확정',
          paidBody: [
            'B 바이오의 의약품 원료 생산 라인이 글로벌 제약사의 현장 품질 실사를 추가 보완 요구 없이 마쳤다.',
            '실사 통과에 따라 하반기 상업용 초도 물량 생산과 해외 선적 일정이 공식 확정됐다.',
            '추가 설비 개조 비용 없이 기존 라인 가동을 통해 공급이 개시되는 일정이다.'
          ].join('\n\n'),
          paidHighlight: '해외 제약사 현장 품질 실사 통과와 하반기 상업용 초도 물량 선적 일정이 확인됐습니다.',
          openingReason: '바이오 원료 의약품 품질 실사 통과 및 공급 개시가 반영됐습니다.'
        },
        {
          outcomeId: 'bio_b_facility_revalidation',
          isPositive: false,
          rateRange: [-0.16, -0.05],
          paidPostTitle: 'B바이오, 무균 공정 추가 밸리데이션 요구로 초도 물량 출하 차기 연도 이월',
          paidBody: [
            'B 바이오가 글로벌 제약사 현장 품질 실사 과정에서 생산 설비의 무균 공정 추가 밸리데이션을 요구받았다.',
            '설비 보완과 재검증 절차에 들어가면서 상업용 초도 물량 출하 일정이 내년 이후로 미뤄졌다.',
            '재검증 완료 전까지 공급 대금 유입 없이 설비 보완 비용이 먼저 발생하는 조건이다.'
          ].join('\n\n'),
          paidHighlight: '무균 공정 추가 검증 요구로 인한 초도 출하 이월과 설비 보완 비용 조건이 확인됐습니다.',
          openingReason: '생산 설비 추가 검증에 따른 출하 일정 순연과 비용 부담이 반영됐습니다.'
        }
      ]
    }
  ]
};

// 한 판(9개 거래 연도) 내 동일 종목의 단년 기사가 중복되지 않도록 추가 단년 사건 템플릿 병합
for (const [stockId, extraList] of Object.entries(EXTRA_SINGLE_YEAR_TEMPLATES)) {
  if (Array.isArray(SINGLE_YEAR_TEMPLATES[stockId]) && Array.isArray(extraList)) {
    SINGLE_YEAR_TEMPLATES[stockId].push(...extraList);
  }
}

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
      freeTitle = `바이오 업계, ${variant.projectAName} 임상 1상 투여 착수`;
      freeSummary = `초기 코호트 투여 개시 확인… 담당 회사 비공개·고순도 시료 합성비와 안전성 검증 조건 상존 (${arcStageLabel})`;
      freeBody = [
        `국내 신약 개발 업종에서 글로벌 대사질환 시장을 겨냥한 ${variant.projectAName} 후보물질의 임상 1상 투여가 시작됐다. 업계에서는 다년간 이어질 대형 신약 개발 프로젝트가 본격적인 검증 구간에 들어선 것으로 보고 있다.`,
        `이번 단계에서는 초기 코호트 투여와 함께 대사질환·내분비 전문 임상 인력 충원이나 항원 원액 설비 발주 등 기업별 준비 작업이 서로 다른 방식으로 진행되고 있다. 비밀유지 조항에 따라 어느 회사가 해당 과제를 맡았는지는 공개되지 않았다.`,
        `다만 초기 임상 단계 특성상 고순도 임상 시료 합성 위탁연구비와 설비 선급금이 먼저 집행되며, 규제 당국의 기초 안전성·간 독성 보완 기준을 통과해야 다음 단계로 넘어갈 수 있는 조건이 남아 있다.`
      ].join('\n\n');

      obesityPos = true;
      obesityRate = Number(randFloat(0.08, 0.16).toFixed(3));
      obesityReason = '신규 임상 파이프라인 초기 일정 진행 및 전문 연구 인력 확충이 반영됐습니다.';

      // A바이오·B바이오 공통 중립 미리보기 문구 (숨겨진 비만 신약/백신 담당 회사가 미리보기에서 노출되지 않도록 동일하게 설정)
      const stage1SchedWhat = '신규 연구 인력·설비 투입 시점과 차기 임상·검증 데이터 집계 일정을 확인합니다.';
      const stage1RiskWhat = '초기 안전성·독성 변수와 연구개발·설비 선집행 비용 조건을 확인합니다.';

      obesityPair = createChoicePaidCluePair({
        year: y,
        stock: obesityStock,
        arcStageLabel,
        isPositive: obesityPos,
        scheduleWhatItTells: stage1SchedWhat,
        scheduleSubtitle: `${obesityStock.name}의 신규 파이프라인 착수 일정 및 차기 데이터 집계 시점 조사`,
        schedulePostTitle: `${obesityStock.name}, ${variant.recruitKeyword} 충원 완료 및 차기 개장 전 1상 초기 데이터 집계 예정`,
        scheduleBody: [
          `${obesityStock.name}가 대사질환 신약 후보물질의 임상 운영을 위해 ${variant.recruitKeyword} 충원을 마치고 초기 코호트 투여 일정을 확정했다.`,
          `올해 하반기 대상자 투여를 순차적으로 진행한 뒤, 내년 개장 전까지 1차 약동학 및 내약성 중간 데이터를 집계하는 타임라인으로 계획돼 있다.`,
          `다만 이번 일정은 초기 용량 탐색 데이터 수집까지를 목표로 하며, 후속 단계 진입 여부는 내년 집계 결과를 확인한 뒤에 결정된다.`
        ].join('\n\n'),
        scheduleHighlight: '대사질환 임상 인력 충원과 내년 개장 전 1차 임상 데이터 집계 일정이 확인됐습니다.',
        riskWhatItTells: stage1RiskWhat,
        riskSubtitle: `${obesityStock.name}의 초기 안전성 지표 및 연구·설비 비용 조건 조사`,
        riskPostTitle: `${obesityStock.name}, 초기 용량 탐색 간 독성 이상 미확인… 고순도 시료 합성 위탁비 선집행 조건`,
        riskBody: [
          `${obesityStock.name}의 초기 용량 탐색 과정에서는 간 수치 이상이나 급성 독성 반응이 보고되지 않아 당장 임상이 중단될 조건은 확인되지 않았다.`,
          `반면 임상용 고순도 시료를 외부 위탁생산으로 추가 합성해야 해 연구개발비가 상반기부터 먼저 집행되는 비용 구조다.`,
          `추가 코호트 투여에서 경미한 이상반응이 누적될 경우 용량 조정과 추가 분석 비용이 발생할 조건이 남아 있다.`
        ].join('\n\n'),
        riskHighlight: '초기 간 독성 중단 변수는 낮으나 고순도 시료 합성 위탁연구비 선집행 조건이 확인됐습니다.'
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
        schedulePostTitle: `${vaccineStock.name}, ${variant.equipKeyword} 하반기 반입… 본임상 진입은 차기 연도 이후 일정`,
        scheduleBody: [
          `${vaccineStock.name}는 신규 면역 항원 파이프라인 준비를 위해 최근 ${variant.equipKeyword}를 발주했다.`,
          `올해 하반기에 설비 반입과 공정 밸리데이션을 먼저 진행하며, 실제 본임상 대상자 투여는 내년 이후 일정으로 배정됐다.`,
          `이에 따라 올해 안에는 대외적으로 발표될 임상 데이터 집계 일정이 잡혀 있지 않다.`
        ].join('\n\n'),
        scheduleHighlight: '올해는 면역 항원 설비 반입과 공정 검증만 진행되고 임상 발표 일정은 차기 연도 이후입니다.',
        riskWhatItTells: stage1RiskWhat,
        riskSubtitle: `${vaccineStock.name}의 초기 안전성 지표 및 연구·설비 비용 조건 조사`,
        riskPostTitle: `${vaccineStock.name}, 항원 정제 설비 선급금 일시 지출 및 기초 안전성 보완 시험 조건`,
        riskBody: [
          `${vaccineStock.name}가 신규 면역 항원 라인 구축을 위해 설비 선급금을 일시에 지출하면서 초기 자금 집행 규모가 커졌다.`,
          `여기에 규제 기관의 기초 안전성 자료 보완 기준이 강화돼 추가 전임상 시험 항목이 늘어났다.`,
          `보완 시험 결과가 기준을 충족하지 못하면 설비 가동 시점이 더 미뤄지고 초기 시험 예산 초과 부담이 커질 수 있는 조건이다.`
        ].join('\n\n'),
        riskHighlight: '설비 선급금 일시 지출과 기초 안전성 보완 시험 비용 초과 조건이 확인됐습니다.'
      });
    } else if (step === 1 && !isLast) {
      const midObesityPos = true;
      const midVaccinePos = false;

      freeTitle = `${variant.projectAName}, 국제 학회 중간 분석 발표 일정 확정`;
      freeSummary = `중간 데이터 발표 시점 확정… 투여군별 유효성 편차와 보관 안정성 재시험 조건 상존 (${arcStageLabel})`;
      freeBody = [
        `국내 바이오 업종에서 진행 중인 ${variant.projectAName} 임상의 중간 분석 결과가 올해 하반기 국제 학회에서 공개될 예정이다. 초기 단계를 지나 본격적인 중간 검증 구간에 들어선 것이다.`,
        `업계에 따르면 일부 고용량 투여군에서는 주요 지표 개선이 관측됐으나, 비밀유지 조항으로 담당 회사는 여전히 비공개다. 같은 업종 내 다른 항원 파이프라인에서는 장기 보관 안정성 자료 추가 수집이 진행 중인 것으로 파악됐다.`,
        `학회 발표 이후 후속 단계로 넘어가려면 저용량군 유효성 편차와 중도 이탈률, 그리고 유통 온도 변화에 따른 역가 유지 기준을 모두 통과해야 하는 조건이 남아 있다.`
      ].join('\n\n');

      const stage2SchedWhat = '중간 데이터·공정 검증 완료 시점과 후속 단계 진입 및 협약 일정을 확인합니다.';
      const stage2RiskWhat = '참여군 중도 이탈·품질 편차 가능성과 프로토콜 재설계·재시험 비용 조건을 확인합니다.';

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
        schedulePostTitle: `${obesityStock.name}, 하반기 국제 학회 중간 데이터 발표 및 연내 후속 임상 투여 개시 예정`,
        scheduleBody: [
          `${obesityStock.name}가 대사질환 파이프라인의 고용량 코호트 중간 분석 결과를 올해 하반기 국제 학회에서 발표하기로 일정을 확정했다.`,
          `학회 발표 직후 별도의 장기 공백 없이 연내에 다음 단계 임상 환자 투여를 시작하는 타임라인이 잡혀 있다.`,
          `다만 후속 투여가 예정대로 진행되더라도 최종 통계 판정까지는 추가 추적 기간이 필요하다.`
        ].join('\n\n'),
        scheduleHighlight: '하반기 학회 중간 데이터 발표와 연내 후속 임상 진입 일정이 확인됐습니다.',
        riskWhatItTells: stage2RiskWhat,
        riskSubtitle: `${obesityStock.name}의 파이프라인 유효성·품질 편차 및 추가 비용 조건 조사`,
        riskPostTitle: `${obesityStock.name}, 저용량 투여군 유효성 편차 및 위장관 이상반응 이탈에 따른 용량 재설계 조건`,
        riskBody: [
          `${obesityStock.name}의 중간 분석에서는 고용량군과 달리 저용량 투여 집단에서 유효성 편차가 크고 위장관 이상반응에 따른 중도 이탈 사례가 보고됐다.`,
          `이탈률이 허용 범위를 넘을 경우 투여 용량 조절을 위한 임상 프로토콜 보완과 추가 안전성 검증이 요구된다.`,
          `프로토콜 재설계가 필요해지면 위탁연구 비용이 늘어나고 다음 단계 심사 자료 제출이 지연될 수 있는 조건이다.`
        ].join('\n\n'),
        riskHighlight: '저용량군 유효성 편차와 위장관 이상반응 이탈 시 프로토콜 보완 비용 조건이 확인됐습니다.'
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
        scheduleBody: [
          `${vaccineStock.name}의 면역 항원 파이프라인이 규제 당국으로부터 장기 보관 기간의 추가 데이터 수집 일정을 부여받았다.`,
          `이에 따라 올해 안에 예정했던 품목 허가 신청은 진행하지 못하고 차기 연도 이후로 일정이 미뤄졌다.`,
          `추가 보관 시험 데이터가 완결돼야 다음 심의 일정을 다시 잡을 수 있는 상태다.`
        ].join('\n\n'),
        scheduleHighlight: '장기 보관 데이터 추가 수집으로 인해 올해 허가 신청 일정이 차기 연도로 순연됐습니다.',
        riskWhatItTells: stage2RiskWhat,
        riskSubtitle: `${vaccineStock.name}의 파이프라인 유효성·품질 편차 및 추가 비용 조건 조사`,
        riskPostTitle: `${vaccineStock.name}, 유통 온도 변화 시험 역가 저하 우려… 안정제 제형 변경 비용 조건`,
        riskBody: [
          `${vaccineStock.name}가 생산한 항원 시료가 상온 노출 안정성 시험에서 역가 저하 가능성을 보였다.`,
          `품질 기준을 맞추려면 콜드체인 안정제 조성을 재설계하고 재시험을 처음부터 다시 수행해야 한다.`,
          `제형 변경에 따른 추가 시료 생산비와 검증 비용이 회수 시점 없이 먼저 투입되는 조건이 남아 있다.`
        ].join('\n\n'),
        riskHighlight: '유통 온도 변화에 따른 역가 저하 우려로 제형 재설계 및 재시험 비용 조건이 확인됐습니다.'
      });
    } else if (!isLast) {
      const midObesityPos = (step % 2 === 1) ? true : obesityFinalSuccess;
      const midVaccinePos = (step % 2 === 0) ? true : vaccineFinalSuccess;
      const extraStageTpl = EXTRA_ARC_MIDDLE_STAGES.bio[step - 2] || null;

      if (extraStageTpl) {
        freeTitle = extraStageTpl.freeTitle;
        freeSummary = `${extraStageTpl.freeSummary} (${arcStageLabel})`;
        freeBody = extraStageTpl.freeBody;

        obesityPos = midObesityPos;
        obesityRate = midObesityPos
          ? Number(randFloat(0.05, 0.13).toFixed(3))
          : Number(randFloat(-0.11, -0.04).toFixed(3));
        obesityReason = midObesityPos ? extraStageTpl.obesityReasonPos : extraStageTpl.obesityReasonNeg;

        obesityPair = createSingleArcPaidClue({
          year: y,
          stock: obesityStock,
          arcStageLabel,
          isPositive: obesityPos,
          topic: extraStageTpl.obesityTopic,
          subtitle: extraStageTpl.obesitySubtitle(obesityStock.name),
          postTitle: midObesityPos
            ? extraStageTpl.obesityPostTitlePos(obesityStock.name)
            : extraStageTpl.obesityPostTitleNeg(obesityStock.name),
          body: midObesityPos
            ? extraStageTpl.obesityBodyPos(obesityStock.name)
            : extraStageTpl.obesityBodyNeg(obesityStock.name),
          highlightNote: midObesityPos
            ? extraStageTpl.obesityHighlightPos
            : extraStageTpl.obesityHighlightNeg
        });

        vaccinePos = midVaccinePos;
        vaccineRate = midVaccinePos
          ? Number(randFloat(0.05, 0.13).toFixed(3))
          : Number(randFloat(-0.10, -0.04).toFixed(3));
        vaccineReason = midVaccinePos ? extraStageTpl.vaccineReasonPos : extraStageTpl.vaccineReasonNeg;

        vaccinePair = createSingleArcPaidClue({
          year: y,
          stock: vaccineStock,
          arcStageLabel,
          isPositive: vaccinePos,
          topic: extraStageTpl.vaccineTopic,
          subtitle: extraStageTpl.vaccineSubtitle(vaccineStock.name),
          postTitle: midVaccinePos
            ? extraStageTpl.vaccinePostTitlePos(vaccineStock.name)
            : extraStageTpl.vaccinePostTitleNeg(vaccineStock.name),
          body: midVaccinePos
            ? extraStageTpl.vaccineBodyPos(vaccineStock.name)
            : extraStageTpl.vaccineBodyNeg(vaccineStock.name),
          highlightNote: midVaccinePos
            ? extraStageTpl.vaccineHighlightPos
            : extraStageTpl.vaccineHighlightNeg
        });
      } else {
        freeTitle = `바이오 장기 파이프라인, 다국가 임상 사이트 확대 및 상업 공정 실사 진행`;
        freeSummary = `다국가 환자 모집 진척도와 원액 배양 공정 검증 현황 점검 (${arcStageLabel})`;
        freeBody = [
          `국내 바이오 업계에서 수년간 이어진 신약 및 항원 프로젝트들이 다국가 임상 사이트 확대와 상업용 원액 생산 실사 구간에 진입했다.`,
          `해외 임상 기관을 통한 환자 모집 속도와 연속 배치 배양 수율이 올해 핵심 점검 지표로 확인됐으며, 담당 회사명은 여전히 비공개로 유지되고 있다.`,
          `사이트 추가 개설에 따른 위탁연구기관(CRO) 수수료나 무균 충전 라인 추가 검증 요구가 발생할 경우 비용과 일정에 부담이 생길 수 있는 조건이다.`
        ].join('\n\n');

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
            ? `${obesityStock.name}, 다국가 대사질환 임상 목표 모집률 달성 및 단계별 마일스톤 수령`
            : `${obesityStock.name}, 해외 임상 사이트 추가 개설 및 위탁연구기관(CRO) 수수료 지출 확대`,
          body: midObesityPos
            ? [
                `${obesityStock.name}가 해외 다국가 임상 사이트에서 대사질환 환자 목표 모집률을 예정보다 앞서 채웠다.`,
                `모집 마일스톤 달성 조건이 충족되면서 공동연구 파트너사로부터 단계별 연구 기술료가 연내 정산된다.`,
                `다만 최종 유효성 통계 분석은 전체 투여 추적 기간이 끝난 뒤 별도로 진행된다.`
              ].join('\n\n')
            : [
                `${obesityStock.name}가 다국가 대사질환 임상의 환자 모집 속도를 유지하기 위해 해외 위탁연구기관(CRO) 사이트를 추가 개설했다.`,
                `임상 사이트 확대에 따른 운영 수수료와 모니터링 비용이 올해 집중적으로 집행되는 구조다.`,
                `별도의 마일스톤 기술료 유입 없이 연구개발비 지출만 먼저 반영되는 조건이 이어지고 있다.`
              ].join('\n\n'),
          highlightNote: midObesityPos
            ? '다국가 대사질환 임상 모집 목표 달성과 단계별 기술료 정산 조건이 확인됐습니다.'
            : '해외 임상 사이트 추가 개설에 따른 위탁연구비 선집행 조건이 확인됐습니다.'
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
            ? `${vaccineStock.name}, 상업용 항원 원액 연속 배양 수율 확보 및 해외 조달 중간 실사 통과`
            : `${vaccineStock.name}, 항원 원액 무균 충전 라인 추가 밸리데이션 요구로 생산 순연`,
          body: midVaccinePos
            ? [
                `${vaccineStock.name}가 상업용 스케일의 항원 원액 연속 배치 배양에서 균일한 수율 지표를 확보했다.`,
                `이에 따라 해외 공공조달 기관의 중간 공정 실사를 통과해 본허가 심사 준비 단계로 넘어갔다.`,
                `최종 품목 허가와 장기 공급 계약은 후속 최종 심의 절차를 거쳐야 확정된다.`
              ].join('\n\n')
            : [
                `${vaccineStock.name}의 항원 원액 충전 라인에서 무균 공정 추가 밸리데이션 요구가 통보됐다.`,
                `설비 보완과 재검증이 끝날 때까지 상업용 시료 생산 일정이 내년 이후로 미뤄졌다.`,
                `라인 가동 지연 기간 동안 설비 유지비와 재검증 비용이 추가로 발생하는 조건이다.`
              ].join('\n\n'),
          highlightNote: midVaccinePos
            ? '상업용 항원 원액 연속 배양 수율 확보와 중간 공정 실사 통과가 확인됐습니다.'
            : '무균 충전 라인 추가 검증에 따른 생산 일정 지연과 보완 비용 조건이 확인됐습니다.'
        });
      }
    } else {
      freeTitle = `${variant.projectAName} 최종 데이터 잠금 및 ${variant.projectBName} 최종 심의 개시`;
      freeSummary = `${durationYears}년 바이오 장기 과제의 최종 판정 일정과 막바지 유효성·실사 조건 점검 (${durationYears}/${durationYears} 최종 단계)`;
      freeBody = [
        `수년간 이어진 ${variant.projectAName} 임상이 전체 투여 추적을 마치고 데이터 잠금(Data Lock)과 최종 통계 분석 단계에 들어섰다. 동시에 ${variant.projectBName}의 해외 공급 관련 최종 품목 허가 심의도 개시됐다.`,
        `두 과제 모두 내년 개장 직전에 최종 판정과 글로벌 본계약 결론이 일괄 공개되는 일정이다. 다만 비밀유지 조항에 따라 각 과제의 담당 회사는 아직 공식 발표되지 않았다.`,
        `최종 통계에서 기저 질환이 없는 참여군까지 유의성을 확보할지, 그리고 원액 불순물 현장 실사를 통과할지가 본계약 성사 여부를 가르는 마지막 조건으로 남아 있다.`
      ].join('\n\n');

      const finalSchedWhat = '최종 데이터 잠금·심의위원회 일정과 내년 개장 전 본계약·승인 결론 시점을 확인합니다.';
      const finalRiskWhat = '막바지 통계 유의성·현장 실사 미달 가능성과 본계약 협상 중단 조건을 확인합니다.';

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
        schedulePostTitle: `${obesityStock.name}, 대사질환 최종 임상 데이터 잠금 완료… 내년 개장 전 탑라인 발표 예정`,
        scheduleBody: [
          `${obesityStock.name}가 대사질환 파이프라인 최종 임상 참여자의 투여 추적을 마치고 데이터 잠금(Data Lock) 절차에 들어갔다.`,
          `최종 통계 판정 결과와 글로벌 제약사와의 기술이전 본계약 체결 여부는 내년 개장 직전에 함께 발표될 예정이다.`,
          `현재는 최종 통계 검증만 남은 단계로, 올해 안에 중간 수치나 계약 결론이 선공개되지는 않는다.`
        ].join('\n\n'),
        scheduleHighlight: '데이터 잠금이 완료되어 내년 개장 직전에 최종 임상 결과와 기술이전 여부가 공개되는 일정입니다.',
        riskWhatItTells: finalRiskWhat,
        riskSubtitle: `${obesityStock.name}의 최종 유효성·품질 기준 미달 및 협상 중단 조건 조사`,
        riskPostTitle: `${obesityStock.name}, 일반 참여군 위약 대비 효과 격차 미달 시 기술이전 협상 중단 조건`,
        riskBody: [
          `${obesityStock.name}의 최종 통계 판정에서는 일부 고용량 집단뿐 아니라 기저 대사질환이 없는 일반 참여군에서도 통계적 유의성을 충족해야 한다.`,
          `글로벌 파트너사와 논의 중인 기술이전 본계약에는 전체 참여자 기준 목표 효과 달성이 선행 조건으로 걸려 있다.`,
          `전체 집단 기준을 충족하지 못할 경우 진행 중인 기술이전 협상이 중단되고 연구개발비 회수가 지연될 조건이 남아 있다.`
        ].join('\n\n'),
        riskHighlight: '전체 참여자 기준 목표 효과 미달 시 글로벌 기술이전 협상이 중단되는 선행 조건이 확인됐습니다.'
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
        schedulePostTitle: `${vaccineStock.name}, 하반기 항원 품목 허가 최종 심의위원회 개최… 내년 개장 전 공급 계약 결론`,
        scheduleBody: [
          `${vaccineStock.name}가 진행 중인 면역 항원 파이프라인의 최종 품목 허가 심의위원회가 올해 하반기에 열린다.`,
          `심의 결과와 연동된 해외 공공조달 장기 공급 본계약 체결 여부는 내년 개장 직전에 최종 결론이 통보된다.`,
          `허가 심의 일정이 확정되면서 수년간 이어진 프로젝트의 최종 판정 시점이 내년 개장으로 좁혀졌다.`
        ].join('\n\n'),
        scheduleHighlight: '하반기 최종 품목 허가 심의를 거쳐 내년 개장 직전에 해외 공급 본계약 여부가 결정되는 일정입니다.',
        riskWhatItTells: finalRiskWhat,
        riskSubtitle: `${vaccineStock.name}의 최종 유효성·품질 기준 미달 및 협상 중단 조건 조사`,
        riskPostTitle: `${vaccineStock.name}, 원액 미량 불순물 현장 실사 재검증 판정 시 해외 공급 계약 중단 조건`,
        riskBody: [
          `${vaccineStock.name}의 항원 원액 정제 공정에서 해외 규제기관의 미량 불순물 허용 기준 충족 여부가 최종 현장 실사의 핵심 쟁점으로 남아 있다.`,
          `해외 조달기관과의 장기 공급 계약은 현장 실사 무결점 통과를 전제로 조건부 협의가 진행 중이다.`,
          `최종 실사에서 품질 재검증 판정을 받으면 해외 공급 본계약이 무산되고 증설 설비의 고정비 부담이 남게 되는 조건이다.`
        ].join('\n\n'),
        riskHighlight: '최종 현장 실사에서 원액 불순물 기준 재검증 판정을 받으면 해외 공급 계약이 중단되는 조건이 확인됐습니다.'
      });
    }

    // 플레이 피드백: 기사 본문 보강 (단계별 구체 사실 1문장 추가)
    if (!(step >= 3 && !isLast && EXTRA_ARC_MIDDLE_STAGES.bio[step - 2])) {
      const bioStageType = getArcStageType(step, durationYears);
      freeBody = extendArcFreeBody('bio', bioStageType, freeBody);
      extendArcPaidList('bio', 'obesity', bioStageType, obesityPos, obesityPair);
      extendArcPaidList('bio', 'vaccine', bioStageType, vaccinePos, vaccinePair);
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
    clientRegion: '북미·아시아 글로벌 해운사',
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
      fTitle = `${variant.clientRegion}, ${variant.vesselType} 장기 발주 협상 착수`;
      fSum = `국내 조선소와 ${variant.fleetScale} 기본 의향 협의 개시… 선수금 보증과 원가 연동 조건은 미확정 (${arcStageLabel})`;
      fBody = [
        `${variant.clientRegion}가 노후 선대 교체를 위해 국내 조선업체와 ${variant.vesselType} ${variant.fleetScale} 건조 협상에 착수했다. 수년에 걸친 대형 프로젝트 규모로 업계 안팎의 관심이 모이고 있다.`,
        `현재 양측은 초기 설계 기준을 담은 기본 의향서(LOI) 교환을 논의 중이며, 친환경 엔진 사양 검토와 도크 건조 슬롯 배정은 내년 이후 단계별로 진행하는 일정이 거론된다.`,
        `다만 아직 구속력 있는 본계약 단계가 아니며, 대규모 발주에 필요한 선수금 환급보증(RG) 한도 확보와 철강 후판 원가 연동 조항은 해결되지 않은 채 조건 협의가 남아 있다.`
      ].join('\n\n');

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
        schedulePostTitle: `A조선, ${variant.clientRegion}와 기본 의향서(LOI) 교환… 내년부터 기술 심사·보증 협의 일정`,
        scheduleBody: [
          `A 조선이 ${variant.clientRegion}와 ${variant.vesselType} ${variant.fleetScale} 건조를 위한 기본 의향서(LOI)를 교환했다.`,
          `올해는 선형과 초기 설계 기준을 먼저 확정하는 단계이며, 친환경 엔진 기술 심사와 금융 보증(RG) 협의는 내년으로 일정이 배정됐다.`,
          `본계약 서명과 선박 인도, 대금 정산은 후속 심사가 끝난 뒤 수년에 걸쳐 단계적으로 진행되는 일정이다.`
        ].join('\n\n'),
        scheduleHighlight: '올해 기본 의향서 교환 후 내년부터 기술 심사와 금융 보증 협의가 이어지는 일정입니다.',
        riskWhatItTells: '도크 슬롯 경합, 초기 후판 원가 연동 조항, 경쟁 조선소 저가 입찰 조건을 확인합니다.',
        riskSubtitle: `A조선의 초기 선가 조건 및 원가 연동 리스크 조사`,
        riskPostTitle: `A조선, 후판 원가 연동 조항 협의 포함… 해외 경쟁사 저가 입찰 및 보증 한도 변수`,
        riskBody: [
          `A 조선은 이번 의향서 협의에서 후판 가격 변동 시 선가를 일부 조정하는 원가 연동(에스컬레이션) 조항을 기본안에 포함해 초기 원가 훼손 변수를 줄였다.`,
          `그러나 해외 경쟁 조선소들이 단가 인하를 앞세워 동일 선대 입찰에 참여하면서 최종 선가 방어 부담이 남아 있다.`,
          `대형 선대 특성상 본계약 전까지 추가 보증기관 확보와 도크 슬롯 중복 조정 조건을 풀지 못하면 협상이 지연될 수 있다.`
        ].join('\n\n'),
        riskHighlight: '후판 원가 연동 조항은 포함됐으나 경쟁사 저가 입찰과 보증 한도 확보 조건이 남아 있습니다.'
      });
    } else if (step === 1 && !isLast) {
      isPos = true;
      fTitle = `${variant.clientRegion} 장기 발주 협상, 친환경 설계 검증 및 금융 보증(RG) 심의 진입`;
      fSum = `기술 사양 심사와 선수금 환급보증 발급 시점·한도 확보 여부가 핵심 조건 (${arcStageLabel})`;
      fBody = [
        `${variant.clientRegion}와 진행 중인 ${variant.vesselType} 장기 수주 협상이 초기 의향 단계를 넘어 친환경 엔진 기술 사양 검증과 금융 보증(RG) 조율 단계로 진입했다.`,
        `선주 측 기술팀의 사양 점검은 순차적으로 진행되고 있으며, 금융 보증 심사 결과가 하반기에 나온 뒤 본계약 일정을 잡는 타임라인이 논의되고 있다.`,
        `다만 기존 선수금 보증 한도가 발주 규모에 비해 부족해 추가 보증기관을 확보하지 못하거나 후판 원가 반영 비율 이견이 남을 경우 협상이 멈출 수 있는 조건이 남아 있다.`
      ].join('\n\n');

      rate = Number(randFloat(0.04, 0.12).toFixed(3));
      reason = '해외 선사 장기 수주 협상 기술 심사 및 보증 한도 협의 진전이 반영됐습니다.';

      paidPair = createChoicePaidCluePair({
        year: y,
        stock: shipStock,
        arcStageLabel,
        isPositive: isPos,
        scheduleWhatItTells: '금융 보증(RG) 심사 결과 발표 시점과 본계약 서명 목표 일정을 확인합니다.',
        scheduleSubtitle: `A조선의 금융 보증 심사 및 본계약 체결 목표 일정 조사`,
        schedulePostTitle: `A조선, 하반기 금융 보증 심사 결과 통보 후 본계약 일정 수립 예정`,
        scheduleBody: [
          `A 조선은 ${variant.clientRegion}와의 대형 선대 협상에서 금융 보증(RG) 심사 결과가 올해 하반기에 나온 뒤 본계약 서명 일정을 잡기로 했다.`,
          `협상 중인 발주 규모가 기존 연간 수주액과 맞먹는 대형 패키지여서 본계약 체결 이후에도 선박 인도와 대금 정산은 수년에 걸쳐 단계별로 이뤄진다.`,
          `올해 안에는 보증 심사 완료와 최종 조건안 정리까지가 목표이며, 실제 선수금 입금은 본계약 서명 이후로 예정돼 있다.`
        ].join('\n\n'),
        scheduleHighlight: '하반기 금융 보증 심사 결과 통보 이후 본계약 일정을 잡는 단계별 타임라인이 확인됐습니다.',
        riskWhatItTells: '선수금 환급보증(RG) 한도 부족 위험, 후판 원가 반영 이견 및 협상 중단 조건을 확인합니다.',
        riskSubtitle: `A조선의 선수금 보증 한도 및 협상 중단 조건 조사`,
        riskPostTitle: `A조선, 기존 선수금 보증 한도 부족… 추가 보증기관 미확보 시 협상 중단 조건`,
        riskBody: [
          `A 조선의 기존 금융권 선수금 환급보증(RG) 한도가 이번 대형 발주 규모를 모두 감당하기에는 부족한 것으로 확인됐다.`,
          `추가 보증기관을 확보하지 못하면 기술 심사를 통과하더라도 본계약 서명으로 넘어가지 못하고 협상이 멈출 수 있다.`,
          `여기에 친환경 엔진 기자재와 후판 원가 변동분 반영 비율을 두고 선주 측과의 선가 이견도 남아 있어 조건 조율이 필요한 상태다.`
        ].join('\n\n'),
        riskHighlight: '선수금 보증 한도가 부족해 추가 보증기관을 확보하지 못하면 협상이 멈출 수 있는 조건이 확인됐습니다.'
      });
    } else if (!isLast) {
      isPos = (step % 2 === 1) ? true : (finalMode !== 'breakdown');
      const extraShipTpl = EXTRA_ARC_MIDDLE_STAGES.ship[step - 2] || null;

      if (extraShipTpl) {
        fTitle = extraShipTpl.freeTitle(variant);
        fSum = extraShipTpl.freeSummary(arcStageLabel);
        fBody = extraShipTpl.freeBody(variant);

        rate = isPos
          ? Number(randFloat(0.04, 0.11).toFixed(3))
          : Number(randFloat(-0.09, -0.04).toFixed(3));
        reason = isPos ? extraShipTpl.reasonPos : extraShipTpl.reasonNeg;

        paidPair = createSingleArcPaidClue({
          year: y,
          stock: shipStock,
          arcStageLabel,
          isPositive: isPos,
          topic: extraShipTpl.topic,
          subtitle: extraShipTpl.subtitle(variant),
          postTitle: isPos ? extraShipTpl.postTitlePos : extraShipTpl.postTitleNeg,
          body: isPos ? extraShipTpl.bodyPos(variant) : extraShipTpl.bodyNeg(variant),
          highlightNote: isPos ? extraShipTpl.highlightPos : extraShipTpl.highlightNeg
        });
      } else {
        fTitle = `${variant.clientRegion} 장기 선대 협상, 연료 탱크 상세 설계 및 도크 슬롯 조율`;
        fSum = `국제 선급 상세 설계 승인과 핵심 기자재 납기 조율 현황 점검 (${arcStageLabel})`;
        fBody = [
          `장기 협상이 이어지고 있는 ${variant.vesselType} 프로젝트가 친환경 연료 저장탱크 상세 설계와 연도별 도크 건조 슬롯 배정 구간에 들어섰다.`,
          `선급 기관의 설계 검토와 함께 전용 건조 도크 확보 작업이 병행되고 있으며, 주요 엔진 밸브와 보냉재 협력사의 납기 일정도 함께 점검되고 있다.`,
          `핵심 기자재 납기 병목이 생기면 선박 인도 슬롯 순서를 다시 조율해야 하는 조건이 남아 있어 본계약 전 공정 안정성 확인이 요구된다.`
        ].join('\n\n');

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
            ? `A조선, 친환경 연료 저장탱크 선급 승인 완료 및 전용 도크 슬롯 배정`
            : `A조선, 핵심 엔진 기자재 납기 지연으로 선박 인도 슬롯 재조정 협의`,
          body: isPos
            ? [
                `A 조선이 ${variant.vesselType}의 친환경 연료 저장탱크 상세 설계에 대해 국제 선급 기관의 승인을 마쳤다.`,
                `설계 승인과 함께 연속 건조를 위한 전용 도크 슬롯 배정도 마무리돼 건조 준비 공정이 계획대로 정리됐다.`,
                `다만 최종 본계약 체결 여부는 선주 측 이사회 승인과 금융 보증 최종 확정을 거쳐 결정된다.`
              ].join('\n\n')
            : [
                `친환경 엔진에 들어가는 핵심 밸브와 보냉재 납기가 길어지면서 A 조선의 건조 공정 일정 조정이 불가피해졌다.`,
                `A 조선은 선주 측과 선박 인도 슬롯 순서를 다시 조율하고 있으며, 일부 공정 대기 비용이 추가로 발생하고 있다.`,
                `기자재 납기 정상화와 추가 원가 분담 합의가 남아 있는 조건이다.`
              ].join('\n\n'),
          highlightNote: isPos
            ? '상세 설계 선급 승인과 전용 도크 슬롯 배정 완료가 확인됐습니다.'
            : '기자재 납기 병목에 따른 인도 슬롯 재조정과 공정 대기 비용 조건이 확인됐습니다.'
        });
      }
    } else {
      fTitle = `${variant.clientRegion} ${variant.vesselType} 장기 공급안, 선주 연말 이사회 상정`;
      fSum = `${durationYears}년 장기 협상의 최종 이사회 의결 시점과 막바지 선가·보증 조건 점검 (${durationYears}/${durationYears} 최종 단계)`;
      fBody = [
        `수년간 협상을 거듭해 온 ${variant.clientRegion}의 ${variant.vesselType} ${variant.fleetScale} 발주 최종 조건안이 선주 측 연말 이사회에 상정된다.`,
        `이사회 승인 여부와 1차 선수금 입금 일정은 내년 개장 직전에 최종 확정되어 공개될 예정이다. 장기간 이어진 협상의 최종 판정 시점이 코앞으로 다가왔다.`,
        `다만 막바지 옵션 물량의 선가 조정 요구와 대규모 선수금 환급보증(RG) 최종 한도 합의가 끝나지 않았으며, 협상이 결렬될 경우 비워둔 도크 슬롯의 고정비 부담이 남는 조건이다.`
      ].join('\n\n');

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
        schedulePostTitle: `A조선, 연말 선주 이사회 상정… 내년 개장 전 본계약 결론 및 선수금 일정 확정`,
        scheduleBody: [
          `A 조선과 ${variant.clientRegion}가 ${variant.fleetScale} 건조 협상의 최종 조건안을 선주 측 연말 이사회에 상정하기로 합의했다.`,
          `이사회 의결 결과와 1차 선수금 입금 일정은 내년 개장 직전에 일괄 확정되어 대외적으로 발표된다.`,
          `올해 안에는 이사회 상정 자료 확정까지만 진행되며, 최종 계약 서명 여부는 내년 개장 시점에 공개된다.`
        ].join('\n\n'),
        scheduleHighlight: '연말 선주 이사회 상정을 거쳐 내년 개장 직전에 최종 본계약 결론이 공개되는 일정입니다.',
        riskWhatItTells: '최종 선가 이견, 옵션 물량 취소 가능성, 협상 결렬 시 도크 공백 조건을 확인합니다.',
        riskSubtitle: `A조선의 막바지 선가 협상 및 도크 공백 조건 조사`,
        riskPostTitle: `A조선, 막바지 옵션 선가·보증 한도 이견… 결렬 시 도크 공백 고정비 부담 조건`,
        riskBody: [
          `최종 계약안을 앞두고 선주 측의 옵션 물량 선가 조정 요구와 대규모 선수금 환급보증(RG) 최종 한도 조건이 마지막 쟁점으로 남아 있다.`,
          `A 조선은 대형 선대 연속 건조를 위해 주요 도크 슬롯을 장기간 비워 둔 상태로 협상을 진행해 왔다.`,
          `막바지 조건 이견을 좁히지 못해 협상이 결렬되면 대체 수주를 즉시 채우기 어려워 비워둔 도크의 고정비 손실이 발생하는 조건이다.`
        ].join('\n\n'),
        riskHighlight: '막바지 선가·보증 이견으로 협상이 결렬될 경우 비워둔 도크 슬롯의 고정비 부담 조건이 확인됐습니다.'
      });
    }

    // 플레이 피드백: 기사 본문 보강 (단계별 구체 사실 1문장 추가)
    if (!(step >= 3 && !isLast && EXTRA_ARC_MIDDLE_STAGES.ship[step - 2])) {
      const shipStageType = getArcStageType(step, durationYears);
      fBody = extendArcFreeBody('ship', shipStageType, fBody);
      extendArcPaidList('ship', 'a_ship', shipStageType, isPos, paidPair);
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
      fSum = `클린룸 기초 공사 개시… 양산 출하는 차기 연도 이후이며 장비 발주와 선급금 집행 시차 발생 (${arcStageLabel})`;
      fBody = [
        `국내 메모리 제조사가 차세대 데이터센터 수요에 대응하기 위해 ${variant.fabName} 대규모 증설 공사에 착수했다. 반도체 전공정 장비 협력사들도 초도 공급 물량 준비에 들어갔다.`,
        `다만 올해는 클린룸 기초 골조와 유틸리티 공사 단계여서 실제 웨이퍼 양산 출하는 차기 연도 이후로 잡혀 있다. 반면 증설 라인에 투입될 ${variant.equipType}의 1차 발주와 납품 계약은 올해 하반기부터 먼저 진행된다.`,
        `초기 설비 투자비(CAPEX) 선급금이 먼저 집행되는 제조사와 1차 장비 반입·대금 정산이 앞서는 장비사 사이에 실적 반영 시차가 존재하며, 외화 결제 부품 원가와 납기 조건도 변수로 남아 있다.`
      ].join('\n\n');

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
        schedulePostTitle: `A반도체, 올해 클린룸 기초 골조 공사 진행… 웨이퍼 양산 출하는 차기 연도 이후`,
        scheduleBody: [
          `A 반도체가 ${variant.fabName}의 기초 골조와 클린룸 유틸리티 공사에 착수했다.`,
          `핵심 전공정 장비 반입과 상업용 웨이퍼 양산 출하 일정은 모두 내년 이후로 배정돼 있어 올해 안에는 신규 라인 매출 발생 일정이 없다.`,
          `올해 일정은 기반 시설 완공과 장비 반입 준비까지만 예정돼 있으며, 시제품 테스트는 다음 해에 시작된다.`
        ].join('\n\n'),
        scheduleHighlight: '장비 반입과 실제 웨이퍼 양산 출하 일정이 모두 차기 연도 이후로 잡혀 있습니다.',
        riskWhatItTells: '대규모 초기 설비 투자비(CAPEX) 선집행과 단기 감가상각·현금흐름 부담 조건을 확인합니다.',
        riskSubtitle: `A반도체의 초기 설비 투자비 부담 및 자금 집행 조건 조사`,
        riskPostTitle: `A반도체, 클린룸 착공 설비 선급금 일시 집행… 라인 가동 전 고정비 부담 구조`,
        riskBody: [
          `A 반도체가 신규 팹 인프라 구축을 위해 당초 계획보다 큰 규모의 초기 설비 투자비를 일시에 선집행하고 있다.`,
          `신규 라인이 실제 웨이퍼를 출하하기 전까지 대규모 설비 자금 유출과 고정비 지출이 먼저 회계에 반영되는 구조다.`,
          `공사 일정이 지연될 경우 자금 회수 시점이 더 늦어져 현금흐름 압박이 커질 조건이 남아 있다.`
        ].join('\n\n'),
        riskHighlight: '초기 설비 투자비 일시 선집행으로 라인 가동 전 고정비와 현금흐름 부담 조건이 확인됐습니다.'
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
        schedulePostTitle: `B반도체, ${variant.equipType} 공급 계약 체결… 내년 개장 전 1차 납품 정산 일정`,
        scheduleBody: [
          `B 반도체가 국내 메모리 증설 라인에 투입될 ${variant.equipType} 초도 물량 공급 계약을 체결했다.`,
          `올해 하반기부터 첫 장비 반입을 시작해 내년 개장 전까지 1차 납품 대금 정산이 완료되는 일정으로 계약됐다.`,
          `제조사의 양산 시점보다 앞서 장비 인도 대금이 먼저 회수되는 타임라인이다.`
        ].join('\n\n'),
        scheduleHighlight: '내년 개장 전까지 1차 전공정 장비 납품과 대금 정산이 완료되는 일정입니다.',
        riskWhatItTells: '핵심 부품 조달 병목, 경쟁 장비사 단가 인하 압박, 납기 지연 지체상금 조건을 확인합니다.',
        riskSubtitle: `B반도체의 장비 부품 수급 및 납기 지연 조건 조사`,
        riskPostTitle: `B반도체, 진공 부품 사전 비축으로 납기 지연 위험 축소… 외화 부품 원가 변수 상존`,
        riskBody: [
          `B 반도체는 수입 의존도가 높은 초정밀 진공 밸브와 고주파 전원장치 부품을 사전에 비축해 부품 품귀로 인한 납기 지연이나 지체상금 발생 가능성을 낮췄다.`,
          `다만 주요 핵심 부품을 외화로 결제하는 구조여서 환율 변동에 따라 장비 제조 원가가 변동하는 조건이 남아 있다.`,
          `고객사 반입 일정에 맞춰 추가 설치 인력이 투입될 경우 초기 셋업 비용 관리가 과제로 꼽힌다.`
        ].join('\n\n'),
        riskHighlight: '핵심 부품 사전 비축으로 지체상금 위험은 낮으나 외화 결제 부품 원가 변수가 남아 있습니다.'
      });
    } else if (step === 1 && !isLast) {
      const midGood = true;
      const bGood = true;

      fTitle = `${variant.fabName}, 전공정 장비 반입 및 시제품 웨이퍼 테스트 시작`;
      fSum = `장비 셋업 완료 및 시험 가동 개시… 적층 발열·수율 편차와 현장 검수(SAT) 조건 점검 (${arcStageLabel})`;
      fBody = [
        `증설 중인 ${variant.fabName}에 전공정 장비 반입과 초기 셋업이 이어지면서 시제품 웨이퍼 테스트가 시작됐다. 2차 증설 구역용 후속 장비 반입도 하반기 일정으로 잡혔다.`,
        `제조사는 하반기 시제품 테스트를 마친 뒤 연내 글로벌 서버 고객사 품질 인증 진입을 목표로 하고 있으며, 장비 공급사는 2차 물량 순차 반입에 들어갔다.`,
        `다만 초미세 적층 공정의 발열 제어와 웨이퍼 가장자리(Edge) 수율 편차, 그리고 장비 대금 정산의 전제 조건인 현장 인수 검수(SAT) 통과 여부가 남아 있는 변수다.`
      ].join('\n\n');

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
        schedulePostTitle: `A반도체, 하반기 시제품 웨이퍼 테스트 완료 후 연내 글로벌 고객사 품질 인증 진입`,
        scheduleBody: [
          `A 반도체의 신규 증설 라인이 상반기 장비 셋업을 마무리하고 하반기 시제품 웨이퍼 테스트를 완료하는 일정으로 진행 중이다.`,
          `테스트 종료 직후 연말 전에 글로벌 데이터센터 고객사에 인증용 샘플을 출하하고 공식 품질 인증 절차에 들어간다.`,
          `고객사 인증 결과와 본격 양산 물량 배정은 후속 단계 일정으로 이어진다.`
        ].join('\n\n'),
        scheduleHighlight: '하반기 시제품 테스트 완료와 연내 글로벌 고객사 품질 인증 진입 일정이 확정됐습니다.',
        riskWhatItTells: '초미세 공정 수율 불량률, 웨이퍼 폐기 손실, 시운전 원가 부담 조건을 확인합니다.',
        riskSubtitle: `A반도체의 초기 수율 안정성 및 시운전 원가 조건 조사`,
        riskPostTitle: `A반도체, 적층 공정 발열 및 웨이퍼 가장자리 수율 편차… 시운전 폐기 비용 조건`,
        riskBody: [
          `A 반도체의 신규 라인 시운전 과정에서는 고속 적층 공정의 발열 제어와 웨이퍼 가장자리(Edge) 수율 편차가 기술적 과제로 확인됐다.`,
          `수율 안정화가 늦어지면 시운전용 웨이퍼 폐기 손실과 재가공 비용이 계획보다 늘어나는 구조다.`,
          `고객사 인증 기준을 충족하기 전까지 반복 시험에 따른 공정 소모품 비용 부담이 남아 있다.`
        ].join('\n\n'),
        riskHighlight: '적층 공정 발열과 웨이퍼 가장자리 수율 편차로 시운전 폐기 비용이 늘어날 수 있는 조건입니다.'
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
        schedulePostTitle: `B반도체, 하반기 2차 증설 구역 후속 장비 순차 반입 및 내년 개장 전 잔금 정산`,
        scheduleBody: [
          `B 반도체가 고객사 2차 증설 구역에 투입될 후속 식각·증착 장비를 올해 하반기부터 순차적으로 반입한다.`,
          `현장 셋업과 초기 구동 점검을 마친 뒤 내년 개장 전까지 2차 물량 납품 잔금을 정산받는 일정으로 잡혀 있다.`,
          `1차 공급에 이어 2차 물량까지 연내 반입이 이어지는 타임라인이다.`
        ].join('\n\n'),
        scheduleHighlight: '하반기 2차 증설 장비 순차 반입과 내년 개장 전 잔금 정산 일정이 확인됐습니다.',
        riskWhatItTells: '고객사 셋업 지연에 따른 현장 검수(SAT) 보류 및 매출 인식 이월 조건을 확인합니다.',
        riskSubtitle: `B반도체의 장비 검수 지연 및 매출 인식 이월 조건 조사`,
        riskPostTitle: `B반도체, 고객사 수율 조정 지연 시 현장 인수 검수(SAT) 보류 및 정산 이월 조건`,
        riskBody: [
          `B 반도체 장비의 최종 잔금 정산은 고객사 클린룸 내 현장 인수 검수(SAT) 통과를 필수 조건으로 하고 있다.`,
          `고객사가 초기 라인 수율 안정화를 이유로 검수 승인을 미루면 장비 납품이 끝나더라도 매출 인식이 차기 연도로 이월된다.`,
          `검수 대기 기간이 길어질수록 현장 지원 인력 유지비와 재고 관리 고정비가 늘어나는 조건이 남아 있다.`
        ].join('\n\n'),
        riskHighlight: '고객사 수율 조정으로 현장 인수 검수(SAT)가 지연되면 정산이 이월되는 조건이 확인됐습니다.'
      });
    } else if (!isLast) {
      const midGood = (step % 2 === 1) ? true : finalSuccess;
      const bGood = !midGood;
      const extraSemiTpl = EXTRA_ARC_MIDDLE_STAGES.semi[step - 2] || null;

      if (extraSemiTpl) {
        fTitle = extraSemiTpl.freeTitle(variant);
        fSum = extraSemiTpl.freeSummary(arcStageLabel);
        fBody = extraSemiTpl.freeBody(variant);

        aPos = midGood;
        aRate = midGood ? Number(randFloat(0.05, 0.12).toFixed(3)) : Number(randFloat(-0.09, -0.04).toFixed(3));
        aReason = midGood ? extraSemiTpl.aReasonPos : extraSemiTpl.aReasonNeg;

        aPair = createSingleArcPaidClue({
          year: y,
          stock: aSemiStock,
          arcStageLabel,
          isPositive: aPos,
          topic: extraSemiTpl.aTopic,
          subtitle: extraSemiTpl.aSubtitle(variant),
          postTitle: midGood ? extraSemiTpl.aPostTitlePos : extraSemiTpl.aPostTitleNeg,
          body: midGood ? extraSemiTpl.aBodyPos() : extraSemiTpl.aBodyNeg(),
          highlightNote: midGood ? extraSemiTpl.aHighlightPos : extraSemiTpl.aHighlightNeg
        });

        bPos = bGood;
        bRate = bGood ? Number(randFloat(0.05, 0.12).toFixed(3)) : Number(randFloat(-0.08, -0.03).toFixed(3));
        bReason = bGood ? extraSemiTpl.bReasonPos : extraSemiTpl.bReasonNeg;

        bPair = createSingleArcPaidClue({
          year: y,
          stock: bSemiStock,
          arcStageLabel,
          isPositive: bPos,
          topic: extraSemiTpl.bTopic,
          subtitle: extraSemiTpl.bSubtitle(),
          postTitle: bGood ? extraSemiTpl.bPostTitlePos : extraSemiTpl.bPostTitleNeg,
          body: bGood ? extraSemiTpl.bBodyPos() : extraSemiTpl.bBodyNeg(),
          highlightNote: bGood ? extraSemiTpl.bHighlightPos : extraSemiTpl.bHighlightNeg
        });
      } else {
        fTitle = `${variant.fabName}, 후공정 패키징 라인 연동 및 고객사 물량 협의`;
        fSum = `전공정·패키징 통합 테스트 수율과 추가 장비 수주 공백 여부 점검 (${arcStageLabel})`;
        fBody = [
          `증설 중인 ${variant.fabName}이 전공정 웨이퍼 라인과 후공정 첨단 패키징 라인을 연동하는 통합 테스트 구간에 들어섰다.`,
          `제조사는 서버 고객사들과 선주문 물량 협의를 병행하고 있으며, 장비 협력사들은 패키징 연동용 추가 장비 발주 여부를 확인하고 있다.`,
          `실리콘 인터포저 기판 수급 병목이나 주력 전공정 장비 납품 종료 후 단기 발주 공백이 발생할 수 있는 조건이 남아 있다.`
        ].join('\n\n');

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
            ? `A반도체, 전공정-패키징 통합 시험 수율 목표치 도달 및 서버 고객사 물량 예약`
            : `A반도체, 패키징용 인터포저 기판 수급 병목으로 통합 시운전 대기 비용 증가`,
          body: midGood
            ? [
                `A 반도체가 신규 웨이퍼 라인과 후공정 패키징 공정을 연결한 통합 테스트에서 내부 목표 수율에 도달했다.`,
                `이에 따라 주요 서버 고객사들과 선주문 물량 배정 협의를 진행하며 양산 준비를 이어가고 있다.`,
                `최종 연간 공급 물량과 가동률은 본격 양산 전환 시점에 확정된다.`
              ].join('\n\n')
            : [
                `첨단 패키징에 필수적인 실리콘 인터포저 기판의 외부 조달이 지연되면서 A 반도체의 통합 시운전 일정이 늦어지고 있다.`,
                `기판 수급 병목이 해소될 때까지 신규 라인의 대기 비용과 시운전 유지비가 추가로 발생하는 구조다.`,
                `대체 기판 공급처 인증이 완료되기 전까지 양산 전환 준비에 제약이 남아 있다.`
              ].join('\n\n'),
          highlightNote: midGood
            ? '통합 패키징 시험 수율 목표 도달과 서버 고객사 물량 예약 협의가 확인됐습니다.'
            : '패키징 기판 조달 병목에 따른 시운전 대기 비용 조건이 확인됐습니다.'
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
            ? `B반도체, 패키징 연동용 TSV 식각·세정 장비 추가 수주 및 연내 납품 진행`
            : `B반도체, 주력 전공정 장비 납품 일단락… 차기 발주까지 단기 수주 공백 구간`,
          body: bGood
            ? [
                `B 반도체가 고객사의 후공정 패키징 라인 확장에 맞춰 실리콘관통전극(TSV) 식각 및 세정 장비 추가 물량을 수주했다.`,
                `추가 수주 물량은 올해 안에 순차 납품이 진행되며 기존 전공정 공급 종료에 따른 공백을 메우고 있다.`,
                `후속 업그레이드 발주는 고객사의 최종 양산 가동률 확인 이후 결정된다.`
              ].join('\n\n')
            : [
                `B 반도체의 전공정 주력 장비 납품이 일단락되면서 고객사의 최종 양산 전환 전까지 신규 발주가 일시적으로 비는 구간에 들어섰다.`,
                `추가 장비 수주 없이 기존 유지보수 인력과 설비 고정비가 유지되는 구조다.`,
                `고객사의 차기 라인 증설 결정이 내려지기 전까지 수주 공백이 이어질 조건이 남아 있다.`
              ].join('\n\n'),
          highlightNote: bGood
            ? '패키징 공정용 추가 장비 수주와 연내 납품 일정이 확인됐습니다.'
            : '주력 물량 납품 종료 후 차기 발주까지 단기 수주 공백 구간임이 확인됐습니다.'
        });
      }
    } else {
      fTitle = `${variant.fabName}, 연말 양산 전환 일정 및 글로벌 서버 물량 배정 협의`;
      fSum = `${durationYears}년 신규 메모리 라인의 양산 전환 시점과 감가상각·재고 조정 조건 점검 (${durationYears}/${durationYears} 최종 단계)`;
      fBody = [
        `수년간 대규모 설비 투자가 이어진 ${variant.fabName}이 올해 연말 본격 양산 전환 시점을 맞았다. 글로벌 데이터센터 고객사들과의 연간 공급 물량 배정 협상도 막바지 단계다.`,
        `최종 양산 가동률과 연간 공급 계약 규모, 그리고 장비 협력사의 유지보수·업그레이드 발주 일정은 내년 개장 직전에 함께 확정되어 공개된다.`,
        `다만 양산 전환과 동시에 수년간 투입된 설비 투자금의 감가상각비가 매 분기 반영되기 시작하며, 서버 고객사들이 재고 조정으로 초기 발주를 줄일 경우 손익분기 가동률에 미달할 조건이 남아 있다.`
      ].join('\n\n');

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
        schedulePostTitle: `A반도체, 연말 양산 가동 전환… 내년 개장 전 글로벌 데이터센터 연간 물량 확정`,
        scheduleBody: [
          `A 반도체가 ${variant.fabName}의 본격 양산 전환 시점을 연말로 확정하고 글로벌 서버 고객사들과 연간 공급 물량 배정 협상을 진행 중이다.`,
          `최종 양산 가동률과 장기 공급 계약 규모는 내년 개장 직전에 확정되어 대외적으로 발표된다.`,
          `수년간 이어진 대규모 증설 프로젝트의 첫 양산 출하 성적이 내년 개장 시점에 공개되는 일정이다.`
        ].join('\n\n'),
        scheduleHighlight: '연말 양산 전환을 거쳐 내년 개장 직전에 연간 공급 물량과 가동률이 확정되는 일정입니다.',
        riskWhatItTells: '대규모 감가상각비 개시 부담, 서버 고객사 재고 조정, 가동률 미달 조건을 확인합니다.',
        riskSubtitle: `A반도체의 양산 감가상각 부담 및 고객사 재고 조정 조건 조사`,
        riskPostTitle: `A반도체, 양산 전환 시 대규모 감가상각비 개시… 고객사 재고 조정 시 가동률 미달 조건`,
        riskBody: [
          `신규 팹이 양산 가동으로 전환되는 시점부터 수년간 투입된 설비 투자금이 대규모 감가상각 비용으로 매 분기 반영되기 시작한다.`,
          `글로벌 서버 고객사들이 자체 보유 재고 조정을 이유로 초기 발주량을 축소할 경우 손익분기 가동률을 채우지 못할 수 있다.`,
          `고정 감가상각비 대비 출하량이 부족해지면 신규 라인의 원가 회수가 크게 지연되는 조건이 남아 있다.`
        ].join('\n\n'),
        riskHighlight: '양산 전환과 동시에 대규모 감가상각비가 반영되므로 초기 가동률 미달 시 원가 부담이 커지는 조건입니다.'
      });

      bPair = createChoicePaidCluePair({
        year: y,
        stock: bSemiStock,
        arcStageLabel,
        isPositive: bPos,
        scheduleWhatItTells: '양산 라인 유지보수 부품 공급 일정과 후속 공정 업그레이드 발주 일정을 확인합니다.',
        scheduleSubtitle: `B반도체의 양산 유지보수 계약 및 추가 증설 발주 일정 조사`,
        schedulePostTitle: `B반도체, 고객사 연말 양산 전환 연동… 내년 개장 전 유지보수·후속 발주 확정`,
        scheduleBody: [
          `A 반도체의 신규 라인이 연말 양산 전환 단계에 들어가면서 B 반도체의 소모성 유지보수 파츠 공급 계약 논의가 마무리 단계에 있다.`,
          `유지보수 장기 계약과 차기 공정 업그레이드 장비 발주 일정은 내년 개장 직전에 함께 확정된다.`,
          `고객사 양산 전환 직후의 발주 결과가 내년 개장 시점에 반영되는 타임라인이다.`
        ].join('\n\n'),
        scheduleHighlight: '고객사의 연말 양산 전환 직후인 내년 개장 전에 유지보수 및 후속 장비 발주 일정이 확정됩니다.',
        riskWhatItTells: '고객사 감산 전환 시 후속 장비 발주 동결 및 단가 인하 압박 조건을 확인합니다.',
        riskSubtitle: `B반도체의 고객사 설비 투자 동결 및 발주 보류 조건 조사`,
        riskPostTitle: `B반도체, 메모리 고객사 투자 동결 시 후속 라인 장비 발주 보류 및 단가 조정 조건`,
        riskBody: [
          `메모리 제조 고객사가 신규 라인의 초기 가동률과 시황을 확인한 뒤 추가 설비 투자(CAPEX) 규모를 다시 조정할 방침이다.`,
          `고객사가 감산이나 설비 투자 동결을 택할 경우 B 반도체가 준비해 온 후속 라인 장비 발주가 전면 보류될 수 있다.`,
          `발주 보류와 함께 기존 유지보수 파츠의 단가 인하 요구가 겹칠 수 있는 조건이 남아 있다.`
        ].join('\n\n'),
        riskHighlight: '고객사가 설비 투자를 동결할 경우 후속 장비 발주가 보류되고 단가 인하 압박이 커지는 조건입니다.'
      });
    }

    // 플레이 피드백: 기사 본문 보강 (단계별 구체 사실 1문장 추가)
    if (!(step >= 3 && !isLast && EXTRA_ARC_MIDDLE_STAGES.semi[step - 2])) {
      const semiStageType = getArcStageType(step, durationYears);
      fBody = extendArcFreeBody('semi', semiStageType, fBody);
      extendArcPaidList('semi', 'a_semi', semiStageType, aPos, aPair);
      extendArcPaidList('semi', 'b_semi', semiStageType, bPos, bPair);
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
    const steps = Math.floor((maxP - minP) / 500000);
    pricesByYear[2010][stock.id] = minP + randInt(0, steps) * 500000;
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
    let nextP = Math.max(1000, Math.round((prevP * (1 + signedRate)) / 10000) * 10000);
    if (nextP === prevP) {
      nextP = isUp ? prevP + 500000 : Math.max(1000, prevP - 500000);
    }
    pricesByYear[2011][stock.id] = nextP;
    const reasonPool = isUp ? OPENING_2011_REASONS[stock.id].up : OPENING_2011_REASONS[stock.id].down;
    openingReasonsByYear[2011][stock.id] = pickOne(reasonPool);
  }

  // 한 판(2011~2019년, 9개 거래 연도) 동안 종목별로 이미 사용된 단년 사건(eventKey)을 추적하여 같은 판 안에서 동일한 기사가 다시 나오지 않도록 보장
  const usedEventKeysByStock = {};
  for (const stock of STOCKS) {
    usedEventKeysByStock[stock.id] = new Set();
  }

  // 2011~2019년 거래 연도별 장기 아크 단계(선택형 유료 단서 2종) + 단년 사건(유료 단서 1종) 결합
  for (let tradeYear = 2011; tradeYear <= 2019; tradeYear++) {
    const openingYear = tradeYear + 1;
    pricesByYear[openingYear] = {};
    openingReasonsByYear[openingYear] = {};

    const yearOutcomesByStock = {};
    const chosenTplByStock = {};
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
      const usedSet = usedEventKeysByStock[stock.id];
      const unusedInThisGame = templates.filter((t) => !usedSet.has(t.eventKey));
      const candidateTpls = unusedInThisGame.length > 0 ? unusedInThisGame : templates;
      // 이전 판들에서 아직 안 나왔던 사건을 우선 선택
      const unplayedAcrossGames = candidateTpls.filter(
        (t) => !excludedSet.has(`event:${stock.id}:${t.eventKey}`)
      );
      const tpl = pickOne(unplayedAcrossGames.length > 0 ? unplayedAcrossGames : candidateTpls);
      usedSet.add(tpl.eventKey);
      chosenTplByStock[stock.id] = tpl;

      const unvisited = tpl.outcomes.filter(
        (o) =>
          !excludedSet.has(`${tradeYear}:${stock.id}:${o.outcomeId}`) &&
          !excludedSet.has(`${stock.id}:${o.outcomeId}`)
      );
      const chosenOutcome = pickOne(unvisited.length > 0 ? unvisited : tpl.outcomes);
      const [minR, maxR] = chosenOutcome.rateRange;
      const rate = Number(randFloat(minR, maxR).toFixed(3));
      const sig = `${tradeYear}:${stock.id}:${chosenOutcome.outcomeId}`;
      eventSignatures.push(sig);
      eventSignatures.push(`${stock.id}:${chosenOutcome.outcomeId}`);
      eventSignatures.push(`event:${stock.id}:${tpl.eventKey}`);

      const singleFreeObj = {
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
      };
      extendSingleFreeArticle(singleFreeObj, tpl.eventKey);
      singleFreeArticles.push(singleFreeObj);

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
      extendSinglePaidArticle(singlePaidObj, chosenOutcome.outcomeId);

      yearOutcomesByStock[stock.id] = {
        rate,
        isMegaBoom: false,
        reason: chosenOutcome.openingReason,
        signature: sig,
        paidArticles: [singlePaidObj]
      };
    }

    // 한 해에 상승 종목과 하락 종목이 모두 최소 3개 이상 섞이도록 보정
    // 주의: 이미 해당 연도에 배정된 사건(chosenTplByStock[stockId]) 안에서만 양/음 결과를 전환하여 첫 번째 템플릿으로 덮어써지는 중복을 방지
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
        const tpl = chosenTplByStock[stockId] || SINGLE_YEAR_TEMPLATES[stockId][0];
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
          extendSinglePaidArticle(yearOutcomesByStock[stockId].paidArticles[0], desired.outcomeId);
        }
      }
    }

    for (const stock of STOCKS) {
      const prevPrice = pricesByYear[tradeYear][stock.id];
      const outcome = yearOutcomesByStock[stock.id];
      let nextPrice = Math.max(1000, Math.round((prevPrice * (1 + outcome.rate)) / 1000) * 1000);
      if (nextPrice === prevPrice) {
        nextPrice = outcome.rate >= 0 ? prevPrice + 100000 : Math.max(1000, prevPrice - 100000);
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
        a_bio: 22000000,
        b_bio: 19000000,
        a_enter: 18500000,
        b_enter: 15000000,
        a_semi: 32000000,
        b_semi: 23000000,
        a_food: 10500000,
        a_game: 13000000,
        a_ship: 19000000,
        a_air: 16000000
      },
      2011: {
        a_bio: 24000000,
        b_bio: 18000000,
        a_enter: 20000000,
        b_enter: 16000000,
        a_semi: 30000000,
        b_semi: 25000000,
        a_food: 10000000,
        a_game: 14000000,
        a_ship: 22000000,
        a_air: 15000000
      },
      2012: {
        a_bio: 26400000,
        b_bio: 17460000,
        a_enter: 22000000,
        b_enter: 15680000,
        a_semi: 28500000,
        b_semi: 28000000,
        a_food: 10800000,
        a_game: 13020000,
        a_ship: 22660000,
        a_air: 15600000
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
