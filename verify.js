/**
 * 개미광장 (모의 주식 웹게임) - 통합 검증 스크립트
 *
 * 검증 항목:
 * 1. OPENING -> TRADING 전환 전후 무료 기사 5개 및 유료 기사 목록 공개 시점 검증 (세션 조회 & SSE 응답 양쪽 확인)
 * 2. 유료 단서 유형 선택 (일정 단서 vs 사업 리스크 단서):
 *    - 바이오·조선·반도체 장기 사건 진행 연도에 두 유형(schedule / risk) 제공 및 공통 기사 가격 적용 검증
 *    - 일반 종목(엔터·식품·게임·항공) 및 장기 사건 종료 연도에 단일 유료 기사 1개(single) 제공 검증
 *    - 같은 방의 두 참가자가 같은 종목(A조선)에서 각자 다른 유형을 구매하고, 각자 구매한 본문만 열람 가능하며 다른 유형은 lockedBySibling('올해 단서 선택 완료') 상태이고 본문이 숨겨지는지 검증
 *    - 한 참가자가 같은 종목의 두 유형을 연속 또는 동시에(Promise.all) 요청해도 1건만 결제(CHOICE_ALREADY_MADE)되는지 검증
 *    - 새로고침(/api/session) 후 구매 상태 유지 및 다음 해(2012년) 같은 종목 단서 재구매 가능 여부 검증
 * 3. 2020년 최종 정산 '내 투자 복기' 연동 및 엣지 케이스 검증:
 *    - 매수보다 먼저 구매한 선택형 단서(일정 단서 / 사업 리스크 단서)가 실제 구매한 유형으로 복기에 연결되는지 검증
 *    - 같은 해 선매수 후 유료 기사 후행 구매 시 최초 매수의 당시 단서로 표시되지 않고 '당시 확인 가능한 관련 단서 없음'으로 표시되는지 검증
 *    - 전량 매도 후 같은 종목 재매수 시 앞서 청산한 거래와 재매수 거래의 개장 보유 수량 및 복기 문구가 정확히 분리·일치하는지 검증
 *    - 무거래 참가자에게 빈 배열('복기할 거래 내역이 없어요')이 반환되는지 검증
 */

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const CONFIG = require('./config');
const { server, rooms, calculateArticlePrice } = require('./server');
const { generateDynamicScenario } = require('./scenarioData');
const {
  buildArticleFactBrief,
  validateGeneratedArticle,
  checkPredictiveExpressionLeak,
  prewarmScenarioArticles
} = require('./aiArticleService');

function request(method, url, body = null) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost:3000', 'content-type': 'application/json' };

    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    const chunks = [];
    res.writeHead = (code, hdrs) => {
      res.statusCode = code;
      Object.assign(res.headers, hdrs);
    };
    res.write = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const buf = Buffer.concat(chunks);
      let json = null;
      try {
        json = JSON.parse(buf.toString('utf8'));
      } catch (e) {
        // non-json
      }
      resolve({ statusCode: res.statusCode, headers: res.headers, body: buf, json });
    };

    server.emit('request', req, res);

    process.nextTick(() => {
      if (body !== null) {
        req.emit('data', Buffer.from(JSON.stringify(body)));
      }
      req.emit('end');
    });
  });
}

function connectMockSSE({ roomCode, participantId, token }) {
  const req = new EventEmitter();
  req.method = 'GET';
  const qs = new URLSearchParams({ roomCode, participantId, token }).toString();
  req.url = `/api/events?${qs}`;
  req.headers = { host: 'localhost:3000' };

  const events = [];
  const res = new EventEmitter();
  res.writeHead = () => {};
  res.write = (chunk) => {
    const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    for (const line of str.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.type === 'ROOM_STATE') {
            events.push(parsed.payload);
          }
        } catch (e) {
          // ignore
        }
      }
    }
  };
  res.end = () => {};

  server.emit('request', req, res);

  return {
    getLatestState: () => events[events.length - 1] || null,
    close: () => req.emit('close')
  };
}

