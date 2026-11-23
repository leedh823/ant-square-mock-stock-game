/**
 * 개미광장 기사 본문 보강 문장 (플레이 피드백: 기사 글을 조금 더 길게)
 * - 각 기사의 가운데 문단에 해당 사건의 구조·절차·계약 조건을 설명하는 구체적인 문장을 1개씩 덧붙입니다.
 * - 미래 상승·하락 여부, 확정 등락률, 미공개 결말은 담지 않습니다.
 * - 회사명이 숨겨진 무료 기사(바이오 장기 사건)에는 특정 회사명을 쓰지 않습니다.
 */

const STOCK_LABELS = {
  a_bio: 'A바이오',
  b_bio: 'B바이오',
  a_enter: 'A 엔터',
  b_enter: 'B 엔터',
  a_semi: 'A 반도체',
  b_semi: 'B 반도체',
  a_food: 'A 식품',
  a_game: 'A 게임',
  a_ship: 'A 조선',
  a_air: 'A 항공'
};

function hasFinalConsonant(word) {
  const last = String(word || '').trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function nameCtx(stockId) {
  const n = STOCK_LABELS[stockId] || '';
  const batchim = hasFinalConsonant(n);
  return {
    n,
    eun: `${n}${batchim ? '은' : '는'}`,
    ga: `${n}${batchim ? '이' : '가'}`
  };
}

function appendToMiddleParagraph(body, sentence) {
  if (!sentence) return body;
  const paras = String(body || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return sentence;
  const idx = paras.length >= 2 ? 1 : 0;
  paras[idx] = `${paras[idx]} ${sentence}`;
  return paras.join('\n\n');
}

/**
 * 기사 제목(postTitle)이나 마지막 문단에서 정답(호재/악재)을 떠먹여 주던 설명형 결론 문장을 제거하고,
 * 첫 문단(배경·추진 경위)과 둘째 문단(새로 확인된 구체적 계약·일정·수치 사실)만으로
 * 플레이어가 직접 다음 개장 결과를 추리하도록 다듬습니다.
 */
function sanitizePaidTitleForDeduction(title) {
  if (!title) return title;
  let t = String(title).trim();
  // 제목에서 결과를 바로 알려주는 직접적 평가 어구를 사실·조건·일정 중심 표현으로 완화
  const replacements = [
    [/초기 마케팅비 과다 지출 및 유료 전환율 저조/g, '자체 숏폼 앱 독점 공급 전환 및 초기 프로모션 집행'],
    [/과다 지출/g, '집행'],
    [/과다 집행/g, '집행'],
    [/전환율 저조/g, '전환 지표 집계'],
    [/판매 부진/g, '판매 추이 점검'],
    [/관객 미달/g, '상영 회차 조정'],
    [/가동률 저조/g, '초기 가동 구간 진입'],
    [/방문객 저조/g, '방문객 추이 점검'],
    [/예약률 저조/g, '초기 예약 추이 점검'],
    [/고마진 확보/g, '납품 계약 체결'],
    [/원가율 크게 개선/g, '자체 가공 라인 적용'],
    [/수익성 개선/g, '정산 구조 확정'],
    [/대폭 절감/g, '비중 조정'],
    [/완판/g, '선주문 마감'],
    [/전석 매진/g, '선행 예매 진행'],
    [/전 회차 선행 매진/g, '선행 예매 진행'],
    [/손익분기 돌파/g, '초도 물량 집계'],
    [/손익분기점 근접/g, '초기 좌석점유율 집계'],
    [/회수 미달 구간 진입/g, '상영 일정 조정'],
    [/일시 상각/g, '회계 처리 검토'],
    [/대손충당금 설정/g, '결제 일정 조율'],
    [/품질보증 충당금 설정/g, '호환성 업데이트 진행'],
    [/지체상금 충당금 설정/g, '인도 일정 조율'],
    [/공사손실충당금 검토/g, '후판 공급 단가 재협상'],
    [/공사손실충당금/g, '원가 반영 조건'],
    [/반품 누적/g, '유통 물량 재조정'],
    [/반품 증가/g, '유통 재고 정산'],
    [/할인 처분/g, '재고 소진 프로모션'],
    [/덤핑 판매/g, '잔여 좌석 특가 편성'],
    [/전면 중단/g, '방식 조정'],
    [/협상 결렬/g, '단가 재협상 진행'],
    [/정규 편성 불발/g, '파일럿 심사 종료'],
    [/옵션 미행사 종료/g, '독점 평가 기간 만료']
  ];
  for (const [regex, rep] of replacements) {
    t = t.replace(regex, rep);
  }
  return t;
}

function refinePaidBodyForDeduction(body) {
  if (!body) return body;
  const paras = String(body || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // 3번째 문단("연말까지 ~ 이어지는 조건이다 / ~ 구조다 / ~ 상태다")은 앞서 나온 사실의 결과를 요약·단정해주어
  // 추리 재미를 반감시키므로, 3문단일 때는 결론 요약 문단(3번째 문단)을 제거하고 1~2문단의 구체 사실만 남깁니다.
  const kept = paras.length >= 3 ? paras.slice(0, 2) : paras;
  return kept
    .map((p) =>
      p
        .replace(/손실로 남는 조건이다\./g, '정산 일정이 조율 중이다.')
        .replace(/손실이 발생하는 조건이다\./g, '고정비 정산 조건이 남아 있다.')
        .replace(/일시 무형자산 손상차손으로 반영해야 한다\./g, '회계 반영 방식을 조율하고 있다.')
        .replace(/대손충당금을 설정해야 하는 상황이다\./g, '대금 회수 일정을 재조율하고 있다.')
        .replace(/원가 이하 땡처리 특가로 직접 처분하고 있다\./g, '직접 특가 프로모션으로 전환해 판매하고 있다.')
    )
    .join('\n\n');
}

function applyExtension(article, sentence) {
  if (!article) return;
  const oldBody = article.body;
  let newBody = sentence ? appendToMiddleParagraph(oldBody, sentence) : oldBody;
  if (article.type === 'paid') {
    newBody = refinePaidBodyForDeduction(newBody);
    if (article.postTitle) {
      article.postTitle = sanitizePaidTitleForDeduction(article.postTitle);
    }
    if (article.fallbackPostTitle) {
      article.fallbackPostTitle = sanitizePaidTitleForDeduction(article.fallbackPostTitle);
    }
  }
  article.body = newBody;
  if (Object.prototype.hasOwnProperty.call(article, 'fallbackBody')) {
    article.fallbackBody = newBody;
  }
  if (Array.isArray(article.disclosedFacts)) {
    article.disclosedFacts = article.disclosedFacts.map((f) => (f === oldBody ? newBody : f));
  }
}

function resolveSentence(entry, stockId) {
  if (!entry) return null;
  return typeof entry === 'function' ? entry(nameCtx(stockId)) : entry;
}

/* ---------------------------------------------------------------------------
 * 1. 단년 사건 템플릿 (무료: eventKey / 유료: outcomeId)
 * ------------------------------------------------------------------------- */
const SINGLE_FREE_EXT = {
  enter_world_tour_venue: '업계에 따르면 북미·유럽 대형 공연장은 이미 다음 해 성수기 일정까지 상당 부분 예약이 찬 상태여서, 추가 회차는 평일이나 비성수기 위주로 편성될 가능성이 거론된다.',
  enter_album_merch_platform: '일부 기획사는 앨범 구성품을 줄이는 대신 디지털 포토카드나 온라인 팬미팅 응모권처럼 실물 제작비가 들지 않는 상품 비중을 늘리는 방안을 검토하고 있다.',
  enter_artist_renewal_ip: '통상 재계약 협상에는 계약 기간, 개인 활동 허용 범위, 음원·공연 수익 배분율이 함께 묶여 있어 한 항목만 이견이 남아도 전체 서명이 늦어지는 경우가 많다.',
  b_enter_ott_series: '최근 OTT 업체들은 제작비 전액을 선지급하던 방식에서 벗어나 납품 검수 이후 잔금을 지급하는 조건을 늘리고 있어, 제작사의 현금 회수 시점이 이전보다 뒤로 밀리는 추세다.',
  b_enter_theatrical_movie_release: '배급업계는 개봉 첫 2주의 좌석점유율을 상영관 유지 여부를 가르는 기준으로 보고 있으며, 같은 시기 대작 2~3편이 함께 걸리면서 상영 회차 경쟁도 치열해졌다.',
  food_grain_wholesale_contract: '식품업체들은 보통 6개월에서 1년 단위로 원료 공급 계약을 맺기 때문에, 같은 도매가 변동이라도 계약 만료 시점에 따라 원가 반영 시기가 반년 이상 차이 날 수 있다.',
  food_kfood_overseas_export: '현지 대형마트는 신규 브랜드에 대해 첫 진열 이후 3~6개월간 판매 회전율을 확인한 뒤 재발주와 매대 유지 여부를 결정하는 것으로 알려졌다.',
  game_overseas_launch_review: '해외 주요 시장의 등급 심사는 신청 후 수개월이 걸리는 경우가 많고, 과금 구조나 확률형 아이템 표기 문제로 보완 요청을 받으면 일정이 다시 늘어난다.',
  game_pc_console_crossplay: '앱마켓을 거치는 결제는 매출의 상당 부분을 수수료로 내야 하지만 자체 PC 런처 결제는 이 비용이 크게 줄어, 결제 경로 전환율이 곧 이익 구조와 연결된다.',
  semi_ddr_contract_price: '고정거래가격은 보통 분기 단위로 협상되며, 고객사 재고가 적정 수준을 넘으면 신규 발주가 다음 분기로 미뤄지는 경우가 많다.',
  b_semi_nextgen_etcher_qual: '품질 테스트는 수백 시간 이상의 연속 운전과 수천 장 단위 웨이퍼 처리 결과를 확인하는 방식으로 진행되며, 통과 이후에도 초도 물량은 소규모로 시작되는 것이 일반적이다.',
  ship_steel_plate_heavy_tail: '대형 선박 대금은 계약·착공·진수·인도 단계에 나눠 받는데, 마지막 인도 시점에 전체 대금의 절반 이상이 몰리는 경우가 많아 인도 일정이 현금흐름에 직접 영향을 준다.',
  air_route_expansion_fuel: '항공사들은 통상 연간 유류 소요량의 일부를 미리 정한 가격으로 사두는 헤지 계약을 맺는데, 헤지 비중이 낮을수록 유가 변동이 운항 원가에 바로 반영된다.',
  air_cargo_semiconductor_freight: '반도체 장비와 IT 부품은 납기가 촉박하고 단가가 높아 해상 운송 대신 항공 화물을 이용하는 비중이 크며, 장기 전세기 계약이 체결되면 일정 기간 운임이 고정된다.',
  bio_pipeline_general_a: '후속 파이프라인 기술료는 특허 등록, 전임상 완료, 임상 진입 등 단계별 조건이 충족될 때마다 나눠 지급되는 구조가 일반적이다.',
  bio_pipeline_general_b: '위탁생산 계약은 품질 실사를 통과해야 첫 상업 물량을 생산할 수 있으며, 실사 과정에서 보완 요청이 나오면 재검증에 수개월이 추가로 걸리기도 한다.'
};

const SINGLE_PAID_EXT = {
  tour_promoter_covers_70: (s) => `${s.eun} 추가 회차를 주말 위주로 편성해 좌석 판매 효율을 높이고, 무대 장비는 기존 투어 장비를 그대로 옮겨 쓰는 방식으로 운송 품목도 줄이기로 했다.`,
  tour_cost_overrun: (s) => `현지 공연장 측은 성수기 대관료 인상분을 그대로 적용하겠다는 입장이며, ${s.eun} 장비 일부를 현지에서 임차하는 방안을 검토하고 있지만 아직 확정되지 않았다.`,
  merch_high_margin_hit: (s) => `${s.eun} 선주문으로 확정된 수량만큼만 실물 앨범을 찍는 방식으로 초도 생산량을 조정해 남는 재고를 최소화하고 있다.`,
  merch_inventory_writeoff: (s) => `${s.eun} 남은 시즌 굿즈를 할인 판매하거나 다음 투어 현장 판매로 돌리는 방안을 검토하고 있지만, 시즌 한정 디자인이라 처분 가격이 낮아질 수 있다.`,
  renewal_full_group_success: () => '이번 계약에는 멤버별 개인 활동을 일정 범위에서 허용하되 그룹 활동 일정을 우선하는 조항이 포함된 것으로 알려졌다.',
  renewal_bonus_burden: (s) => `일부 멤버는 개인 레이블 설립 가능성까지 거론하고 있어, ${s.eun} 그룹 단위 계약과 개인 단위 계약을 분리하는 방안도 함께 검토하고 있다.`,
  ott_upfront_settlement: (s) => `해당 작품은 공개 일정까지 확정돼 있어 ${s.eun} 같은 제작팀을 다음 시즌 작품 기획에 곧바로 투입할 계획이다.`,
  ott_production_cost_delay: (s) => `${s.eun} 외부 시각효과 업체를 추가로 섭외해 작업 속도를 높이려 하고 있지만, 추가 인력 투입에 따른 후반 작업비 증가는 피하기 어려운 상황이다.`,
  movie_boxoffice_hit: () => '개봉 2주 차 예매 비중도 첫 주와 비슷한 수준을 유지하고 있어 상영관 측이 회차를 줄이지 않고 있는 것으로 전해졌다.',
  movie_bep_miss: (s) => `${s.eun} VOD 조기 공개와 해외 영화제 출품으로 부가 수익을 확보하는 방안을 검토하고 있지만, 계약 성사 여부는 아직 정해지지 않았다.`,
  grain_cost_drop_applied: (s) => `새 계약은 1년 단위 고정 단가 조건이어서 연중 도매가가 다시 움직이더라도 ${s.n}의 원료 단가는 계약 기간 동안 유지된다.`,
  grain_high_cost_locked: (s) => `${s.n}의 잔여 장기계약 물량은 내년 상반기쯤 소진될 것으로 추정되며, 그 전까지는 시세가 내려가도 계약 단가대로 원료를 들여와야 한다.`,
  kfood_costco_walmart_hit: (s) => `직매입 조건은 판매되지 않은 물량을 반품하지 않는 구조여서 ${s.n}의 재고 부담도 함께 줄었다.`,
  kfood_promo_fee_burden: () => '현지 유통사는 다음 분기까지 판매 회전율이 기준에 미치지 못하면 진열 면적을 줄이겠다는 조건을 계약에 포함한 것으로 알려졌다.',
  game_review_delayed: (s) => `${s.eun} 보완 자료를 제출한 뒤 아직 심사 재개 일정을 통보받지 못했으며, 그동안 사전 예약자 이탈을 막기 위한 이벤트 비용이 추가로 들고 있다.`,
  game_global_hit_launch: (s) => `${s.eun} 출시 초기 접속 집중에 대비해 지역별 서버를 미리 증설해 두었고, 첫 대규모 업데이트 일정도 출시 두 달 뒤로 잡아 두었다.`,
  crossplay_pc_margin_boom: (s) => `${s.eun} PC 런처로 결제하면 추가 보상을 주는 이벤트를 다음 시즌까지 이어갈 계획이다.`,
  crossplay_server_issue_refund: (s) => `${s.eun} 문제가 된 과금 아이템의 확률과 효과를 조정하는 패치를 준비 중이지만, 적용 일정은 아직 공지되지 않았다.`,
  ddr_price_rebound_win: (s) => `${s.eun} 신규 공정에서 생산한 고용량 서버용 제품 비중을 늘려, 같은 웨이퍼에서 더 높은 단가를 받는 제품 구성으로 바꾸고 있다.`,
  ddr_inventory_valuation_loss: (s) => `${s.eun} 일부 라인 가동률을 낮춰 생산량을 조절하는 방안을 검토하고 있지만, 가동률을 낮추면 고정비 부담이 제품 한 개당 원가에 더 크게 실린다.`,
  qual_test_passed_mass_order: () => '고객사는 초도 물량의 양산 라인 성능을 확인한 뒤 같은 장비를 추가 라인에 순차 도입할지 결정할 방침이다.',
  qual_test_redesign_delay: (s) => `${s.eun} 챔버 소재를 바꾼 개선 시제품을 만들어 다시 연속 운전 테스트를 받을 계획이며, 재시험에는 최소 수개월이 걸릴 것으로 보인다.`,
  steel_drop_heavytail_inflow: () => '인도 예정 선박은 시운전을 마치고 선주 측 최종 검수만 남겨둔 상태로, 검수 일정도 확정된 것으로 전해졌다.',
  steel_hike_provision_loss: () => '해당 선박들은 후판 가격이 낮았던 시기에 고정 선가로 계약돼 원가 상승분을 선주에게 넘기기 어려운 구조다.',
  air_load_factor_surge: (s) => `${s.eun} 수요가 몰리는 주말 노선에 대형 기재를 우선 배정하고, 평일 노선은 중형기로 돌려 좌석 공급을 조절하고 있다.`,
  air_fuel_cost_spike: (s) => `${s.eun} 예약률이 낮은 일부 증편 노선의 운항 횟수를 줄이는 방안을 검토하고 있지만, 공항 슬롯 반납 문제로 즉시 감편하기는 어렵다.`,
  cargo_yield_boom: (s) => `전세기 계약은 일정 물량을 보장하는 조건이어서 실제 화물이 덜 실리더라도 ${s.eun} 계약된 운임을 받는다.`,
  lease_maintenance_cost_surge: (s) => `${s.eun} 정비 기간 동안 일부 노선을 다른 기재로 대체 운항하기로 했지만, 대체 기재를 확보하려면 추가 임차료가 들 수 있다.`,
  bio_a_patent_milestone: (s) => `${s.eun} 수령한 기술료를 후속 전임상 시험 비용에 우선 투입할 계획이다.`,
  bio_a_rd_cost_expand: (s) => `위탁생산 비용은 시료 생산이 끝나는 시점에 일괄 정산되는 조건이어서 ${s.n}의 연구개발비 지출이 올해 하반기에 몰려 있다.`,
  bio_b_cmo_batch_approved: (s) => `${s.eun} 초도 물량 이후 연간 공급 물량을 확정하는 후속 계약 협의도 함께 진행하고 있다.`,
  bio_b_facility_revalidation: (s) => `${s.eun} 보완이 필요한 충전 구역의 설비 일부를 교체하기로 했으며, 교체 작업 동안 해당 라인 가동이 멈춘다.`
};

function extendSingleFreeArticle(article, eventKey) {
  applyExtension(article, resolveSentence(SINGLE_FREE_EXT[eventKey], null));
}

function extendSinglePaidArticle(article, outcomeId) {
  applyExtension(article, resolveSentence(SINGLE_PAID_EXT[outcomeId], article && article.stockId));
}

/* ---------------------------------------------------------------------------
 * 2. 장기 사건 (단계: first / mid / extra / final)
 *    - 선택형 단서: schedule / risk, 단일 단서(extra 단계): pos / neg
 * ------------------------------------------------------------------------- */
const ARC_EXT = {
  bio: {
    free: {
      first: '업계에서는 초기 임상 단계의 핵심을 약효보다 안전성 확인에 두고 있어, 대상자 투여 후 간 수치와 이상반응 보고 결과가 첫 번째 관문으로 꼽힌다.',
      mid: '학회 발표는 전체 참여자가 아닌 일부 투여군의 중간 결과를 먼저 공개하는 형식이어서, 이후 전체 집단 분석에서 결과가 달라질 수 있다는 점도 함께 거론된다.',
      extra: '다국가 임상은 국가별 승인 일정과 환자 등록 속도가 달라, 한 지역에서 모집이 늦어지면 전체 일정이 함께 밀리는 구조다.',
      final: '데이터 잠금 이후에는 결과를 수정할 수 없고, 통계 분석과 외부 검증을 거쳐 최종 결과가 한 번에 공개된다.'
    },
    paid: {
      obesity: {
        first: {
          schedule: (s) => `${s.eun} 투여 대상자 모집을 국내 임상기관 세 곳에서 동시에 진행하고 있으며, 첫 투여군의 관찰 기간은 약 12주로 정해졌다.`,
          risk: (s) => `위탁생산 업체와의 계약은 시료 순도 기준을 맞추지 못하면 재합성 비용을 ${s.ga} 부담하는 조건으로 체결된 것으로 알려졌다.`
        },
        mid: {
          schedule: (s) => `${s.eun} 학회 발표용 자료를 상반기 중 외부 통계기관에 맡겨 분석을 마무리할 예정이다.`,
          risk: () => '규제 당국은 이탈률이 일정 수준을 넘으면 투여 용량과 관찰 기간을 다시 설정한 수정 계획서를 요구할 수 있다.'
        },
        extra: {
          pos: (s) => `${s.eun} 모집이 끝난 지역의 임상기관 일부를 정리해 운영비를 줄이고, 남은 기관에서 추적 관찰을 이어갈 계획이다.`,
          neg: () => '추가 개설된 사이트는 첫 환자 등록까지 수개월이 걸려, 운영비 지출 대비 모집 효과가 나타나는 시점은 내년 이후로 보인다.'
        },
        final: {
          schedule: (s) => `${s.eun} 결과 발표 직후 파트너사와 계약 조건을 확정할 수 있도록 계약서 초안 검토를 미리 진행하고 있다.`,
          risk: () => '파트너사는 전체 집단 결과가 기준에 못 미치면 계약 규모를 줄이거나 조건을 다시 협상할 수 있는 권리를 계약안에 포함한 것으로 알려졌다.'
        }
      },
      vaccine: {
        first: {
          schedule: (s) => `${s.eun} 설비 반입 이후 시험 생산을 세 차례 반복해 품질이 균일한지 확인한 뒤 임상용 시료 생산에 들어갈 계획이다.`,
          risk: () => '설비 선급금은 계약을 해지하면 일부만 돌려받을 수 있는 조건이어서, 일정이 바뀌어도 이미 낸 비용을 회수하기 어렵다.'
        },
        mid: {
          schedule: (s) => `추가 보관 시험은 최소 6개월 이상의 실온·냉장 보관 데이터를 요구하고 있어, ${s.eun} 연말까지 데이터 수집을 이어가야 한다.`,
          risk: () => '안정제 성분을 바꾸면 기존에 확보한 일부 안전성 시험 결과도 다시 확인해야 할 수 있어 검증 범위가 넓어질 수 있다.'
        },
        extra: {
          pos: (s) => `${s.eun} 실사 통과 이후 본허가 심사에 필요한 공정 자료를 정리해 다음 단계 제출 일정을 준비하고 있다.`,
          neg: () => '재검증 기간 동안 해당 라인 인력은 다른 시험 업무로 재배치됐지만, 설비 유지비는 그대로 발생하고 있다.'
        },
        final: {
          schedule: () => '심의위원회는 서류 검토와 현장 실사 결과를 함께 보고 판단하며, 추가 자료 요청이 나오면 결론 시점이 한 차례 더 미뤄질 수 있다.',
          risk: () => '불순물 기준을 맞추기 위한 정제 공정 추가 개선에는 별도 설비 투자가 필요해, 재검증 판정을 받으면 비용과 시간이 함께 늘어난다.'
        }
      }
    }
  },
  ship: {
    free: {
      first: '대형 선박 발주는 의향서 교환 이후에도 기술 사양 검토와 금융 보증 확보를 거쳐 본계약까지 1~2년이 걸리는 경우가 흔하다.',
      mid: '선수금 환급보증은 조선사가 배를 제때 인도하지 못할 경우 선주가 낸 선수금을 돌려받도록 금융기관이 보증하는 제도로, 발주 규모가 클수록 필요한 보증 한도도 커진다.',
      extra: '친환경 연료 선박은 연료 탱크와 엔진 계통 설계가 기존 선박보다 복잡해 선급 승인 기간도 더 길게 잡히는 편이다.',
      final: '선주 측 이사회는 선가, 인도 일정, 옵션 물량, 금융 조건을 한꺼번에 검토해 승인 여부를 결정한다.'
    },
    paid: {
      a_ship: {
        first: {
          schedule: (s) => `${s.eun} 올해 안에 선형 설계 도면을 확정해 선주 측에 제출하고, 엔진 제조사와의 사양 협의도 같은 시기에 시작할 예정이다.`,
          risk: () => '특히 경쟁 조선소 일부는 도크 여유를 앞세워 더 빠른 인도 일정을 제안한 것으로 알려져, 선가 외에 인도 시점도 경쟁 조건이 되고 있다.'
        },
        mid: {
          schedule: (s) => `${s.eun} 보증 심사와 별도로 선주 측 기술팀의 현장 실사 일정도 하반기 중으로 조율하고 있다.`,
          risk: (s) => `${s.eun} 국책 금융기관과 민간 은행을 묶은 공동 보증 방안을 타진하고 있지만, 참여 기관과 보증 비율은 아직 정해지지 않았다.`
        },
        extra: {
          pos: (s) => `${s.eun} 배정된 도크에서 다른 선박 건조 일정과 겹치지 않도록 연간 건조 순서를 다시 짰다.`,
          neg: () => '대체 공급처를 찾으려면 선급 인증을 새로 받아야 해, 공급처 변경도 단기간에 해결하기 어려운 상황이다.'
        },
        final: {
          schedule: () => '이사회 상정 전까지 양측 실무진은 옵션 물량의 행사 기한과 인도 순서를 정리하는 작업을 이어간다.',
          risk: (s) => `${s.eun} 협상 결렬에 대비해 비워둔 도크에 투입할 다른 선박 수주를 일부 알아보고 있지만, 단기간에 같은 규모를 채우기는 어렵다.`
        }
      }
    }
  },
  semi: {
    free: {
      first: '반도체 공장 증설은 클린룸 공사, 장비 반입, 시험 가동, 고객 인증을 거쳐 양산까지 보통 2년 이상이 걸린다.',
      mid: '현장 인수 검수는 장비가 고객사 라인에서 요구 성능을 내는지 확인하는 마지막 절차로, 이를 통과해야 장비 대금 잔금이 지급된다.',
      extra: '첨단 패키징은 여러 칩을 하나로 묶어 성능을 높이는 공정으로, 전공정 수율과 별개로 패키징 단계 수율도 따로 관리해야 한다.',
      final: '양산 초기에는 수율이 낮고 감가상각비가 커서, 출하량이 일정 수준을 넘어야 라인 운영 비용을 감당할 수 있다.'
    },
    paid: {
      a_semi: {
        first: {
          schedule: (s) => `${s.eun} 골조 공사가 끝나는 대로 클린룸 내부 공조 설비 설치에 들어가며, 이 작업에만 수개월이 걸릴 것으로 보고 있다.`,
          risk: () => '설비 투자비 중 상당 부분은 장비 발주 시점에 선급금으로 나가며, 공장이 가동되기 전까지는 이 비용을 회수할 매출이 없다.'
        },
        mid: {
          schedule: () => '고객사 품질 인증은 샘플 평가와 신뢰성 시험을 거쳐 통상 수개월이 걸리며, 인증 결과에 따라 양산 물량 배정 규모가 정해진다.',
          risk: (s) => `${s.eun} 발열 문제를 줄이기 위해 적층 공정 조건을 바꾼 시험을 반복하고 있지만, 공정 조건이 확정되기 전까지는 시험용 웨이퍼 소모가 이어진다.`
        },
        extra: {
          pos: (s) => `${s.eun} 통합 테스트 결과를 바탕으로 고객사별 시제품 출하 일정을 다시 정리하고 있다.`,
          neg: (s) => `${s.eun} 대체 기판 공급처 인증을 진행하고 있으나, 인증에는 별도의 신뢰성 시험 기간이 필요하다.`
        },
        final: {
          schedule: (s) => `${s.eun} 양산 전환 직후 첫 분기 출하 물량을 고객사별로 나눠 배정하는 작업도 병행하고 있다.`,
          risk: () => '감가상각은 공장 가동 여부와 관계없이 일정 기간 매 분기 비용으로 반영되기 때문에, 가동률이 낮으면 제품 한 개당 비용이 커진다.'
        }
      },
      b_semi: {
        first: {
          schedule: (s) => `${s.eun} 이번 초도 물량 이후 2차 증설 구역 장비 발주도 별도 입찰로 진행될 예정이어서 추가 수주 협상을 준비하고 있다.`,
          risk: () => '계약서에는 납기를 넘기면 지연 일수에 따라 대금 일부를 깎는 지체상금 조항이 포함돼 있다.'
        },
        mid: {
          schedule: (s) => `${s.eun} 2차 물량 셋업을 위해 현장 엔지니어를 추가 파견했으며, 장비별 셋업 기간은 약 4~6주로 잡혀 있다.`,
          risk: (s) => `검수가 늦어지는 동안 ${s.eun} 현장 엔지니어 인건비와 예비 부품 보관 비용을 계속 부담해야 한다.`
        },
        extra: {
          pos: (s) => `추가 장비는 기존 전공정 장비와 공급 계약 구조가 같아 ${s.eun} 별도 설계 변경 없이 생산할 수 있다.`,
          neg: (s) => `${s.eun} 공백 기간 동안 해외 고객사 영업과 차세대 장비 개발에 인력을 돌리고 있다.`
        },
        final: {
          schedule: () => '유지보수 계약은 보통 장비 대수와 가동 시간에 따라 금액이 정해져, 고객사 라인 가동률이 계약 규모를 좌우한다.',
          risk: (s) => `${s.n}의 매출에서 해당 고객사 비중이 높아, 한 고객사의 투자 결정이 연간 수주 규모에 큰 영향을 준다.`
        }
      }
    }
  }
};

function getArcStageType(step, durationYears) {
  const isFirst = step === 0;
  const isLast = step === durationYears - 1;
  if (isFirst) return 'first';
  if (step === 1 && !isLast) return 'mid';
  if (!isLast) return 'extra';
  return 'final';
}

/**
 * 장기 사건 한 단계의 무료 기사 본문 보강 (문자열 반환)
 */
function extendArcFreeBody(arcType, stageType, body) {
  const sentence = ARC_EXT[arcType] && ARC_EXT[arcType].free[stageType];
  return appendToMiddleParagraph(body, sentence);
}

/**
 * 장기 사건 한 단계의 유료 단서 목록 보강
 * @param {string} arcType 'bio' | 'ship' | 'semi'
 * @param {string} roleKey 바이오: 'obesity' | 'vaccine', 조선·반도체: 종목 ID
 */
function extendArcPaidList(arcType, roleKey, stageType, isPositive, paidList) {
  if (!Array.isArray(paidList)) return;
  const roleMap = ARC_EXT[arcType] && ARC_EXT[arcType].paid[roleKey];
  const stageMap = roleMap && roleMap[stageType];
  for (const art of paidList) {
    const key = art.clueType === 'single' ? (isPositive ? 'pos' : 'neg') : art.clueType;
    const sentence = stageMap ? resolveSentence(stageMap[key], art.stockId) : null;
    applyExtension(art, sentence);
  }
}

module.exports = {
  appendToMiddleParagraph,
  extendSingleFreeArticle,
  extendSinglePaidArticle,
  getArcStageType,
  extendArcFreeBody,
  extendArcPaidList
};