async function runDetailedGameVerification() {
  // 1. 방 생성 (참가자 3명: 도형, 민지, 현우)
  const createRes = (await request('POST', '/api/rooms/create', {
    nickname: '도형',
    roomName: '단서선택검증방',
    capacity: 3,
    mode: 'friend'
  })).json;
  assert.strictEqual(createRes.ok, true);
  const roomCode = createRes.roomCode;
  const p1 = { roomCode, participantId: createRes.participantId, token: createRes.token };

  const join2 = (await request('POST', '/api/rooms/join', { nickname: '민지', roomCode })).json;
  const p2 = { roomCode, participantId: join2.participantId, token: join2.token };

  const join3 = (await request('POST', '/api/rooms/join', { nickname: '현우', roomCode })).json;
  const p3 = { roomCode, participantId: join3.participantId, token: join3.token };

  // 케이스 1의 '앞선 관련 단서가 전혀 없는 상태'를 확정적으로 검증하기 위해
  // 2011년 무료 기사 5건에서 A엔터(a_enter) 무료 기사가 제외되도록 설정
  const rawRoom = rooms.get(roomCode);
  rawRoom.scenario.articlesByYear[2011].free = rawRoom.scenario.articlesByYear[2011].free.map((f) => {
    if ((f.relatedStockIds || []).includes('a_enter') || f.industry === '엔터') {
      return {
        ...f,
        industry: '식품',
        relatedStockIds: ['a_food'],
        title: '가공식품 원료 공급가 안정화 추세',
        summary: '주요 원곡 수입 단가 안정화로 식품업계 원가율 개선 기대',
        body: '국제 원곡 도매가격이 안정세를 유지하며 식품 가공업체의 원가 부담이 완화될 전망이다.'
      };
    }
    return f;
  });

  const sseP1 = connectMockSSE(p1);
  const sseP2 = connectMockSSE(p2);

  // 2. 게임 시작 -> 튜토리얼 건너뛰기 -> 2010년 첫 거래
  await request('POST', '/api/rooms/start', p1);
  await request('POST', '/api/rooms/ready', p1);
  await request('POST', '/api/rooms/ready', p2);
  await request('POST', '/api/rooms/ready', p3);

  // 3. 2010년 마감 -> 2011년 개장 결과 단계(OPENING)
  await request('POST', '/api/rooms/ready', p1);
  await request('POST', '/api/rooms/ready', p2);
  await request('POST', '/api/rooms/ready', p3);

  const session2011Opening = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p1.participantId}&token=${p1.token}`)).json.state;
  const sse2011Opening = sseP1.getLatestState();
  assert.strictEqual(session2011Opening.room.status, 'OPENING');
  assert.strictEqual(session2011Opening.articlesByYear[2011], undefined);
  assert.strictEqual(sse2011Opening.articlesByYear[2011], undefined);

  // 4. 2011년 거래 단계(TRADING) 진입
  await request('POST', '/api/rooms/ready', p1);
  await request('POST', '/api/rooms/ready', p2);
  await request('POST', '/api/rooms/ready', p3);

  const session2011Trading = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p1.participantId}&token=${p1.token}`)).json.state;
  assert.strictEqual(session2011Trading.room.status, 'TRADING');
  assert.strictEqual(session2011Trading.articlesByYear[2011].free.length, 5);

  const paid2011 = session2011Trading.articlesByYear[2011].paid;
  const commonPrice2011 = session2011Trading.room.currentArticlePrice;

  // =========================================================================
  // [검증 A] 적용 범위 확인:
  // - 장기 사건 진행 종목(A조선, A바이오, B바이오)은 일정 단서(schedule)와 사업 리스크 단서(risk) 2개 제공
  // - 일반 단일 사건 종목(A엔터, A식품 등)은 단일 단서(single) 1개 제공
  // - 모든 단서에 2011년 공통 기사 가격이 적용되고 구매 전에는 body가 숨겨져 있는지 확인
  // =========================================================================
  const shipPaid2011 = paid2011.filter((a) => a.stockId === 'a_ship');
  assert.strictEqual(shipPaid2011.length, 2, '2011년 A조선은 일정 단서와 사업 리스크 단서 2개가 제공되어야 합니다.');
  const shipSchedule = shipPaid2011.find((a) => a.clueType === 'schedule');
  const shipRisk = shipPaid2011.find((a) => a.clueType === 'risk');
  assert.ok(shipSchedule && shipRisk, '일정 단서와 사업 리스크 단서가 모두 존재해야 합니다.');
  assert.strictEqual(shipSchedule.clueTypeLabel, '일정 단서');
  assert.strictEqual(shipRisk.clueTypeLabel, '사업 리스크 단서');
  assert.strictEqual(shipSchedule.price, commonPrice2011);
  assert.strictEqual(shipRisk.price, commonPrice2011);
  assert.strictEqual(shipSchedule.body, undefined, '구매 전에는 일정 단서 본문이 노출되면 안 됩니다.');
  assert.strictEqual(shipRisk.body, undefined, '구매 전에는 사업 리스크 단서 본문이 노출되면 안 됩니다.');
  assert.notStrictEqual(shipSchedule.whatItTells, shipRisk.whatItTells, '두 유형이 알려주는 정보 설명은 서로 달라야 합니다.');

  const foodPaid2011 = paid2011.filter((a) => a.stockId === 'a_food');
  assert.strictEqual(foodPaid2011.length, 1, '일반 사건 종목(A식품)은 기존처럼 유료 기사 1개만 제공되어야 합니다.');
  assert.strictEqual(foodPaid2011[0].hasChoicePair, false);

  // =========================================================================
  // [검증 B] 같은 방의 두 참가자가 같은 종목(A조선)에서 각자 다른 유형을 구매하고
  // 각자 구매한 본문만 볼 수 있는지 확인
  // - 참가자 1(도형): A조선 '일정 단서' 구매
  // - 참가자 2(민지): A조선 '사업 리스크 단서' 구매 -> 이후 A조선 4주 매수
  // =========================================================================
  const buyShipScheduleP1 = (await request('POST', '/api/rooms/buy-article', {
    ...p1,
    year: 2011,
    articleId: 'paid_2011_a_ship_schedule',
    requestId: 'p1_buy_ship_schedule_2011'
  })).json;
  assert.strictEqual(buyShipScheduleP1.ok, true);

  const buyShipRiskP2 = (await request('POST', '/api/rooms/buy-article', {
    ...p2,
    year: 2011,
    articleId: 'paid_2011_a_ship_risk',
    requestId: 'p2_buy_ship_risk_2011'
  })).json;
  assert.strictEqual(buyShipRiskP2.ok, true);

  // 참가자 2(민지)는 사업 리스크 단서를 먼저 구매한 뒤 2011년 A조선 4주 매수 (최종 복기 연동 검증용)
  const ordShipP2 = (await request('POST', '/api/rooms/order', {
    ...p2,
    year: 2011,
    stockId: 'a_ship',
    side: 'BUY',
    quantity: 4,
    requestId: 'p2_buy_ship_after_risk_clue'
  })).json;
  assert.strictEqual(ordShipP2.ok, true);

  // 새로고침(/api/session) 조회로 두 참가자의 권한 및 상태 검증
  const refreshP1 = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p1.participantId}&token=${p1.token}`)).json.state;
  const refreshP2 = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p2.participantId}&token=${p2.token}`)).json.state;

  const p1ShipSchedView = refreshP1.articlesByYear[2011].paid.find((a) => a.id === 'paid_2011_a_ship_schedule');
  const p1ShipRiskView = refreshP1.articlesByYear[2011].paid.find((a) => a.id === 'paid_2011_a_ship_risk');
  assert.strictEqual(p1ShipSchedView.purchased, true);
  assert.ok(p1ShipSchedView.body && p1ShipSchedView.body.length > 10, '참가자 1은 본인이 구매한 일정 단서 본문을 볼 수 있어야 합니다.');
  assert.strictEqual(p1ShipRiskView.purchased, false);
  assert.strictEqual(p1ShipRiskView.lockedBySibling, true, '참가자 1에게 선택하지 않은 사업 리스크 단서는 lockedBySibling이어야 합니다.');
  assert.strictEqual(p1ShipRiskView.canPurchase, false);
  assert.strictEqual(p1ShipRiskView.body, undefined, '참가자 1에게 참가자 2가 구매한 사업 리스크 단서 본문이 노출되면 안 됩니다.');

  const p2ShipSchedView = refreshP2.articlesByYear[2011].paid.find((a) => a.id === 'paid_2011_a_ship_schedule');
  const p2ShipRiskView = refreshP2.articlesByYear[2011].paid.find((a) => a.id === 'paid_2011_a_ship_risk');
  assert.strictEqual(p2ShipRiskView.purchased, true);
  assert.ok(p2ShipRiskView.body && p2ShipRiskView.body.length > 10, '참가자 2는 본인이 구매한 사업 리스크 단서 본문을 볼 수 있어야 합니다.');
  assert.strictEqual(p2ShipSchedView.purchased, false);
  assert.strictEqual(p2ShipSchedView.lockedBySibling, true, '참가자 2에게 선택하지 않은 일정 단서는 lockedBySibling이어야 합니다.');
  assert.strictEqual(p2ShipSchedView.canPurchase, false);
  assert.strictEqual(p2ShipSchedView.body, undefined, '참가자 2에게 참가자 1이 구매한 일정 단서 본문이 노출되면 안 됩니다.');
  assert.notStrictEqual(p1ShipSchedView.body, p2ShipRiskView.body, '일정 단서 본문과 사업 리스크 단서 본문은 서로 다른 사실이어야 합니다.');

  // =========================================================================
  // [검증 C] 한 참가자가 같은 종목의 두 유형을 연속 또는 동시에 요청해도 한 번만 결제되는지 확인
  // =========================================================================
  // C-1: 연속 요청 (이미 일정 단서를 산 참가자 1이 사업 리스크 단서 추가 구매 시도)
  const cashBeforeRetryP1 = refreshP1.me.cash;
  const sequentialSecondTry = (await request('POST', '/api/rooms/buy-article', {
    ...p1,
    year: 2011,
    articleId: 'paid_2011_a_ship_risk',
    requestId: 'p1_try_buy_second_type_ship'
  })).json;
  assert.strictEqual(sequentialSecondTry.ok, false);
  assert.strictEqual(sequentialSecondTry.code, 'CHOICE_ALREADY_MADE');

  const afterRetryP1 = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p1.participantId}&token=${p1.token}`)).json.state;
  assert.strictEqual(afterRetryP1.me.cash, cashBeforeRetryP1, '두 번째 유형 구매 시도 시 현금이 차감되면 안 됩니다.');

  // C-2: 동시 요청 (참가자 1이 A바이오의 일정 단서와 사업 리스크 단서를 Promise.all로 동시에 요청)
  const cashBeforeConcurrentP1 = afterRetryP1.me.cash;
  const [concRes1, concRes2] = await Promise.all([
    request('POST', '/api/rooms/buy-article', {
      ...p1,
      year: 2011,
      articleId: 'paid_2011_a_bio_schedule',
      requestId: 'p1_concurrent_bio_schedule'
    }),
    request('POST', '/api/rooms/buy-article', {
      ...p1,
      year: 2011,
      articleId: 'paid_2011_a_bio_risk',
      requestId: 'p1_concurrent_bio_risk'
    })
  ]);
  const successCount = [concRes1.json, concRes2.json].filter((r) => r.ok === true).length;
  const rejectedCount = [concRes1.json, concRes2.json].filter((r) => r.ok === false && r.code === 'CHOICE_ALREADY_MADE').length;
  assert.strictEqual(successCount, 1, '동시 요청 시 정확히 1건만 결제되어야 합니다.');
  assert.strictEqual(rejectedCount, 1, '동시 요청 중 나머지 1건은 CHOICE_ALREADY_MADE로 거절되어야 합니다.');

  const afterConcurrentP1 = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p1.participantId}&token=${p1.token}`)).json.state;
  assert.strictEqual(
    afterConcurrentP1.me.cash,
    cashBeforeConcurrentP1 - commonPrice2011,
    '동시 요청 시 현금은 정확히 1회만 차감되어야 합니다.'
  );

  // =========================================================================
  // [기존 케이스 1 실행] 2011년 거래에서 참가자 1(도형)이:
  //   1) A엔터 10주를 먼저 매수 (체결 순서가 앞섬)
  //   2) 그 뒤에 A엔터 단일 유료 기사를 구매 (체결 이후 구매)
  // =========================================================================
  const ordP1_EnterFirst = (await request('POST', '/api/rooms/order', {
    ...p1,
    year: 2011,
    stockId: 'a_enter',
    side: 'BUY',
    quantity: 10,
    requestId: 'case1_buy_enter_first'
  })).json;
  assert.strictEqual(ordP1_EnterFirst.ok, true);

  const buyArtP1_EnterAfter = (await request('POST', '/api/rooms/buy-article', {
    ...p1,
    year: 2011,
    articleId: 'paid_2011_a_enter',
    requestId: 'case1_buy_article_after'
  })).json;
  assert.strictEqual(buyArtP1_EnterAfter.ok, true);

  // 참가자 2(민지)는 일반 종목 A식품 단일 유료 기사를 먼저 구매한 뒤 A식품 15주 매수
  const buyFoodP2 = (await request('POST', '/api/rooms/buy-article', {
    ...p2,
    year: 2011,
    articleId: 'paid_2011_a_food',
    requestId: 'p2_buy_food_art_before'
  })).json;
  assert.strictEqual(buyFoodP2.ok, true);
  await request('POST', '/api/rooms/order', {
    ...p2,
    year: 2011,
    stockId: 'a_food',
    side: 'BUY',
    quantity: 15,
    requestId: 'p2_buy_food_after_art'
  });

  // 2011년 마감 -> 2012년 OPENING
  await request('POST', '/api/rooms/ready', p1);
  await request('POST', '/api/rooms/ready', p2);
  await request('POST', '/api/rooms/ready', p3);

  // =========================================================================
  // [검증 D & 케이스 2 실행] 다음 해(2012년 거래) 같은 종목 구매 가능 여부 + 전량 매도 후 재매수
  // =========================================================================
  let nextYearShipBuyResult = null;
  for (let yr = 2012; yr <= 2019; yr++) {
    await request('POST', '/api/rooms/ready', p1);
    await request('POST', '/api/rooms/ready', p2);
    await request('POST', '/api/rooms/ready', p3); // TRADING 진입

    if (yr === 2012) {
      // 2011년에 A조선 일정 단서를 샀던 참가자 1이 2012년에는 A조선의 '사업 리스크 단서'를 정상 구매할 수 있는지 검증
      nextYearShipBuyResult = (await request('POST', '/api/rooms/buy-article', {
        ...p1,
        year: 2012,
        articleId: 'paid_2012_a_ship_risk',
        requestId: 'p1_buy_2012_ship_risk'
      })).json;
      assert.strictEqual(nextYearShipBuyResult.ok, true, '다음 해(2012년)에는 같은 종목(A조선)의 유료 단서를 다시 구매할 수 있어야 합니다.');

      // 1) A조선 5주 매수 (2012년 사업 리스크 단서 구매 이후 매수)
      const b1 = (await request('POST', '/api/rooms/order', {
        ...p1,
        year: 2012,
        stockId: 'a_ship',
        side: 'BUY',
        quantity: 5,
        requestId: 'case2_ship_buy_5'
      })).json;
      assert.strictEqual(b1.ok, true);

      // 2) A조선 5주 전량 매도
      const s1 = (await request('POST', '/api/rooms/order', {
        ...p1,
        year: 2012,
        stockId: 'a_ship',
        side: 'SELL',
        quantity: 5,
        requestId: 'case2_ship_sell_5'
      })).json;
      assert.strictEqual(s1.ok, true);

      // 3) A조선 3주 재매수
      const b2 = (await request('POST', '/api/rooms/order', {
        ...p1,
        year: 2012,
        stockId: 'a_ship',
        side: 'BUY',
        quantity: 3,
        requestId: 'case2_ship_rebuy_3'
      })).json;
      assert.strictEqual(b2.ok, true);
    }

    await request('POST', '/api/rooms/ready', p1);
    await request('POST', '/api/rooms/ready', p2);
    await request('POST', '/api/rooms/ready', p3); // 다음 OPENING / 2020 SETTLEMENT
  }

  // 2020년 최종 정산 결과 조회
  const finalP1 = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p1.participantId}&token=${p1.token}`)).json.state;
  const finalP2 = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p2.participantId}&token=${p2.token}`)).json.state;
  const finalP3 = (await request('GET', `/api/session?roomCode=${roomCode}&participantId=${p3.participantId}&token=${p3.token}`)).json.state;

  const reviewsP1 = finalP1.settlementResult.myTradeReviews;
  const reviewsP2 = finalP2.settlementResult.myTradeReviews;
  const reviewsP3 = finalP3.settlementResult.myTradeReviews;

  // [케이스 1 검증] 매수 뒤 구매한 유료 기사는 당시 단서에서 제외
  const enterReview = reviewsP1.find((r) => r.stockId === 'a_enter');
  assert.ok(enterReview, 'A엔터 매수 복기가 존재해야 합니다.');
  assert.notStrictEqual(enterReview.clueSourceType, 'PURCHASED_PAID');
  assert.strictEqual(enterReview.clueSourceLabel, '당시 확인 가능한 관련 단서 없음');

  // [케이스 2 & 유료 단서 유형 복기 연동 검증]
  // 참가자 1은 2012년에 'A조선 · 사업 리스크 단서'를 먼저 구매한 뒤 A조선을 매수했으므로
  // 복기의 당시 단서에 'A조선 · 사업 리스크 단서'(purchasedClueType: 'risk')가 정확히 연결되어야 함
  const shipReviews = reviewsP1.filter((r) => r.stockId === 'a_ship');
  const liquidatedShipReview = shipReviews.find((r) => r.quantity === 5 && !r.isRebuy);
  const reboughtShipReview = shipReviews.find((r) => r.quantity === 3 && r.isRebuy);

  assert.ok(liquidatedShipReview && reboughtShipReview);
  assert.strictEqual(reboughtShipReview.clueSourceType, 'PURCHASED_PAID');
  assert.strictEqual(reboughtShipReview.purchasedClueType, 'risk');
  assert.ok(
    reboughtShipReview.clueSourceLabel.includes('A조선 · 사업 리스크 단서'),
    `복기에 실제 구매한 단서 유형(A조선 · 사업 리스크 단서)이 표시되어야 합니다 (실제: ${reboughtShipReview.clueSourceLabel})`
  );

  for (const out of liquidatedShipReview.outcomes) {
    assert.strictEqual(out.soldOutBeforeOpening, true);
    assert.strictEqual(out.heldQtyAtOpening, 0);
    assert.ok(!out.text.includes('평가액 +') && !out.text.includes('평가액 −'));
  }

  assert.strictEqual(reboughtShipReview.outcomes[0].soldOutBeforeOpening, false);
  assert.strictEqual(reboughtShipReview.outcomes[0].heldQtyAtOpening, 3);
  assert.ok(reboughtShipReview.outcomes[0].text.includes('보유 3주 평가액'));

  // 참가자 2(민지)의 A조선 4주 매수 복기에도 2011년에 먼저 구매한 'A조선 · 사업 리스크 단서'가 연결되고,
  // 일반 종목 A식품 15주 매수 복기에는 단일 유료 기사가 연결되어야 함
  const shipReviewP2 = reviewsP2.find((r) => r.stockId === 'a_ship');
  assert.ok(shipReviewP2);
  assert.strictEqual(shipReviewP2.clueSourceType, 'PURCHASED_PAID');
  assert.strictEqual(shipReviewP2.purchasedClueType, 'risk');
  assert.ok(shipReviewP2.clueSourceLabel.includes('A조선 · 사업 리스크 단서'));

  const foodReviewP2 = reviewsP2.find((r) => r.stockId === 'a_food');
  assert.ok(foodReviewP2);
  assert.strictEqual(foodReviewP2.clueSourceType, 'PURCHASED_PAID');
  assert.strictEqual(foodReviewP2.purchasedClueType, 'single');

  // [케이스 3 검증] 무거래 참가자
  assert.strictEqual(reviewsP3.length, 0);

  sseP1.close();
  sseP2.close();

  return {
    roomCode,
    rawRoom,
    p1ShipSchedView,
    p2ShipRiskView,
    sequentialSecondTry,
    enterReview,
    liquidatedShipReview,
    reboughtShipReview,
    shipReviewP2,
    foodReviewP2,
    reviewsP3
  };
}

/**
 * 실제 새 게임에서 생성된 바이오·조선·반도체 유료 단서 쌍의 내용 분리·미리보기·공개 범위 정밀 검증
 */
function verifyClueContentAndDisclosureScope(rawRoom) {
  const { scenario } = rawRoom;
  const allPairs = [];

  for (let y = 2011; y <= 2019; y++) {
    const yearData = scenario.articlesByYear[y];
    if (!yearData) continue;

    // 1. 숨겨진 회사 무료 기사(바이오)에 회사명이 노출되지 않는지 검증
    for (const f of yearData.free || []) {
      if (f.hideCompanyName) {
        const text = `${f.title} ${f.summary} ${f.body}`;
        assert.ok(
          !text.includes('A바이오') && !text.includes('B바이오') && !text.includes('A 바이오') && !text.includes('B 바이오'),
          `${y}년 숨겨진 회사 무료 기사에 회사명이 노출되면 안 됩니다.`
        );
      }
    }

    // 2. 바이오 선택형 단서가 있는 해에는 A바이오와 B바이오의 구매 전 미리보기(whatItTells)가 완전히 동일한 중립 문구인지 검증
    const bioPaid = (yearData.paid || []).filter((p) => p.industry === '바이오' && p.hasChoicePair);
    if (bioPaid.length === 4) {
      const aSched = bioPaid.find((p) => p.stockId === 'a_bio' && p.clueType === 'schedule');
      const bSched = bioPaid.find((p) => p.stockId === 'b_bio' && p.clueType === 'schedule');
      const aRisk = bioPaid.find((p) => p.stockId === 'a_bio' && p.clueType === 'risk');
      const bRisk = bioPaid.find((p) => p.stockId === 'b_bio' && p.clueType === 'risk');
      assert.strictEqual(
        aSched.whatItTells,
        bSched.whatItTells,
        `${y}년 A바이오와 B바이오의 일정 단서 구매 전 미리보기(whatItTells)는 동일해야 숨겨진 회사가 드러나지 않습니다.`
      );
      assert.strictEqual(
        aRisk.whatItTells,
        bRisk.whatItTells,
        `${y}년 A바이오와 B바이오의 사업 리스크 단서 구매 전 미리보기(whatItTells)는 동일해야 숨겨진 회사가 드러나지 않습니다.`
      );
      assert.strictEqual(
        aSched.subtitle.replace('A바이오', ''),
        bSched.subtitle.replace('B바이오', ''),
        `${y}년 A바이오와 B바이오의 일정 단서 subtitle 템플릿은 동일해야 합니다.`
      );
      assert.strictEqual(
        aRisk.subtitle.replace('A바이오', ''),
        bRisk.subtitle.replace('B바이오', ''),
        `${y}년 A바이오와 B바이오의 사업 리스크 단서 subtitle 템플릿은 동일해야 합니다.`
      );
    }

    // 3. 종목별 선택형 단서 쌍 추출 및 본문 중복/미확정 결말/미래 등락률 노출 검사
    const byGroup = new Map();
    for (const p of yearData.paid || []) {
      if (!p.hasChoicePair) continue;
      if (!byGroup.has(p.choiceGroup)) byGroup.set(p.choiceGroup, []);
      byGroup.get(p.choiceGroup).push(p);
    }

    for (const [, pair] of byGroup.entries()) {
      assert.strictEqual(pair.length, 2, '선택형 단서 그룹은 항상 일정 단서와 사업 리스크 단서 2개여야 합니다.');
      const sched = pair.find((p) => p.clueType === 'schedule');
      const risk = pair.find((p) => p.clueType === 'risk');
      assert.ok(sched && risk);

      // (a) 두 본문의 문장이 서로 겹치지 않는지 검증
      const schedSentences = sched.body.split(/(?<=[.!?다])\s+/).map((s) => s.trim()).filter(Boolean);
      const riskSentences = risk.body.split(/(?<=[.!?다])\s+/).map((s) => s.trim()).filter(Boolean);
      for (const s of schedSentences) {
        assert.ok(
          !riskSentences.includes(s),
          `[${y}년 ${sched.stockName}] 일정 단서와 사업 리스크 단서에 중복 문장이 있으면 안 됩니다: "${s}"`
        );
      }

      // (b) 미리보기와 본문에 미래 확정 등락률(+900% 등)이나 숨겨진 비만 신약 프로젝트명이 직접 노출되지 않는지 검증
      const combinedPairText = [
        sched.whatItTells, sched.subtitle, sched.postTitle, sched.body, sched.highlightNote,
        risk.whatItTells, risk.subtitle, risk.postTitle, risk.body, risk.highlightNote
      ].join(' ');

      assert.ok(
        !/[+-]\s*\d+(\.\d+)?\s*%/.test(combinedPairText) && !combinedPairText.includes('900%'),
        `[${y}년 ${sched.stockName}] 단서에 미래 확정 등락률이 노출되면 안 됩니다.`
      );
      if (sched.industry === '바이오') {
        assert.ok(
          !combinedPairText.includes('비만 치료제') && !combinedPairText.includes('비만·대사질환 복합 신약') && !combinedPairText.includes('비만·지방간 치료 신약'),
          `[${y}년 ${sched.stockName}] 바이오 유료 단서에 숨겨진 비만 신약 프로젝트명이 직접 노출되면 안 됩니다.`
        );
      }

      allPairs.push({
        scenarioId: scenario.id,
        year: y,
        industry: sched.industry,
        stockId: sched.stockId,
        stockName: sched.stockName,
        arcStageLabel: sched.arcStageLabel,
        schedule: sched,
        risk
      });
    }
  }

  // 4~6년 장기 사건의 추가 중간 단계(step >= 2 && !isLast)가 단일 유료 기사(hasChoicePair: false)로 전환되었는지 검증
  for (const arc of scenario.multiYearArcs || []) {
    if (arc.durationYears >= 4) {
      for (let step = 2; step < arc.durationYears - 1; step++) {
        const y = arc.startYear + step;
        const targetId = arc.targetStockIds[0];
        const paidForStock = (scenario.articlesByYear[y].paid || []).filter((p) => p.stockId === targetId);
        assert.strictEqual(
          paidForStock.length,
          1,
          `${arc.industry} ${arc.durationYears}년 장기 사건의 추가 중간 단계(${y}년, ${step + 1}/${arc.durationYears}단계)는 중복 방지를 위해 단일 기사 1개로 제공되어야 합니다.`
        );
        assert.strictEqual(paidForStock[0].hasChoicePair, false);
      }
    }
  }

  const bioAll = allPairs.filter((p) => p.industry === '바이오');
  const bioPairs = [
    bioAll[0],
    bioAll.find((p) => p.year !== bioAll[0].year && p.stockId === bioAll[0].stockId) || bioAll[1]
  ];
  const shipPairs = allPairs.filter((p) => p.industry === '조선').slice(0, 2);
  const semiAll = allPairs.filter((p) => p.industry === '반도체');
  const semiPairs = [
    semiAll[0],
    semiAll.find((p) => p.year !== semiAll[0].year && p.stockId === semiAll[0].stockId) || semiAll[1]
  ];

  assert.strictEqual(bioPairs.length, 2);
  assert.strictEqual(shipPairs.length, 2);
  assert.strictEqual(semiPairs.length, 2);

  return {
    scenarioId: scenario.id,
    multiYearArcs: scenario.multiYearArcs,
    sampledPairs: [...bioPairs, ...shipPairs, ...semiPairs]
  };
}

/**
 * 배포본 QA 3개 항목 중 서버·상태 통합 회귀 검증:
 * - QA 2: 다시 플레이할 때 이전 판 채팅 구분 (3인 친구방 전체 채팅 + 1:1 채팅 판별 구분 및 제3자 1:1 열람 차단)
 * - QA 3: 주문·기사 결제의 중복 처리 범위 수정 (참가자 ID + 요청 종류 + 요청 ID 기준 멱등성 및 실제 현금·보유수량·열람권한 검증)
 */
async function runQaRegressionVerification() {
  // 1. 3인 친구방 생성 및 참가 (도형, 민지, 현우)
  const createRes = await request('POST', '/api/rooms/create', {
    nickname: '도형',
    roomName: 'QA회귀검증방',
    capacity: 4,
    mode: 'friend'
  });
  assert.strictEqual(createRes.statusCode, 200);
  assert.strictEqual(createRes.json.ok, true);
  const roomCode = createRes.json.roomCode;

  const p1 = {
    roomCode,
    participantId: createRes.json.participantId,
    token: createRes.json.token,
    nickname: '도형'
  };

  const join2 = await request('POST', '/api/rooms/join', { nickname: '민지', roomCode });
  assert.strictEqual(join2.statusCode, 200);
  const p2 = {
    roomCode,
    participantId: join2.json.participantId,
    token: join2.json.token,
    nickname: '민지'
  };

  const join3 = await request('POST', '/api/rooms/join', { nickname: '현우', roomCode });
  assert.strictEqual(join3.statusCode, 200);
  const p3 = {
    roomCode,
    participantId: join3.json.participantId,
    token: join3.json.token,
    nickname: '현우'
  };

  const start1 = await request('POST', '/api/rooms/start', p1);
  assert.strictEqual(start1.statusCode, 200);

  // 1번째 판(gameNumber: 1)에서 전체 채팅 및 도형<->민지 1:1 채팅 전송
  const g1Pub = await request('POST', '/api/rooms/chat', {
    ...p1,
    targetId: null,
    text: '1판 전체 채팅: 첫 판 시작합니다!'
  });
  assert.strictEqual(g1Pub.statusCode, 200);
  assert.strictEqual(g1Pub.json.message.gameNumber, 1);

  const g1Dm1 = await request('POST', '/api/rooms/chat', {
    ...p1,
    targetId: p2.participantId,
    text: '1판 1:1 비밀: 민지님에게만 보내는 첫 판 귓속말'
  });
  assert.strictEqual(g1Dm1.statusCode, 200);
  assert.strictEqual(g1Dm1.json.message.gameNumber, 1);

  const g1Dm2 = await request('POST', '/api/rooms/chat', {
    ...p2,
    targetId: p1.participantId,
    text: '1판 1:1 답장: 도형님 확인했어요!'
  });
  assert.strictEqual(g1Dm2.statusCode, 200);
  assert.strictEqual(g1Dm2.json.message.gameNumber, 1);

  // 다시 플레이(/api/rooms/reset) 호출하여 2번째 판(gameNumber: 2) 진입
  const resetRes = await request('POST', '/api/rooms/reset', p1);
  assert.strictEqual(resetRes.statusCode, 200);
  assert.strictEqual(resetRes.json.ok, true);
  assert.strictEqual(resetRes.json.state.room.gameNumber, 2);

  // 2번째 판(gameNumber: 2)에서 새 전체 채팅 및 새 1:1 채팅 전송
  const g2Pub = await request('POST', '/api/rooms/chat', {
    ...p3,
    targetId: null,
    text: '2판 전체 채팅: 새 판에서는 현우가 인사합니다!'
  });
  assert.strictEqual(g2Pub.statusCode, 200);
  assert.strictEqual(g2Pub.json.message.gameNumber, 2);

  const g2Dm = await request('POST', '/api/rooms/chat', {
    ...p1,
    targetId: p2.participantId,
    text: '2판 1:1 비밀: 새 판에서 민지님과 나누는 귓속말'
  });
  assert.strictEqual(g2Dm.statusCode, 200);
  assert.strictEqual(g2Dm.json.message.gameNumber, 2);

  // 각 참가자별 세션 상태 조회로 이전 판 / 현재 판 분리 및 제3자(현우) 1:1 격리 검증
  const getParticipantState = async (p) => {
    const qs = new URLSearchParams({
      roomCode: p.roomCode,
      participantId: p.participantId,
      token: p.token
    });
    const res = await request('GET', `/api/session?${qs.toString()}`);
    assert.strictEqual(res.statusCode, 200);
    return res.json.state;
  };

  const stateP1 = await getParticipantState(p1);
  const stateP2 = await getParticipantState(p2);
  const stateP3 = await getParticipantState(p3);

  // 도형(p1)과 민지(p2): 현재 판 대화 2건(2판 전체 1 + 2판 1:1 1), 이전 판 대화 3건(1판 전체 1 + 1판 1:1 2)
  assert.strictEqual(stateP1.currentGameChats.length, 2, '새 판의 현재 판 대화에는 2판 메시지만 포함되어야 합니다.');
  assert.strictEqual(stateP1.previousGameChats.length, 3, '이전 판 대화에는 1판 메시지 3건이 분리되어 유지되어야 합니다.');
  assert.ok(stateP1.currentGameChats.every((m) => m.gameNumber === 2 && m.isCurrentGame === true));
  assert.ok(stateP1.previousGameChats.every((m) => m.gameNumber === 1 && m.isCurrentGame === false));

  assert.strictEqual(stateP2.currentGameChats.length, 2);
  assert.strictEqual(stateP2.previousGameChats.length, 3);

  // 제3자 현우(p3): 현재 판 대화 1건(2판 전체 1), 이전 판 대화 1건(1판 전체 1) -> 1:1 메시지는 현재 판/이전 판 어디에도 노출되지 않아야 함
  assert.strictEqual(stateP3.currentGameChats.length, 1, '현우의 현재 판 대화에는 2판 전체 채팅 1건만 보여야 합니다.');
  assert.strictEqual(stateP3.previousGameChats.length, 1, '현우가 이전 판 대화를 열어도 1판 전체 채팅 1건만 보이고 제3자 1:1 대화는 절대 노출되면 안 됩니다.');
  assert.strictEqual(stateP3.chats.length, 2);
  assert.ok(
    stateP3.chats.every((m) => m.targetId === null),
    '제3자(현우)에게는 이전 판과 현재 판 모두 다른 참가자 간 1:1 메시지가 전달되면 안 됩니다.'
  );

  // ---------------------------------------------------------------------------
  // QA 3: 주문·기사 결제의 중복 처리 범위 검증 (참가자 ID + 요청 종류 + 요청 ID)
  // ---------------------------------------------------------------------------
  // 2번째 판 게임 시작 -> 튜토리얼 완료(2010 거래) -> 2010 마감(2011 개장) -> 2011 거래 시작
  await request('POST', '/api/rooms/start', p1);
  for (const p of [p1, p2, p3]) {
    await request('POST', '/api/rooms/ready', { ...p, ready: true }); // TUTORIAL -> 2010 TRADING
  }
  for (const p of [p1, p2, p3]) {
    await request('POST', '/api/rooms/ready', { ...p, ready: true }); // 2010 TRADING -> 2011 OPENING
  }
  for (const p of [p1, p2, p3]) {
    await request('POST', '/api/rooms/ready', { ...p, ready: true }); // 2011 OPENING -> 2011 TRADING
  }

  const s1Before = await getParticipantState(p1);
  const s2Before = await getParticipantState(p2);
  assert.strictEqual(s1Before.room.status, 'TRADING');
  assert.strictEqual(s1Before.room.currentYear, 2011);

  const cash1Start = s1Before.me.cash;
  const cash2Start = s2Before.me.cash;
  const artPrice2011 = s1Before.room.currentArticlePrice;
  const aEnterPrice = s1Before.stocks.find((s) => s.id === 'a_enter').currentPrice;
  const bEnterPrice = s1Before.stocks.find((s) => s.id === 'b_enter').currentPrice;

  const paid2011 = s1Before.articlesByYear[2011].paid;
  const aEnterPaid = paid2011.find((a) => a.stockId === 'a_enter');
  const bEnterPaid = paid2011.find((a) => a.stockId === 'b_enter');
  assert.ok(aEnterPaid && bEnterPaid);

  // Case 3-A: 서로 다른 참가자(도형, 민지)가 동일한 requestId('SHARED_ORDER_REQ_ID')로 각각 주문 전송
  const sharedOrderReqId = 'SHARED_ORDER_REQ_ID';
  const ordP1 = await request('POST', '/api/rooms/order', {
    ...p1,
    year: 2011,
    stockId: 'a_enter',
    side: 'BUY',
    quantity: 2,
    requestId: sharedOrderReqId
  });
  const ordP2 = await request('POST', '/api/rooms/order', {
    ...p2,
    year: 2011,
    stockId: 'a_enter',
    side: 'BUY',
    quantity: 4,
    requestId: sharedOrderReqId
  });

  assert.strictEqual(ordP1.statusCode, 200);
  assert.strictEqual(ordP2.statusCode, 200);
  assert.strictEqual(ordP1.json.ok, true);
  assert.strictEqual(ordP2.json.ok, true);
  assert.strictEqual(ordP1.json.order.participantId, p1.participantId);
  assert.strictEqual(ordP2.json.order.participantId, p2.participantId);
  assert.strictEqual(ordP1.json.order.quantity, 2);
  assert.strictEqual(ordP2.json.order.quantity, 4);

  // Case 3-B: 서로 다른 참가자(도형, 민지)가 동일한 requestId('SHARED_ARTICLE_REQ_ID')로 유료 기사 구매
  const sharedArticleReqId = 'SHARED_ARTICLE_REQ_ID';
  const buyArtP1 = await request('POST', '/api/rooms/buy-article', {
    ...p1,
    year: 2011,
    articleId: aEnterPaid.id,
    requestId: sharedArticleReqId
  });
  const buyArtP2 = await request('POST', '/api/rooms/buy-article', {
    ...p2,
    year: 2011,
    articleId: aEnterPaid.id,
    requestId: sharedArticleReqId
  });

  assert.strictEqual(buyArtP1.statusCode, 200);
  assert.strictEqual(buyArtP2.statusCode, 200);
  assert.strictEqual(buyArtP1.json.ok, true);
  assert.strictEqual(buyArtP2.json.ok, true);
  assert.strictEqual(buyArtP1.json.alreadyOwned, false);
  assert.strictEqual(buyArtP2.json.alreadyOwned, false);

  // Case 3-C: 같은 참가자(도형)가 주문과 기사 구매에 동일한 requestId('SAME_USER_ORDER_AND_ARTICLE_ID')를 사용
  const crossTypeReqId = 'SAME_USER_ORDER_AND_ARTICLE_ID';
  const crossOrdP1 = await request('POST', '/api/rooms/order', {
    ...p1,
    year: 2011,
    stockId: 'b_enter',
    side: 'BUY',
    quantity: 3,
    requestId: crossTypeReqId
  });
  const crossArtP1 = await request('POST', '/api/rooms/buy-article', {
    ...p1,
    year: 2011,
    articleId: bEnterPaid.id,
    requestId: crossTypeReqId
  });

  assert.strictEqual(crossOrdP1.statusCode, 200);
  assert.strictEqual(crossArtP1.statusCode, 200);
  assert.strictEqual(crossOrdP1.json.ok, true);
  assert.strictEqual(crossArtP1.json.ok, true);
  assert.ok(crossOrdP1.json.order && crossOrdP1.json.order.stockId === 'b_enter');
  assert.strictEqual(crossArtP1.json.articleId, bEnterPaid.id);
  assert.strictEqual(crossArtP1.json.alreadyOwned, false);

  // Case 3-D: 같은 참가자(도형)가 같은 주문 및 같은 기사 구매 요청을 재전송하면 한 번만 처리(추가 차감/체결 없음)
  const retryOrdP1 = await request('POST', '/api/rooms/order', {
    ...p1,
    year: 2011,
    stockId: 'b_enter',
    side: 'BUY',
    quantity: 3,
    requestId: crossTypeReqId
  });
  const retryArtP1 = await request('POST', '/api/rooms/buy-article', {
    ...p1,
    year: 2011,
    articleId: bEnterPaid.id,
    requestId: crossTypeReqId
  });
  assert.strictEqual(retryOrdP1.json.order.id, crossOrdP1.json.order.id, '동일 참가자의 동일 주문 재전송은 첫 처리 결과를 반환해야 합니다.');
  assert.strictEqual(retryArtP1.json.payment.id, crossArtP1.json.payment.id, '동일 참가자의 동일 기사 구매 재전송은 첫 결제 결과를 반환해야 합니다.');

  // 실제 현금, 보유 수량, 기사 열람 권한 최종 대조
  const s1After = await getParticipantState(p1);
  const s2After = await getParticipantState(p2);
  const s3After = await getParticipantState(p3);

  const expectedP1Cash = cash1Start - (2 * aEnterPrice) - artPrice2011 - (3 * bEnterPrice) - artPrice2011;
  const expectedP2Cash = cash2Start - (4 * aEnterPrice) - artPrice2011;

  assert.strictEqual(s1After.me.cash, expectedP1Cash, '도형의 실제 보유 현금이 주문 2건 + 기사 2건 결제 금액만큼 정확히 차감되어야 합니다.');
  assert.strictEqual(s2After.me.cash, expectedP2Cash, '민지의 실제 보유 현금이 주문 1건 + 기사 1건 결제 금액만큼 정확히 차감되어야 합니다.');

  const p1AEnterQty = s1After.me.holdingsDetail.find((h) => h.stockId === 'a_enter').quantity;
  const p1BEnterQty = s1After.me.holdingsDetail.find((h) => h.stockId === 'b_enter').quantity;
  const p2AEnterQty = s2After.me.holdingsDetail.find((h) => h.stockId === 'a_enter').quantity;
  assert.strictEqual(p1AEnterQty, 2, '도형의 A엔터 실제 보유 수량은 2주여야 합니다.');
  assert.strictEqual(p1BEnterQty, 3, '도형의 B엔터 실제 보유 수량은 3주여야 합니다.');
  assert.strictEqual(p2AEnterQty, 4, '민지의 A엔터 실제 보유 수량은 4주여야 합니다.');

  const p1AEnterArtView = s1After.articlesByYear[2011].paid.find((a) => a.id === aEnterPaid.id);
  const p1BEnterArtView = s1After.articlesByYear[2011].paid.find((a) => a.id === bEnterPaid.id);
  const p2AEnterArtView = s2After.articlesByYear[2011].paid.find((a) => a.id === aEnterPaid.id);
  const p2BEnterArtView = s2After.articlesByYear[2011].paid.find((a) => a.id === bEnterPaid.id);
  const p3AEnterArtView = s3After.articlesByYear[2011].paid.find((a) => a.id === aEnterPaid.id);

  assert.ok(p1AEnterArtView.purchased && p1AEnterArtView.body, '도형은 A엔터 유료 기사 열람 권한과 본문을 가져야 합니다.');
  assert.ok(p1BEnterArtView.purchased && p1BEnterArtView.body, '도형은 주문과 같은 requestId로 구매한 B엔터 유료 기사 열람 권한과 본문을 가져야 합니다.');
  assert.ok(p2AEnterArtView.purchased && p2AEnterArtView.body, '민지는 도형과 같은 requestId로 구매한 A엔터 유료 기사 열람 권한과 본문을 가져야 합니다.');
  assert.ok(!p2BEnterArtView.purchased && !p2BEnterArtView.body, '민지가 구매하지 않은 B엔터 유료 기사는 본문이 노출되면 안 됩니다.');
  assert.ok(!p3AEnterArtView.purchased && !p3AEnterArtView.body, '현우가 구매하지 않은 유료 기사는 본문이 노출되면 안 됩니다.');

  return {
    p1CurrentChats: stateP1.currentGameChats.length,
    p1PrevChats: stateP1.previousGameChats.length,
    p3CurrentChats: stateP3.currentGameChats.length,
    p3PrevChats: stateP3.previousGameChats.length,
    expectedP1Cash,
    expectedP2Cash,
    p1AEnterQty,
    p1BEnterQty,
    p2AEnterQty
  };
}

async function runVerification() {
  console.log('=== [개미광장] 유료 단서 유형 선택(일정 단서 vs 사업 리스크 단서) 및 내 투자 복기 통합 검증 ===\n');

  const res = await runDetailedGameVerification();
  const contentCheck = verifyClueContentAndDisclosureScope(res.rawRoom);

  console.log(`[통과] 0. 새 게임(${contentCheck.scenarioId}) 업종별(바이오·조선·반도체) 단서 쌍 6개 내용 분리 및 공개 범위 검증:`);
  contentCheck.sampledPairs.forEach((item, idx) => {
    console.log(`\n  [사례 ${idx + 1}] 판 ID: ${item.scenarioId} | ${item.year}년 거래 | ${item.industry} · ${item.stockName} (${item.arcStageLabel})`);
    console.log(`    [일정 단서 (${item.schedule.id})]`);
    console.log(`      - 구매 전 미리보기: [${item.schedule.preTitle}] ${item.schedule.subtitle} | 알려주는 정보: ${item.schedule.whatItTells}`);
    console.log(`      - 구매 후 제목: ${item.schedule.postTitle}`);
    console.log(`      - 구매 후 본문: ${item.schedule.body}`);
    console.log(`      - 핵심 요약: ${item.schedule.highlightNote}`);
    console.log(`    [사업 리스크 단서 (${item.risk.id})]`);
    console.log(`      - 구매 전 미리보기: [${item.risk.preTitle}] ${item.risk.subtitle} | 알려주는 정보: ${item.risk.whatItTells}`);
    console.log(`      - 구매 후 제목: ${item.risk.postTitle}`);
    console.log(`      - 구매 후 본문: ${item.risk.body}`);
    console.log(`      - 핵심 요약: ${item.risk.highlightNote}`);
  });

  console.log('\n[통과] 1. 같은 방 두 참가자가 같은 종목(2011년 A조선)에서 서로 다른 단서 유형 구매 및 본문 격리:');
  console.log(`   · 참가자 1(도형) 구매: [${res.p1ShipSchedView.preTitle}] -> "${res.p1ShipSchedView.postTitle}"`);
  console.log(`     본문: ${res.p1ShipSchedView.body}`);
  console.log(`   · 참가자 2(민지) 구매: [${res.p2ShipRiskView.preTitle}] -> "${res.p2ShipRiskView.postTitle}"`);
  console.log(`     본문: ${res.p2ShipRiskView.body}`);

  console.log('\n[통과] 2. 동일 참가자의 같은 종목 두 유형 연속/동시 구매 차단:');
  console.log(`   · 차단 응답 코드: ${res.sequentialSecondTry.code} / 메시지: "${res.sequentialSecondTry.message}"`);

  console.log('\n[통과] 3. 다음 해(2012년) 같은 종목 단서 재구매 및 최종 정산 [내 투자 복기] 단서 유형 연동:');
  console.log(`   · 내 행동: ${res.reboughtShipReview.actionTitle} (${res.reboughtShipReview.actionMeta})`);
  console.log(`   · 당시 단서: ${res.reboughtShipReview.clueSourceLabel}`);
  console.log(`   · 단서 내용: ${res.reboughtShipReview.clueText}`);
  for (const o of res.reboughtShipReview.outcomes) {
    console.log(`   · ${o.label}: ${o.text}`);
  }

  console.log('\n[통과] 4. 선매수 후 유료 기사 후행 구매 시 당시 단서 제외 검증:');
  console.log(`   · ${res.enterReview.actionTitle} -> 당시 단서 · ${res.enterReview.clueSourceLabel}`);

  const hiddenBioBrief = buildArticleFactBrief({
    id: 'test_hidden_bio',
    year: 2012,
    type: 'free',
    industry: '바이오',
    hideCompanyName: true,
    disclosedFacts: ['비만 치료제 임상 2상 중간 결과 일부 집단 개선']
  });
  const leakCheck = validateGeneratedArticle(
    { title: 'A바이오 비만 치료제 임상', body: 'A바이오가 임상을 진행 중이다. 추가 검토가 이어진다.' },
    hiddenBioBrief
  );
  assert.strictEqual(leakCheck.valid, false);

  // 1차 UI 개선(거래 공통 헤더 & 기사 탭 3분할·종목별 한 줄·관련 종목 보기) 정적 및 응답 검증
  const indexRes = await request('GET', '/');
  const appJsRes = await request('GET', '/app.js');
  const cssRes = await request('GET', '/styles.css');
  assert.strictEqual(indexRes.statusCode, 200);
  assert.strictEqual(appJsRes.statusCode, 200);
  assert.strictEqual(cssRes.statusCode, 200);

  const htmlStr = indexRes.body.toString('utf8');
  const jsStr = appJsRes.body.toString('utf8');
  const cssStr = cssRes.body.toString('utf8');

  // (1) 거래 헤더: 현재 연도(top-year-label), 남은 시간(trading-timer-pill), 마감 준비(btn-trading-ready), 거래 가능 현금(top-available-cash)만 배치되고,
  //     총자산(pf-total-assets)과 직전 순위(pf-my-rank)는 '내 투자'(market-portfolio-col)로 이동했는지 확인
  assert.ok(htmlStr.includes('id="top-year-label"'));
  assert.ok(htmlStr.includes('id="trading-timer-pill"'));
  assert.ok(htmlStr.includes('id="btn-trading-ready"'));
  assert.ok(htmlStr.includes('id="top-available-cash"'));
  assert.ok(!htmlStr.includes('id="top-my-rank"'), '직전 순위는 상단 거래 헤더가 아닌 내 투자에 배치되어야 합니다.');
  assert.ok(!htmlStr.includes('id="top-total-assets"'), '총자산은 상단 거래 헤더가 아닌 내 투자에 배치되어야 합니다.');
  assert.ok(htmlStr.includes('id="pf-total-assets"'));
  assert.ok(htmlStr.includes('id="pf-my-rank"'));

  // (2) 기사 탭 내부 탐색 3가지 (올해 기사 / 유료 단서 / 보관함) 및 보관함 전용 필터 이동 확인
  assert.ok(htmlStr.includes('id="btn-art-nav-current"'));
  assert.ok(htmlStr.includes('id="btn-art-nav-paid"'));
  assert.ok(htmlStr.includes('id="btn-art-nav-archive"'));
  assert.ok(htmlStr.includes('id="articles-archive-controls"'));

  // (3) 유료 단서 종목별 한 줄(paid-stock-row), 관련 종목 보기(data-goto-related-stock, btn-paid-related-stock), 읽던 기사로 돌아가기(btn-back-to-reading-article), 스크롤 복원(articleScrollTopByNav) 확인
  assert.ok(jsStr.includes('paid-stock-row'));
  assert.ok(jsStr.includes('data-goto-related-stock'));
  assert.ok(jsStr.includes('btn-paid-related-stock'));
  assert.ok(jsStr.includes('articleScrollTopByNav'));
  assert.ok(cssStr.includes('.paid-stock-row'));

  console.log('\n[통과] 5. 1차 UI 개선(거래 공통 헤더 간소화, 내 투자 총자산·직전 순위 배치, 기사 탭 올해 기사/유료 단서/보관함 3분할 및 종목별 한 줄, 관련 종목 보기, 읽던 기사·목록 위치 복원) 검증 완료');

  const qaRes = await runQaRegressionVerification();
  console.log('\n[통과] 6. 다시 플레이 시 이전 판 채팅 구분 및 3인 친구방 1:1 비밀 대화 격리 검증 완료:');
  console.log(`   · 당사자(도형·민지) 2번째 판 조회: 현재 판 대화 ${qaRes.p1CurrentChats}건 / 이전 판 대화 ${qaRes.p1PrevChats}건 분리`);
  console.log(`   · 제3자(현우) 2번째 판 조회: 현재 판 대화 ${qaRes.p3CurrentChats}건 / 이전 판 대화 ${qaRes.p3PrevChats}건 (타인 1:1 메시지 0건)`);

  console.log('\n[통과] 7. 주문·기사 결제 중복 처리 범위(참가자 ID + 요청 종류 + 요청 ID) 및 실제 현금·보유수량·열람권한 검증 완료:');
  console.log(`   · 도형(p1): 현금 ${qaRes.expectedP1Cash.toLocaleString()}원 / A엔터 ${qaRes.p1AEnterQty}주 / B엔터 ${qaRes.p1BEnterQty}주 / 유료 기사 2건 본문 열람 확인`);
  console.log(`   · 민지(p2): 현금 ${qaRes.expectedP2Cash.toLocaleString()}원 / A엔터 ${qaRes.p2AEnterQty}주 / 유료 기사 1건 본문 열람 확인`);

  // ---------------------------------------------------------------------------
  // 8. 플레이 피드백 반영 검증 (기사 콘텐츠 품질, 25% 가격 인상, 15초 경고, 채팅 알림, BGM)
  // ---------------------------------------------------------------------------
  // (a) 신규 동적 시나리오 생성 후 전 연도 무료 기사 & 유료 단서의 다문단 구조(2~3문단), 미래 상승·하락·확정 등락률 금지, 그리고 연도 간 기사 중복 0건 검사
  const freshScenario = generateDynamicScenario([]);
  await prewarmScenarioArticles({ scenario: freshScenario });
  let checkedFreeCount = 0;
  let checkedPaidCount = 0;
  const seenFreeTitles = new Map();
  const seenFreeBodies = new Map();
  const seenPaidKeys = new Map();
  for (let y = 2011; y <= 2019; y++) {
    const yd = freshScenario.articlesByYear[y];
    for (const f of yd.free || []) {
      checkedFreeCount++;
      assert.ok(
        !seenFreeTitles.has(f.title),
        `[${y}년 무료 기사 ${f.id}] 무료 기사 제목이 ${seenFreeTitles.get(f.title)}년과 중복되면 안 됩니다: "${f.title}"`
      );
      seenFreeTitles.set(f.title, y);
      assert.ok(
        !seenFreeBodies.has(f.body),
        `[${y}년 무료 기사 ${f.id}] 무료 기사 본문이 ${seenFreeBodies.get(f.body)}년과 중복되면 안 됩니다.`
      );
      seenFreeBodies.set(f.body, y);
      const paras = String(f.body || '').split(/\n{2,}/).filter(Boolean);
      assert.ok(paras.length >= 2 && paras.length <= 3, `[${y}년 무료 기사 ${f.id}] 본문은 2~3개의 짧은 문단이어야 합니다. (실제: ${paras.length})`);
      for (const field of [f.title, f.summary, f.body]) {
        const leak = checkPredictiveExpressionLeak(field);
        assert.strictEqual(leak, null, `[${y}년 무료 기사 ${f.id}] 미래 결과 추정 표현이 포함되면 안 됩니다: ${leak} -> "${field}"`);
      }
    }
    for (const p of yd.paid || []) {
      checkedPaidCount++;
      const paidKey = `${p.stockId}::${p.clueType || 'single'}::${p.postTitle}::${p.body}`;
      assert.ok(
        !seenPaidKeys.has(paidKey),
        `[${y}년 유료 단서 ${p.id}] 유료 단서(${p.stockName})가 ${seenPaidKeys.get(paidKey)}년과 중복되면 안 됩니다: "${p.postTitle}"`
      );
      seenPaidKeys.set(paidKey, y);
      const paras = String(p.body || '').split(/\n{2,}/).filter(Boolean);
      assert.ok(paras.length >= 2 && paras.length <= 3, `[${y}년 유료 단서 ${p.id}] 본문은 2~3개의 짧은 문단이어야 합니다. (실제: ${paras.length})`);
      for (const field of [p.preTitle, p.whatItTells, p.subtitle, p.postTitle, p.body, p.highlightNote]) {
        const leak = checkPredictiveExpressionLeak(field);
        assert.strictEqual(leak, null, `[${y}년 유료 단서 ${p.id}] 미래 결과 추정 표현이 포함되면 안 됩니다: ${leak} -> "${field}"`);
      }
    }
  }

  // 외부 AI 기사 생성 경로 검증기: '급등 기대', '하락 전망', '+15%' 등 차단 확인
  const aiLeakBrief = buildArticleFactBrief({
    id: 'test_ai_leak',
    year: 2012,
    type: 'paid',
    stockName: 'A조선',
    industry: '조선',
    hideCompanyName: false,
    disclosedFacts: ['A조선 금융 보증 심사 진행']
  });
  const predictiveTitleReject = validateGeneratedArticle(
    { title: 'A조선 대형 수주 급등 기대', body: 'A조선이 협상을 진행 중이다.\n\n보증 심사는 하반기 예정이다.' },
    aiLeakBrief
  );
  assert.strictEqual(predictiveTitleReject.valid, false, '외부 AI 경로에서도 급등 기대 등 결과 추정 제목은 차단되어야 합니다.');

  // (b) 유료 기사 가격 25% 인상 설정값 및 공통 가격 계산 공식 검증 (금액 단위 1,000배 확장: 000 추가 반영)
  assert.strictEqual(CONFIG.INITIAL_CASH, 500000000);
  assert.strictEqual(CONFIG.ANNUAL_GRANT, 50000000);
  assert.strictEqual(CONFIG.ARTICLE_PRICE_RATE, 0.02);
  assert.strictEqual(CONFIG.ARTICLE_PRICE_INCREASE_RATE, 0.25);
  assert.strictEqual(
    calculateArticlePrice([550000000, 550000000, 550000000]),
    13000000,
    '총자산 중앙값 550,000,000원 기준 현행 2% 대비 25% 인상(2.5% = 13,750,000원 -> 1,000,000원 단위 내림)은 13,000,000원이어야 합니다.'
  );
  assert.strictEqual(
    calculateArticlePrice([1000000000, 1000000000]),
    25000000,
    '총자산 중앙값 1,000,000,000원 기준 2.5%는 25,000,000원이어야 합니다.'
  );

  // (c) 30초 경고, 채팅 알림, BGM 컨트롤, 비율형 주문 수량 버튼(10% / 25% / 50% / 전체), 이용자 수 통계(/api/stats) 검증
  assert.ok(htmlStr.includes('id="trading-15s-warning-banner"'));
  assert.ok(htmlStr.includes('거래 마감까지 30초 남았어요'));
  assert.ok(jsStr.includes('remainingMs <= 30000'), '마감 경고는 남은 시간 30초 이하에서 표시되어야 합니다.');
  assert.ok(!jsStr.includes('activeClue.highlightNote') && !jsStr.includes('pArt.highlightNote'), '기사 본문 아래 요약 정리 박스는 표시하지 않아야 합니다.');
  assert.ok(htmlStr.includes('data-qty-pct="10"') && htmlStr.includes('data-qty-pct="25"') && htmlStr.includes('data-qty-pct="50"') && htmlStr.includes('data-qty-pct="100"'));
  assert.ok(htmlStr.includes('>10%<') && htmlStr.includes('>25%<') && htmlStr.includes('>50%<') && htmlStr.includes('>전체<'));
  assert.ok(htmlStr.includes('id="entry-user-stats-pill"'));
  assert.ok(htmlStr.includes('id="mobile-tab-chat-badge"'));
  assert.ok(htmlStr.includes('id="chat-all-unread-badge"'));
  assert.ok(htmlStr.includes('id="btn-bgm-toggle"'));
  assert.ok(jsStr.includes('trigger15SecWarningOnceForRound'));
  assert.ok(jsStr.includes('markActiveChatChannelAsRead'));
  assert.ok(jsStr.includes('ant_square_bgm_enabled_v1'));

  const statsRes = await request('GET', '/api/stats');
  assert.strictEqual(statsRes.statusCode, 200);
  assert.strictEqual(statsRes.json.ok, true);
  assert.ok(statsRes.json.cumulative.totalHumanParticipations >= 6, '누적 이용자(참가) 수가 집계되어야 합니다.');
  assert.ok(statsRes.json.cumulative.totalGamesStarted >= 2, '누적 시작된 게임 수가 집계되어야 합니다.');

  const bgmRes = await request('GET', '/audio/bgm-ambient.wav');
  assert.strictEqual(bgmRes.statusCode, 200);
  assert.strictEqual(bgmRes.headers['Content-Type'], 'audio/wav');
  assert.strictEqual(bgmRes.body.slice(0, 4).toString('ascii'), 'RIFF');
  assert.strictEqual(bgmRes.body.slice(8, 12).toString('ascii'), 'WAVE');

  console.log(`\n[통과] 8. 플레이 피드백 5종 및 추가 요청 4종 자동 검증 완료:`);
  console.log(`   · 기사 품질 & 중복 0건 검사: 무료 기사 ${checkedFreeCount}건 + 유료 단서 ${checkedPaidCount}건 전수 2~3문단 구조, 연도 간 중복 0건, 결과 추정/등락률 누출 0건`);
  console.log(`   · 자금 및 유료 기사 가격(000 확대): 기초 자금 ${CONFIG.INITIAL_CASH.toLocaleString()}원 / 연간 지원금 ${CONFIG.ANNUAL_GRANT.toLocaleString()}원 / 중앙값 550,000,000원 -> 13,000,000원`);
  console.log(`   · 주문 수량 비율 버튼: 10% / 25% / 50% / 전체 적용 완료`);
  console.log(`   · 이용자 수 데이터 집계(/api/stats): 누적 참가 ${statsRes.json.cumulative.totalHumanParticipations}명(고유 닉네임 ${statsRes.json.cumulative.uniqueNicknameCount}명) / 시작 ${statsRes.json.cumulative.totalGamesStarted}판`);
  console.log(`   · BGM 음원 서빙: /audio/bgm-ambient.wav (HTTP 200, audio/wav, ${bgmRes.body.length.toLocaleString()} bytes)`);

  // 바이오·조선·반도체 실제 생성된 무료 기사 샘플 출력
  const sampleBioFree = freshScenario.articlesByYear[2011].free.find((a) => a.industry === '바이오');
  const sampleShipFree = freshScenario.articlesByYear[2011].free.find((a) => a.industry === '조선');
  let sampleSemiFree = null;
  for (let y = 2011; y <= 2014; y++) {
    sampleSemiFree = (freshScenario.articlesByYear[y].free || []).find((a) => a.industry === '반도체');
    if (sampleSemiFree) break;
  }
  console.log('\n=== [실제 생성된 바이오·조선·반도체 무료 기사 샘플] ===');
  for (const s of [sampleBioFree, sampleShipFree, sampleSemiFree].filter(Boolean)) {
    console.log(`\n[${s.year}년 ${s.industry}] 제목: ${s.title}`);
    console.log(`본문:\n${s.body}`);
  }

  console.log('\n=== 모든 검증 통과 ===');
  process.exit(0);
}

runVerification();
