/**
 * 모의 주식 웹게임 (개미광장) - 메인 서버
 * 기획서 1~18쪽의 게임 규칙, 시세, 타이머 동기화, 유료 기사 권한, 주문 멱등성(requestId), 채팅을 관리합니다.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CONFIG = require('./config');
const { STOCKS, generateDynamicScenario, createVerificationScenarioP7 } = require('./scenarioData');
const { prepareArticlesForYear, prewarmScenarioArticles } = require('./aiArticleService');

const rooms = new Map(); // roomCode -> Room
const sseClients = new Map(); // clientId -> { res, roomCode, participantId }

// 종목 ID -> 종목 메타 매핑
const STOCK_MAP = new Map(STOCKS.map((s) => [s.id, s]));

/**
 * 6자리 영문 대문자·숫자 방 코드 생성 (혼동되기 쉬운 I, O, 0, 1 제외 가능하지만 표준 영문+숫자 6자리)
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < CONFIG.ROOM_CODE_LENGTH; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * 닉네임 유효성 검사 (기획서 8쪽, 11쪽: 2~12자, 공백만으로 구성 불가)
 */
function validateNickname(raw) {
  if (typeof raw !== 'string') {
    return { valid: false, message: '닉네임을 입력해 주세요.' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, message: '공백만으로는 닉네임을 만들 수 없습니다.' };
  }
  if (trimmed.length < CONFIG.NICKNAME_MIN_LENGTH || trimmed.length > CONFIG.NICKNAME_MAX_LENGTH) {
    return {
      valid: false,
      message: `닉네임은 ${CONFIG.NICKNAME_MIN_LENGTH}~${CONFIG.NICKNAME_MAX_LENGTH}자로 입력해 주세요.`
    };
  }
  return { valid: true, nickname: trimmed };
}

/**
 * 방 이름 유효성 검사 (기획서 11쪽: 2~24자)
 */
function validateRoomName(raw, fallbackNickname) {
  const defaultName = `${fallbackNickname}의 투자방`;
  if (typeof raw !== 'string' || !raw.trim()) {
    return { valid: true, roomName: defaultName };
  }
  const trimmed = raw.trim();
  if (trimmed.length < CONFIG.ROOM_NAME_MIN_LENGTH || trimmed.length > CONFIG.ROOM_NAME_MAX_LENGTH) {
    return {
      valid: false,
      message: `방 이름은 ${CONFIG.ROOM_NAME_MIN_LENGTH}~${CONFIG.ROOM_NAME_MAX_LENGTH}자로 입력해 주세요.`
    };
  }
  return { valid: true, roomName: trimmed };
}

/**
 * 참가자 초기 상태 생성
 */
function createParticipant({ id, nickname, isBot = false, botStyle = null }) {
  const holdings = {};
  for (const s of STOCKS) {
    holdings[s.id] = {
      quantity: 0,
      avgBuyPrice: 0
    };
  }
  return {
    id,
    nickname,
    token: generateId('tok'),
    isBot,
    botStyle,
    connected: true,
    joinedAt: Date.now(),
    cash: CONFIG.INITIAL_CASH,
    yearStartTotalAssets: CONFIG.INITIAL_CASH, // 직전 연도 지급 후 시작 총자산 (2010년은 500,000원)
    holdings,
    purchasedArticles: [], // 기사 ID 배열
    articlePayments: [],   // [{ id, year, articleId, title, price, timestamp }]
    orders: [],            // [{ id, requestId, year, stockId, stockName, side, quantity, price, amount, cashAfter, timestamp }]
    currentRank: 1,
    prevRank: 1,
    readyForNextPhase: false
  };
}

/**
 * 현재 연도 시세 기준 참가자 주식 평가액 합계 및 총자산 계산 (기획서 3쪽)
 */
function calculateParticipantAssets(room, participant, year = room.currentYear) {
  const yearPrices = room.scenario.pricesByYear[year] || room.scenario.pricesByYear[CONFIG.START_YEAR];
  let stockEvaluation = 0;
  const holdingsDetail = [];

  for (const stock of STOCKS) {
    const h = participant.holdings[stock.id] || { quantity: 0, avgBuyPrice: 0 };
    const currentPrice = yearPrices[stock.id];
    const evalAmount = h.quantity * currentPrice;
    stockEvaluation += evalAmount;

    const costBasis = h.quantity * h.avgBuyPrice;
    const unrealizedPnl = h.quantity > 0 ? evalAmount - costBasis : 0;
    const unrealizedRate = costBasis > 0 ? Number(((unrealizedPnl / costBasis) * 100).toFixed(2)) : 0;

    holdingsDetail.push({
      stockId: stock.id,
      name: stock.name,
      displayName: stock.displayName,
      industry: stock.industry,
      badge: stock.badge,
      quantity: h.quantity,
      avgBuyPrice: h.avgBuyPrice,
      currentPrice,
      evaluation: evalAmount,
      unrealizedPnl,
      unrealizedRate
    });
  }

  return {
    cash: participant.cash,
    stockEvaluation,
    totalAssets: participant.cash + stockEvaluation,
    holdingsDetail
  };
}

/**
 * 공동 순위 계산 (기획서 3쪽: 동액은 공동 순위로 표시하고 다음 순위는 건너뛴다. 예시 1위, 1위, 3위)
 */
function computeRanks(items, valueSelector) {
  const sorted = [...items].sort((a, b) => valueSelector(b) - valueSelector(a));
  const rankMap = new Map();
  let currentRank = 1;

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && valueSelector(sorted[i]) < valueSelector(sorted[i - 1])) {
      currentRank = i + 1;
    }
    rankMap.set(sorted[i].id, currentRank);
  }
  return rankMap;
}

/**
 * 유료 기사 공통 가격 계산 (기획서 3쪽, 14쪽 + 인상률 설정값 분리)
 * 연간 지원금 지급 후 총자산 중앙값 * (기준 비율 * (1 + 인상률))을 1,000원 단위로 내림하고 최소 1,000원을 적용한다.
 * 짝수 인원의 중앙값은 가운데 두 금액의 평균이다.
 */
function calculateArticlePrice(postGrantAssetsList) {
  if (!postGrantAssetsList || postGrantAssetsList.length === 0) {
    return CONFIG.ARTICLE_MIN_PRICE;
  }
  const sorted = [...postGrantAssetsList].sort((a, b) => a - b);
  const n = sorted.length;
  let median = 0;
  if (n % 2 === 1) {
    median = sorted[(n - 1) / 2];
  } else {
    median = (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }
  const increaseRate = Number.isFinite(CONFIG.ARTICLE_PRICE_INCREASE_RATE)
    ? CONFIG.ARTICLE_PRICE_INCREASE_RATE
    : 0;
  const effectiveRate = CONFIG.ARTICLE_PRICE_RATE * (1 + increaseRate);
  const rawPrice = median * effectiveRate;
  const floored = Math.floor(rawPrice / CONFIG.ARTICLE_PRICE_UNIT) * CONFIG.ARTICLE_PRICE_UNIT;
  return Math.max(CONFIG.ARTICLE_MIN_PRICE, floored);
}

/**
 * 시나리오 생성/배정 (기획서 6쪽, 18쪽)
 * - 실제 게임(새 방 생성, 1인 모드, 다시 플레이)에서는 항상 `generateDynamicScenario()`로
 *   2010년 시작가와 2011~2020년 개장가, 사건, 무료/유료 기사를 새로 생성합니다.
 * - 테스트 코드에서 `scenarioMode: 'verification_p7'`을 명시한 경우에만 기획서 7쪽 검증용 시나리오를 반환합니다.
 */
function buildScenarioForRoom({ excludedSignatures = [], scenarioMode = 'dynamic' } = {}) {
  if (scenarioMode === 'verification_p7') {
    return createVerificationScenarioP7();
  }
  return generateDynamicScenario(excludedSignatures);
}

/**
 * 방 생성
 */
function createRoom({
  roomName,
  capacity,
  mode = 'friend',
  hostNickname,
  excludedSignatures = [],
  scenarioMode = 'dynamic'
}) {
  const code = generateRoomCode();
  const host = createParticipant({
    id: generateId('p'),
    nickname: hostNickname,
    isBot: false
  });

  const scenario = buildScenarioForRoom({ excludedSignatures, scenarioMode });
  const participants = new Map();
  participants.set(host.id, host);

  if (mode === 'solo') {
    const botConfigs = [
      { nickname: '서윤(봇)', botStyle: 'focused' },   // 조사 후 집중형
      { nickname: '준호(봇)', botStyle: 'news_free' }, // 공개 뉴스 분산형
      { nickname: '민지(봇)', botStyle: 'cash_mgmt' }  // 현금 비중 관리형
    ];
    for (const bc of botConfigs) {
      let botName = bc.nickname;
      if (botName === hostNickname) {
        botName = `${bc.nickname}_AI`;
      }
      const bot = createParticipant({
        id: generateId('bot'),
        nickname: botName,
        isBot: true,
        botStyle: bc.botStyle
      });
      participants.set(bot.id, bot);
    }
  }

  const room = {
    id: generateId('room'),
    code,
    name: roomName,
    mode, // 'friend' | 'solo'
    capacity: mode === 'solo' ? 4 : Math.min(CONFIG.FRIEND_ROOM_MAX_PLAYERS, Math.max(CONFIG.FRIEND_ROOM_MIN_PLAYERS, Number(capacity) || CONFIG.FRIEND_ROOM_DEFAULT_CAPACITY)),
    hostId: host.id,
    gameNumber: 1,
    status: 'WAITING', // 'WAITING' | 'TUTORIAL' | 'TRADING' | 'OPENING' | 'SETTLEMENT'
    currentYear: CONFIG.START_YEAR,
    phaseStartedAt: Date.now(),
    phaseEndsAt: null,
    scenario,
    playedEventSignatures: [...(scenario.majorEvents || [])],
    currentArticlePrice: 0,
    actionSeq: 0,                 // 방 내 주문·기사 구매의 엄격한 체결 선후 순서 번호
    participants,
    processedRequests: new Map(), // `${participantId}:${actionType}:${requestId}` -> cached response
    openingHistory: {},           // year -> openingSnapshot
    settlementResult: null,
    chats: [],                    // [{ id, gameNumber, scenarioId, senderId, senderNickname, targetId, text, timestamp, year }]
    createdAt: Date.now()
  };

  rooms.set(code, room);
  // 방 시작 전 시나리오 기사 사전 준비 및 검증 (기획서 13쪽: 기사 준비는 방 시작 전 또는 전년도 거래 중에 수행)
  prewarmScenarioArticles(room).catch(() => {});
  return { room, host };
}

/**
 * 모든 인간 참가자의 준비 상태를 초기화
 */
function resetParticipantsReady(room) {
  for (const p of room.participants.values()) {
    p.readyForNextPhase = p.isBot ? true : false;
  }
}

/**
 * 인간 참가자 전원이 준비 완료했는지 확인
 */
function areAllHumansReady(room) {
  let humanCount = 0;
  for (const p of room.participants.values()) {
    if (!p.isBot) {
      humanCount++;
      if (!p.readyForNextPhase) return false;
    }
  }
  return humanCount > 0;
}

/**
 * 튜토리얼 시작 (게임 시작 버튼 클릭 시)
 */
function startTutorialPhase(room) {
  room.status = 'TUTORIAL';
  room.currentYear = CONFIG.START_YEAR;
  room.phaseStartedAt = Date.now();
  room.phaseEndsAt = room.phaseStartedAt + CONFIG.DURATION_TUTORIAL_SEC * 1000;
  resetParticipantsReady(room);
  broadcastRoomState(room);
}

/**
 * 해당 연도 거래(TRADING) 구간 시작
 */
function startTradingPhase(room, year) {
  // 해당 연도 기사가 사전 검증되지 않았다면 즉시 검증·준비하고, 다음 연도 기사도 백그라운드로 미리 준비
  prepareArticlesForYear(room, year).catch(() => {});
  if (year + 1 <= CONFIG.LAST_TRADING_YEAR) {
    prepareArticlesForYear(room, year + 1).catch(() => {});
  }

  room.status = 'TRADING';
  room.currentYear = year;
  room.phaseStartedAt = Date.now();
  const durationSec = year === CONFIG.START_YEAR
    ? CONFIG.DURATION_TRADING_2010_SEC
    : CONFIG.DURATION_TRADING_YEAR_SEC;
  room.phaseEndsAt = room.phaseStartedAt + durationSec * 1000;
  resetParticipantsReady(room);

  // 1인 모드 봇들의 해당 연도 거래 수행
  runBotsForTradingYear(room, year);

  broadcastRoomState(room);
}

/**
 * 직전 거래를 마감하고 다음 해 개장(OPENING) 또는 2020년 최종 정산(SETTLEMENT) 처리
 * 기획서 2쪽, 3쪽, 7쪽, 10쪽, 12쪽의 순서:
 * 직전 거래 마감 -> 새 시세 적용 -> 지급 전 자산과 순위 확정 -> 결과 기록 -> 연간 자금 지급(2011~2019) -> 기사 가격 확정
 */
function transitionFromTradingToNextYear(room) {
  const prevYear = room.currentYear;
  const nextYear = prevYear + 1;

  // 이미 해당 연도 개장 전환이 실행되었으면 중복 실행 방지 (기획서 12쪽: 연도 전환과 자금 지급은 방·연도별로 한 번만 실행)
  if (room.openingHistory[nextYear]) {
    return;
  }

  const prevPrices = room.scenario.pricesByYear[prevYear];
  const nextPrices = room.scenario.pricesByYear[nextYear];
  const reasons = (room.scenario.openingReasonsByYear && room.scenario.openingReasonsByYear[nextYear]) || {};

  // 1. 10종목의 이전·현재 시세, 등락률과 공개 가능한 변동 이유 계산
  const stockChanges = STOCKS.map((stock) => {
    const prevPrice = prevPrices[stock.id];
    const currentPrice = nextPrices[stock.id];
    const changeAmount = currentPrice - prevPrice;
    const changeRatePercent = prevPrice > 0
      ? Number((((currentPrice - prevPrice) / prevPrice) * 100).toFixed(1))
      : 0;
    return {
      stockId: stock.id,
      name: stock.name,
      displayName: stock.displayName,
      industry: stock.industry,
      badge: stock.badge,
      publicBusiness: stock.publicBusiness,
      prevPrice,
      currentPrice,
      changeAmount,
      changeRatePercent,
      reason: reasons[stock.id] || `${nextYear}년 시장 수급 및 실적 결과가 반영됐습니다.`
    };
  });

  // 2. 참가자별 지급 전 총자산 및 연도 투자 순손익 계산
  const participantEvaluations = [];
  for (const p of room.participants.values()) {
    let stockEvaluation = 0;
    const holdingsDetail = [];

    for (const stock of STOCKS) {
      const h = p.holdings[stock.id] || { quantity: 0, avgBuyPrice: 0 };
      const prevPrice = prevPrices[stock.id];
      const currentPrice = nextPrices[stock.id];
      const evalAmount = h.quantity * currentPrice;
      const prevEvalAmount = h.quantity * prevPrice;
      const changeRatePercent = prevPrice > 0
        ? Number((((currentPrice - prevPrice) / prevPrice) * 100).toFixed(1))
        : 0;

      stockEvaluation += evalAmount;
      if (h.quantity > 0) {
        holdingsDetail.push({
          stockId: stock.id,
          name: stock.name,
          displayName: stock.displayName,
          industry: stock.industry,
          badge: stock.badge,
          quantity: h.quantity,
          avgBuyPrice: h.avgBuyPrice,
          prevPrice,
          currentPrice,
          prevEvaluation: prevEvalAmount,
          evaluation: evalAmount,
          evalDiff: evalAmount - prevEvalAmount,
          changeRatePercent
        });
      }
    }

    const cashBeforeGrant = p.cash;
    const preGrantTotalAssets = cashBeforeGrant + stockEvaluation;
    const prevYearPostGrantTotalAssets = p.yearStartTotalAssets;
    // 연도 투자 순손익 = 해당 개장 지급 전 총자산 - 직전 연도 지급 후 시작 총자산 (기사 비용 포함, 기획서 3쪽)
    const netProfitLoss = preGrantTotalAssets - prevYearPostGrantTotalAssets;

    const articleSpentLastYear = p.articlePayments
      .filter((ap) => ap.year === prevYear)
      .reduce((acc, cur) => acc + cur.price, 0);

    participantEvaluations.push({
      id: p.id,
      participantId: p.id,
      nickname: p.nickname,
      isBot: p.isBot,
      cashBeforeGrant,
      stockEvaluation,
      holdingsDetail,
      preGrantTotalAssets,
      prevYearPostGrantTotalAssets,
      netProfitLoss,
      articleSpentLastYear,
      prevRank: p.currentRank || 1
    });
  }

  // 3. 지급 전 총자산 기준 그해 순위 계산 (동액 공동 순위 처리)
  const rankMap = computeRanks(participantEvaluations, (item) => item.preGrantTotalAssets);

  // 4. 연간 지원금 지급 (2011~2019년은 50,000원, 2020년은 0원)
  const isFinalSettlement = nextYear >= CONFIG.SETTLEMENT_YEAR;
  const annualGrant = isFinalSettlement ? 0 : CONFIG.ANNUAL_GRANT;

  const postGrantAssetsList = [];
  for (const item of participantEvaluations) {
    const p = room.participants.get(item.participantId);
    const newRank = rankMap.get(item.participantId) || 1;
    item.rank = newRank;
    item.rankDelta = item.prevRank - newRank; // 양수면 순위 상승
    item.annualGrant = annualGrant;
    item.nextTradingCash = item.cashBeforeGrant + annualGrant;
    item.postGrantTotalAssets = item.preGrantTotalAssets + annualGrant;

    // 실제 참가자 상태 반영
    p.prevRank = p.currentRank || 1;
    p.currentRank = newRank;
    p.cash = item.nextTradingCash;
    p.yearStartTotalAssets = item.postGrantTotalAssets;

    postGrantAssetsList.push(item.postGrantTotalAssets);
  }

  // 순위 오름차순 정렬
  participantEvaluations.sort((a, b) => a.rank - b.rank);

  // 5. 올해 유료 기사 공통 가격 확정 (2011~2019년)
  const articlePriceForYear = isFinalSettlement ? 0 : calculateArticlePrice(postGrantAssetsList);
  room.currentArticlePrice = articlePriceForYear;
  room.currentYear = nextYear;

  const openingSnapshot = {
    year: nextYear,
    previousYear: prevYear,
    isMidterm: nextYear === CONFIG.MIDTERM_YEAR,
    isFinalSettlement,
    articlePriceForYear,
    annualGrant,
    stockChanges,
    participantsSnapshot: participantEvaluations,
    createdAt: Date.now()
  };

  room.openingHistory[nextYear] = openingSnapshot;

  // 6. 2020년 최종 정산인지 일반/중간 개장인지에 따라 상태 설정
  resetParticipantsReady(room);
  room.phaseStartedAt = Date.now();

  if (isFinalSettlement) {
    room.status = 'SETTLEMENT';
    room.settlementResult = openingSnapshot;
    room.phaseEndsAt = null;
  } else {
    room.status = 'OPENING';
    if (nextYear === CONFIG.MILESTONE_OPENING_YEAR && CONFIG.HOLD_AT_2012_OPENING) {
      // 2012년 개장은 완료 기준 검증을 위해 참가자 전원이 다음 거래 시작을 누를 때까지 시간 제한 없이 유지
      room.phaseEndsAt = null;
    } else {
      const resultDurationSec = nextYear === CONFIG.MIDTERM_YEAR
        ? CONFIG.DURATION_MIDTERM_RESULT_SEC
        : CONFIG.DURATION_OPENING_RESULT_SEC;
      room.phaseEndsAt = room.phaseStartedAt + resultDurationSec * 1000;
    }
  }

  broadcastRoomState(room);
}

/**
 * 1인 모드 봇 거래 로직 (기획서 11쪽)
 * - 봇은 내부 시나리오나 미래 가격, 타인의 유료 기사를 절대 참조하지 않습니다.
 * - 해당 해에 공개된 무료 기사와 현재 시세, 그리고 봇 본인이 현금을 지불해 구매한 유료 기사의 단서만 사용합니다.
 * - 서버는 봇의 주문과 기사 구매도 플레이어와 동일한 거래 규칙(executeStockOrder, executeArticlePurchase)으로 검증합니다.
 */
function runBotsForTradingYear(room, year) {
  const yearPrices = room.scenario.pricesByYear[year];
  const yearArticles = room.scenario.articlesByYear[year] || { free: [], paid: [] };
  if (!yearPrices) return;

  for (const bot of room.participants.values()) {
    if (!bot.isBot) continue;

    // 2010년 첫 거래 (기사 없음): 성향별로 초기 포트폴리오 구성
    if (year === CONFIG.START_YEAR) {
      if (bot.botStyle === 'focused') {
        // 조사 후 집중형: 2011년 유료 조사 후 집중 투자를 위해 현금 위주로 보유하되 1종목 소량 매수
        const pickStock = STOCKS[Math.floor(Math.random() * STOCKS.length)];
        const price = yearPrices[pickStock.id];
        const qty = Math.floor((bot.cash * 0.25) / price);
        if (qty >= 1) {
          executeStockOrder(room, bot, {
            year,
            stockId: pickStock.id,
            side: 'BUY',
            quantity: qty,
            requestId: `bot_${bot.id}_${year}_init`
          });
        }
      } else if (bot.botStyle === 'news_free') {
        // 공개 뉴스 분산형: 2개 종목에 25%씩 분산 배치
        const picks = [STOCKS[0], STOCKS[6]];
        for (const st of picks) {
          const price = yearPrices[st.id];
          const qty = Math.floor((bot.cash * 0.25) / price);
          if (qty >= 1) {
            executeStockOrder(room, bot, {
              year,
              stockId: st.id,
              side: 'BUY',
              quantity: qty,
              requestId: `bot_${bot.id}_${year}_${st.id}`
            });
          }
        }
      } else if (bot.botStyle === 'cash_mgmt') {
        // 현금 비중 관리형: 현금 65% 이상 유지, 35%만 안정 종목 매수
        const st = STOCKS[9]; // A항공 등
        const price = yearPrices[st.id];
        const qty = Math.floor((bot.cash * 0.35) / price);
        if (qty >= 1) {
          executeStockOrder(room, bot, {
            year,
            stockId: st.id,
            side: 'BUY',
            quantity: qty,
            requestId: `bot_${bot.id}_${year}_${st.id}`
          });
        }
      }
      continue;
    }

    // 2011~2019년 거래: 공개된 무료 기사 및 직접 결제한 유료 기사 기반 의사결정
    const freeList = yearArticles.free || [];
    const paidList = yearArticles.paid || [];

    if (bot.botStyle === 'focused' && paidList.length > 0) {
      // 1. 무료 기사에 등장한 종목 중 하나(없으면 임의 종목)의 유료 기사를 사람과 동일한 가격으로 구매
      const freeRelatedIds = freeList.flatMap((f) => f.relatedStockIds || []);
      const candidatePaid = paidList.filter((p) => freeRelatedIds.includes(p.stockId));
      const targetPaid = (candidatePaid.length > 0 ? candidatePaid : paidList)[
        Math.floor(Math.random() * (candidatePaid.length > 0 ? candidatePaid.length : paidList.length))
      ];

      const purchaseRes = executeArticlePurchase(room, bot, {
        year,
        articleId: targetPaid.id,
        requestId: `bot_${bot.id}_${year}_art_${targetPaid.id}`
      });

      // 실제 구매에 성공해 소유권을 얻은 경우에만 해당 유료 기사의 단서(isPositive)를 확인
      if (purchaseRes.ok && bot.purchasedArticles.includes(targetPaid.id)) {
        if (targetPaid.isPositive) {
          const price = yearPrices[targetPaid.stockId];
          const qty = Math.floor((bot.cash * 0.65) / price);
          if (qty >= 1) {
            executeStockOrder(room, bot, {
              year,
              stockId: targetPaid.stockId,
              side: 'BUY',
              quantity: qty,
              requestId: `bot_${bot.id}_${year}_buy_${targetPaid.stockId}`
            });
          }
        } else {
          // 구매한 유료 기사가 악재(협상 결렬·심사 지연 등)이면 보유 수량 매도 후 다른 무료 기사 종목 소량 매수
          const holding = bot.holdings[targetPaid.stockId];
          if (holding && holding.quantity > 0) {
            executeStockOrder(room, bot, {
              year,
              stockId: targetPaid.stockId,
              side: 'SELL',
              quantity: holding.quantity,
              requestId: `bot_${bot.id}_${year}_sell_${targetPaid.stockId}`
            });
          }
          const fallbackStockId = freeRelatedIds.find((id) => id !== targetPaid.stockId) || 'a_food';
          const fPrice = yearPrices[fallbackStockId];
          const fQty = Math.floor((bot.cash * 0.4) / fPrice);
          if (fQty >= 1) {
            executeStockOrder(room, bot, {
              year,
              stockId: fallbackStockId,
              side: 'BUY',
              quantity: fQty,
              requestId: `bot_${bot.id}_${year}_fallback_${fallbackStockId}`
            });
          }
        }
      }
    } else if (bot.botStyle === 'news_free') {
      // 공개 뉴스 분산형: 유료 기사를 사지 않고 올해 공개된 무료 기사 5개의 관련 종목 2개에 분산 투자
      const freeStockIds = [...new Set(freeList.flatMap((f) => f.relatedStockIds || []))];
      const chosenIds = freeStockIds.slice(0, 2);
      for (const stockId of chosenIds) {
        const price = yearPrices[stockId];
        if (!price) continue;
        const qty = Math.floor((bot.cash * 0.35) / price);
        if (qty >= 1) {
          executeStockOrder(room, bot, {
            year,
            stockId,
            side: 'BUY',
            quantity: qty,
            requestId: `bot_${bot.id}_${year}_free_${stockId}`
          });
        }
      }
    } else if (bot.botStyle === 'cash_mgmt') {
      // 현금 비중 관리형: 총자산 대비 현금 비중을 약 50%로 유지
      const assets = calculateParticipantAssets(room, bot, year);
      const targetCash = assets.totalAssets * 0.5;
      if (bot.cash > targetCash * 1.15) {
        const investBudget = bot.cash - targetCash;
        const freeStockIds = [...new Set(freeList.flatMap((f) => f.relatedStockIds || []))];
        const targetId = freeStockIds[0] || 'a_semi';
        const price = yearPrices[targetId];
        const qty = Math.floor(investBudget / price);
        if (qty >= 1) {
          executeStockOrder(room, bot, {
            year,
            stockId: targetId,
            side: 'BUY',
            quantity: qty,
            requestId: `bot_${bot.id}_${year}_cashbuy_${targetId}`
          });
        }
      } else if (bot.cash < targetCash * 0.8) {
        const held = Object.entries(bot.holdings).find(([, h]) => h.quantity >= 2);
        if (held) {
          const [stockId, h] = held;
          const sellQty = Math.max(1, Math.floor(h.quantity / 2));
          executeStockOrder(room, bot, {
            year,
            stockId,
            side: 'SELL',
            quantity: sellQty,
            requestId: `bot_${bot.id}_${year}_cashsell_${stockId}`
          });
        }
      }
    }
  }
}

/**
 * 중복 요청(멱등성) 식별 키 생성
 * 기준: 참가자 ID + 요청 종류('ORDER' | 'BUY_ARTICLE') + 요청 ID
 */
function buildIdempotencyKey(participantId, actionType, requestId) {
  if (!requestId) return null;
  return `${participantId}:${actionType}:${requestId}`;
}

/**
 * 주식 매수·매도 주문 처리 (기획서 3쪽, 12쪽)
 */
function executeStockOrder(room, participant, { year, stockId, side, quantity, requestId }) {
  // 1. 요청 ID 멱등성 확인 (동일 참가자가 동일 주문 요청을 재전송했을 때만 한 번만 처리)
  const idempotencyKey = buildIdempotencyKey(participant.id, 'ORDER', requestId);
  if (idempotencyKey && room.processedRequests.has(idempotencyKey)) {
    return room.processedRequests.get(idempotencyKey);
  }

  // 2. 거래 가능 상태 및 마감/연도 검증
  if (room.status !== 'TRADING') {
    return {
      ok: false,
      code: 'MARKET_CLOSED',
      message: '현재 거래 시간이 마감되어 주문을 처리할 수 없습니다.'
    };
  }
  if (Number(year) !== room.currentYear) {
    return {
      ok: false,
      code: 'YEAR_MISMATCH',
      message: '직전 해 주문으로 처리할 수 없습니다. 현재 연도의 시세로 다시 주문해 주세요.'
    };
  }
  if (room.phaseEndsAt && Date.now() >= room.phaseEndsAt) {
    return {
      ok: false,
      code: 'DEADLINE_PASSED',
      message: '마감 시각이 지나 새 주문을 처리할 수 없습니다.'
    };
  }

  // 3. 종목 및 수량 검증
  const stock = STOCK_MAP.get(stockId);
  if (!stock) {
    return { ok: false, code: 'INVALID_STOCK', message: '유효하지 않은 종목입니다.' };
  }

  const parsedQty = Number(quantity);
  if (!Number.isInteger(parsedQty) || parsedQty < 1) {
    return { ok: false, code: 'INVALID_QUANTITY', message: '주문 수량은 1주 이상 정수로 입력해 주세요.' };
  }

  const currentPrice = room.scenario.pricesByYear[room.currentYear][stockId];
  const orderAmount = currentPrice * parsedQty;
  const holding = participant.holdings[stockId] || { quantity: 0, avgBuyPrice: 0 };

  if (side === 'BUY') {
    const maxBuyQty = Math.floor(participant.cash / currentPrice);
    if (parsedQty > maxBuyQty || orderAmount > participant.cash) {
      return {
        ok: false,
        code: 'INSUFFICIENT_CASH',
        message: `잔고 부족: 최대 ${maxBuyQty.toLocaleString()}주까지 매수할 수 있습니다.`
      };
    }

    const prevTotalCost = holding.quantity * holding.avgBuyPrice;
    const newQuantity = holding.quantity + parsedQty;
    const newAvgPrice = Math.round((prevTotalCost + orderAmount) / newQuantity);

    participant.cash -= orderAmount;
    participant.holdings[stockId] = {
      quantity: newQuantity,
      avgBuyPrice: newAvgPrice
    };
  } else if (side === 'SELL') {
    if (parsedQty > holding.quantity) {
      return {
        ok: false,
        code: 'EXCEEDS_HOLDING',
        message: `수량 초과: 현재 보유 수량(${holding.quantity.toLocaleString()}주) 이하만 매도할 수 있습니다.`
      };
    }

    const newQuantity = holding.quantity - parsedQty;
    participant.cash += orderAmount;
    // 기획서 3쪽: 전량 매도 시 평균 단가를 초기화한다.
    participant.holdings[stockId] = {
      quantity: newQuantity,
      avgBuyPrice: newQuantity === 0 ? 0 : holding.avgBuyPrice
    };
  } else {
    return { ok: false, code: 'INVALID_SIDE', message: '주문 방향(매수/매도)을 확인해 주세요.' };
  }

  room.actionSeq = (room.actionSeq || 0) + 1;
  const orderRecord = {
    id: generateId('ord'),
    seq: room.actionSeq,
    requestId: requestId || generateId('req'),
    participantId: participant.id,
    year: room.currentYear,
    stockId,
    stockName: stock.name,
    side,
    quantity: parsedQty,
    price: currentPrice,
    amount: orderAmount,
    cashAfter: participant.cash,
    timestamp: Date.now()
  };
  participant.orders.unshift(orderRecord);

  const response = {
    ok: true,
    order: orderRecord,
    message: `${stock.name} ${parsedQty}주 ${side === 'BUY' ? '매수' : '매도'} 주문이 체결되었습니다.`
  };

  if (idempotencyKey) {
    room.processedRequests.set(idempotencyKey, response);
  }
  return response;
}

/**
 * 유료 기사 구매 처리 (기획서 3쪽, 5쪽, 10쪽, 12쪽)
 */
function executeArticlePurchase(room, participant, { year, articleId, requestId }) {
  // 1. 동일 참가자 + 기사 구매 요청 종류 + 요청 ID 기준 멱등성 처리
  const idempotencyKey = buildIdempotencyKey(participant.id, 'BUY_ARTICLE', requestId);
  if (idempotencyKey && room.processedRequests.has(idempotencyKey)) {
    return room.processedRequests.get(idempotencyKey);
  }

  // 2. 이미 구매한 기사인지 확인 (기획서 3쪽: 이미 산 기사를 다시 열면 현금은 그대로다. 기사 소유권은 참가자·기사 ID 단위로 1회만 부여)
  if (participant.purchasedArticles.includes(articleId)) {
    const response = {
      ok: true,
      alreadyOwned: true,
      articleId,
      message: '이미 구매한 기사입니다. 추가 차감 없이 본문을 열람합니다.'
    };
    if (idempotencyKey) {
      room.processedRequests.set(idempotencyKey, response);
    }
    return response;
  }

  // 3. 마감 및 판매 연도 검증 (기획서 5쪽: 현재 연도에 발행된 유료 기사만 판매한다)
  if (room.status !== 'TRADING') {
    return {
      ok: false,
      code: 'MARKET_CLOSED',
      message: '거래가 마감되어 유료 기사를 구매할 수 없습니다.'
    };
  }
  if (Number(year) !== room.currentYear) {
    return {
      ok: false,
      code: 'EXPIRED_ARTICLE',
      message: '해당 연도에 구매하지 않은 지난 유료 기사는 구매가 종료되었습니다.'
    };
  }
  if (room.phaseEndsAt && Date.now() >= room.phaseEndsAt) {
    return {
      ok: false,
      code: 'DEADLINE_PASSED',
      message: '마감 시각이 지나 새 기사를 구매할 수 없습니다.'
    };
  }

  const yearArticles = room.scenario.articlesByYear[room.currentYear];
  const paidList = (yearArticles && yearArticles.paid) || [];
  const targetArticle = paidList.find((a) => a.id === articleId);

  if (!targetArticle) {
    return {
      ok: false,
      code: 'ARTICLE_NOT_FOUND',
      message: '올해 판매 중인 유료 기사가 아닙니다.'
    };
  }

  // 4. 동일 종목·동일 거래 연도 유료 단서 1개 선택 제한 검증
  //    (두 구매 요청이 거의 동시에 들어와도 먼저 도달한 1건만 결제하고 나머지는 차단)
  const existingSameStockPayment = participant.articlePayments.find(
    (ap) => ap.year === room.currentYear && ap.stockId === targetArticle.stockId && ap.articleId !== targetArticle.id
  );
  if (existingSameStockPayment) {
    const choiceLockedResponse = {
      ok: false,
      code: 'CHOICE_ALREADY_MADE',
      alreadyChosenArticleId: existingSameStockPayment.articleId,
      alreadyChosenTitle: existingSameStockPayment.preTitle,
      message: '이 종목의 올해 유료 단서는 하나만 구매할 수 있어요. (올해 단서 선택 완료)'
    };
    if (idempotencyKey) {
      room.processedRequests.set(idempotencyKey, choiceLockedResponse);
    }
    return choiceLockedResponse;
  }

  const price = room.currentArticlePrice;
  if (participant.cash < price) {
    return {
      ok: false,
      code: 'INSUFFICIENT_CASH',
      message: `잔고 부족: 기사 구매에 ${price.toLocaleString()}원이 필요합니다. (보유 현금: ${participant.cash.toLocaleString()}원)`
    };
  }

  // 5. 현금 차감 및 소유권 기록
  participant.cash -= price;
  participant.purchasedArticles.push(articleId);

  room.actionSeq = (room.actionSeq || 0) + 1;
  const paymentRecord = {
    id: generateId('pay'),
    seq: room.actionSeq,
    requestId: requestId || generateId('req'),
    year: room.currentYear,
    articleId: targetArticle.id,
    stockId: targetArticle.stockId,
    stockName: targetArticle.stockName,
    hasChoicePair: Boolean(targetArticle.hasChoicePair),
    choiceGroup: targetArticle.choiceGroup || null,
    clueType: targetArticle.clueType || 'single',
    clueTypeLabel: targetArticle.clueTypeLabel || '단일 단서',
    whatItTells: targetArticle.whatItTells || targetArticle.subtitle,
    preTitle: targetArticle.preTitle,
    postTitle: targetArticle.postTitle,
    price,
    cashAfter: participant.cash,
    timestamp: Date.now()
  };
  participant.articlePayments.unshift(paymentRecord);

  const response = {
    ok: true,
    alreadyOwned: false,
    articleId: targetArticle.id,
    payment: paymentRecord,
    message: `'${targetArticle.preTitle}' 유료 단서를 ${price.toLocaleString()}원에 구매했습니다.`
  };

  if (idempotencyKey) {
    room.processedRequests.set(idempotencyKey, response);
  }
  return response;
}

/**
 * 특정 개장 시점(openingYear) 직전까지 참가자가 보유한 특정 종목의 전체 실제 보유 수량을 계산합니다.
 */
function getHoldingQuantityAtOpening(participant, stockId, openingYear) {
  const chronologicalOrders = [...(participant.orders || [])]
    .reverse()
    .filter((o) => o.stockId === stockId && o.year < openingYear);

  let qty = 0;
  for (const ord of chronologicalOrders) {
    if (ord.side === 'BUY') {
      qty += ord.quantity;
    } else if (ord.side === 'SELL') {
      qty = Math.max(0, qty - ord.quantity);
    }
  }
  return qty;
}

/**
 * 특정 포지션 사이클(cycle)이 특정 개장 시점(openingYear)에 실제로 보유 중인 잔여 수량을 계산합니다.
 * - 해당 사이클이 개장 전에 전량 매도(청산)되었다면, 이후 같은 종목을 재매수해 새 사이클이 열렸더라도
 *   이 앞서 청산된 사이클의 잔여 수량은 0주로 계산되어 이후 주가 급등락이 청산된 거래의 성과로 잘못 귀속되지 않습니다.
 */
function getCycleHoldingAtOpening(cycle, openingYear) {
  if (!cycle || cycle.entryYear >= openingYear) return 0;
  let qty = 0;
  for (const ev of cycle.events) {
    if (ev.year >= openingYear) break;
    if (ev.type === 'BUY') {
      qty += ev.quantity;
    } else if (ev.type === 'SELL') {
      qty = Math.max(0, qty - ev.quantity);
    }
  }
  return qty;
}

/**
 * 개장 변동 이유 문장을 복기용 연결 문장으로 자연스럽게 다듬는 헬퍼
 */
function formatReasonForReview(reasonText) {
  const raw = String(reasonText || '').trim().replace(/\.$/, '');
  if (!raw) return '시장 수급과 실적 결과가 반영되며';
  return raw
    .replace(/반영되어 하락했습니다$/, '반영되며')
    .replace(/반영되어 상승했습니다$/, '반영되며')
    .replace(/공개되어 하락했습니다$/, '공개되며')
    .replace(/무산되어 하락했습니다$/, '무산되며')
    .replace(/결렬되어 하락했습니다$/, '결렬되며')
    .replace(/반영됐습니다$/, '반영되며')
    .replace(/하락했습니다$/, '하락 요인으로 작용하며')
    .replace(/상승했습니다$/, '상승 요인으로 작용하며')
    .replace(/조정됐습니다$/, '조정되며')
    .replace(/둔화됐습니다$/, '둔화되며')
    .replace(/축소됐습니다$/, '축소되며')
    .replace(/개선됐습니다$/, '개선되며');
}

function formatClueSummaryText(text) {
  const raw = String(text || '').trim().replace(/\.$/, '');
  if (!raw) return '관련 단서가 공개되어 있었어요.';
  if (raw.endsWith('어요') || raw.endsWith('습니다') || raw.endsWith('이다') || raw.endsWith('전망이다')) {
    return `${raw}.`;
  }
  return `${raw} 내용이 확인됐어요.`;
}

/**
 * 2020년 최종 정산용 '내 투자 복기' 생성기 (최대 3개 사례)
 * 1. 기사 구매와 주문 체결의 실제 순서(seq)를 비교하여, 매수 이후에 구매한 유료 기사는 그 매수의 '당시 단서'로 표시하지 않습니다.
 *    앞선 관련 단서(선행 구매 유료 기사 또는 당시까지 공개된 해당 종목 무료 기사)가 없다면 '당시 확인 가능한 관련 단서 없음'으로 표시합니다.
 * 2. 종목을 전량 매도해 포지션이 청산(보유 0주)된 뒤 같은 종목을 재매수하면 별도의 신규 포지션 사이클로 분리합니다.
 *    - 앞서 청산된 거래에는 이후 개장의 주가 급등락이나 재매수 물량의 손익이 귀속되지 않고 종목 변동 사실만 표시됩니다.
 *    - 재매수한 거래에는 개장 시점의 실제 보유 수량과 평가 손익이 정확히 일치하여 표시됩니다.
 */
function buildParticipantTradeReviews(room, participant) {
  if (!participant || !Array.isArray(participant.orders) || participant.orders.length === 0) {
    return [];
  }

  // 체결 순서(오래된 순)대로 포지션 사이클(Lot) 분리 추적
  const chronological = [...participant.orders].reverse();
  const openCycleByStock = new Map();
  const allCycles = [];

  for (const ord of chronological) {
    const seq = typeof ord.seq === 'number' ? ord.seq : 0;

    if (ord.side === 'BUY') {
      let cycle = openCycleByStock.get(ord.stockId);

      // 열린 포지션이 없거나 직전에 전량 매도로 청산된 상태라면 새 포지션 사이클 생성
      // 또한 같은 해라도 이번 매수 직전에 유료 기사를 새로 구매한 경우 별도 판단 행동으로 분리
      const boughtArticleBetweenBuys =
        cycle &&
        participant.articlePayments.some(
          (ap) =>
            ap.stockId === ord.stockId &&
            ap.year === ord.year &&
            (typeof ap.seq === 'number' ? ap.seq : 0) > cycle.entrySeq &&
            (typeof ap.seq === 'number' ? ap.seq : 0) < seq
        );

      if (!cycle || cycle.currentQty === 0 || cycle.entryYear !== ord.year || boughtArticleBetweenBuys) {
        const isRebuyAfterLiquidation = allCycles.some(
          (c) => c.stockId === ord.stockId && c.closedAtSeq !== null && c.closedAtSeq < seq
        );
        cycle = {
          cycleId: `cyc_${ord.stockId}_${seq}`,
          year: ord.year,
          entryYear: ord.year,
          entrySeq: seq,
          lastSeq: seq,
          stockId: ord.stockId,
          stockName: ord.stockName,
          side: 'BUY',
          isRebuy: isRebuyAfterLiquidation,
          quantity: ord.quantity,
          price: ord.price,
          amount: ord.amount,
          currentQty: ord.quantity,
          closedAtYear: null,
          closedAtSeq: null,
          firstTimestamp: ord.timestamp,
          events: [
            {
              type: 'BUY',
              year: ord.year,
              seq,
              quantity: ord.quantity,
              price: ord.price,
              amount: ord.amount
            }
          ]
        };
        openCycleByStock.set(ord.stockId, cycle);
        allCycles.push(cycle);
      } else {
        // 같은 해, 같은 단서 상태에서의 추가 매수는 해당 사이클 진입 수량에 합산
        cycle.quantity += ord.quantity;
        cycle.amount += ord.amount;
        cycle.currentQty += ord.quantity;
        cycle.lastSeq = seq;
        cycle.events.push({
          type: 'BUY',
          year: ord.year,
          seq,
          quantity: ord.quantity,
          price: ord.price,
          amount: ord.amount
        });
      }
    } else if (ord.side === 'SELL') {
      const cycle = openCycleByStock.get(ord.stockId);
      if (cycle && cycle.currentQty > 0) {
        cycle.currentQty = Math.max(0, cycle.currentQty - ord.quantity);
        cycle.lastSeq = seq;
        cycle.events.push({
          type: 'SELL',
          year: ord.year,
          seq,
          quantity: ord.quantity,
          price: ord.price,
          amount: ord.amount
        });
        if (cycle.currentQty === 0) {
          cycle.closedAtYear = ord.year;
          cycle.closedAtSeq = seq;
          openCycleByStock.delete(ord.stockId);
        }
      }
    }
  }

  const arcs = room.scenario.multiYearArcs || [];

  // 각 포지션 사이클의 영향도 점수 계산 (최대 3개 선정)
  const scoredActions = allCycles.map((act) => {
    const nextOpeningYear = act.year + 1;
    const nextSnap = room.openingHistory[nextOpeningYear];
    const nextStockChange = nextSnap && nextSnap.stockChanges
      ? nextSnap.stockChanges.find((sc) => sc.stockId === act.stockId)
      : null;
    const absRate = nextStockChange ? Math.abs(nextStockChange.changeRatePercent) : 0;

    // 해당 주문 체결(entrySeq) 이전에 구매한 유료 기사가 있는 경우만 선행 조사 보너스 부여
    const boughtPaidBeforeOrder = participant.articlePayments.some(
      (ap) =>
        ap.stockId === act.stockId &&
        ap.year <= act.year &&
        (typeof ap.seq === 'number' ? ap.seq : 0) < act.entrySeq
    );
    const inArc = arcs.some(
      (arc) => (arc.targetStockIds || []).includes(act.stockId) && act.year >= arc.startYear && act.year < arc.endOpeningYear
    );

    const impactScore =
      act.amount * (1 + absRate / 15) +
      (boughtPaidBeforeOrder ? 120000 : 0) +
      (inArc ? 80000 : 0);

    return { act, impactScore };
  });

  const top3 = scoredActions
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 3)
    .sort((a, b) => a.act.year - b.act.year || a.act.entrySeq - b.act.entrySeq)
    .map((item) => item.act);

  const reviews = [];

  for (const act of top3) {
    const stock = STOCK_MAP.get(act.stockId) || { id: act.stockId, name: act.stockName, industry: '' };
    const sideKorean = act.side === 'BUY' ? '매수' : '매도';
    const nextOpeningYear = act.year + 1;

    // 이 사이클(거래분)의 다음 개장 시점 잔여 보유 수량과 계좌 전체 실제 보유 수량
    const cycleHeldAtNextOpening = getCycleHoldingAtOpening(act, nextOpeningYear);
    const totalAccountHeldAtNextOpening = getHoldingQuantityAtOpening(participant, act.stockId, nextOpeningYear);
    const cycleLiquidatedBeforeNextOpening = cycleHeldAtNextOpening === 0;

    // 1. 내 행동
    const rebuyTag = act.isRebuy ? ' (전량 매도 후 재매수)' : '';
    const actionTitle = `${act.year}년 ${stock.name} ${act.quantity.toLocaleString('ko-KR')}주 ${sideKorean}${rebuyTag}`;
    let statusNote = '';
    if (cycleLiquidatedBeforeNextOpening) {
      statusNote = ` (${nextOpeningYear}년 개장 전 전량 매도·청산)`;
    } else if (act.isRebuy) {
      statusNote = ` (${nextOpeningYear}년 개장 시 ${totalAccountHeldAtNextOpening.toLocaleString('ko-KR')}주 보유)`;
    }
    const actionMeta = `주당 ${act.price.toLocaleString('ko-KR')}원 · 주문금액 ${act.amount.toLocaleString('ko-KR')}원${statusNote}`;

    // 2. 당시 단서
    //    - 반드시 이 거래 체결 시점(act.entrySeq)보다 '앞서' 구매한 유료 기사만 유료 단서로 인정합니다.
    //    - 매수한 뒤에 구매한 유료 기사는 최초 매수의 '당시 단서'로 절대 표시하지 않습니다.
    //    - 앞선 관련 유료 단서나 당시까지 공개된 관련 무료 기사가 없다면 '당시 확인 가능한 관련 단서 없음'으로 표시합니다.
    let clueSourceType = 'NO_PRIOR_CLUE';
    let clueSourceLabel = '당시 확인 가능한 관련 단서 없음';
    let clueText = '거래 체결 시점 이전에 공개된 관련 무료 기사나 먼저 구매한 유료 단서가 없었어요.';

    // (a) 주문 체결(act.entrySeq) 이전에 구매한 해당 종목 유료 기사 확인
    const priorPayments = [...(participant.articlePayments || [])]
      .filter(
        (ap) =>
          ap.stockId === act.stockId &&
          ap.year <= act.year &&
          (typeof ap.seq === 'number' ? ap.seq : 0) < act.entrySeq
      )
      .sort((a, b) => (b.seq || 0) - (a.seq || 0));

    let matchedPaidArticle = null;
    if (priorPayments.length > 0) {
      const latestPay = priorPayments[0];
      const yPaidList = (room.scenario.articlesByYear[latestPay.year] && room.scenario.articlesByYear[latestPay.year].paid) || [];
      matchedPaidArticle = yPaidList.find((p) => p.id === latestPay.articleId) || null;
    }

    let purchasedClueType = null;
    let purchasedClueTypeLabel = null;
    let purchasedArticleId = null;

    if (matchedPaidArticle) {
      clueSourceType = 'PURCHASED_PAID';
      purchasedArticleId = matchedPaidArticle.id;
      purchasedClueType = matchedPaidArticle.clueType || 'single';
      purchasedClueTypeLabel = matchedPaidArticle.clueTypeLabel || '단일 단서';
      clueSourceLabel = `내가 구매한 유료 기사 (${matchedPaidArticle.year}년 「${matchedPaidArticle.preTitle}」)`;
      clueText = `${matchedPaidArticle.postTitle} — ${formatClueSummaryText(matchedPaidArticle.highlightNote || matchedPaidArticle.body)}`;
    } else if (act.year >= 2011) {
      // (b) 거래 시점(act.year 이하)까지 공개된 관련 무료 기사 탐색
      //     (직접 해당 종목을 가리키는 무료 기사이거나, 회사명이 숨겨진 동일 업종 공통 추리 무료 기사만 매칭)
      let matchedFreeArticle = null;
      for (let y = act.year; y >= 2011; y--) {
        const yFreeList = (room.scenario.articlesByYear[y] && room.scenario.articlesByYear[y].free) || [];
        const directFree = yFreeList.find((f) => (f.relatedStockIds || []).includes(act.stockId));
        if (directFree) {
          matchedFreeArticle = directFree;
          break;
        }
        const hiddenIndustryFree = yFreeList.find(
          (f) => f.hideCompanyName === true && f.industry === stock.industry
        );
        if (hiddenIndustryFree) {
          matchedFreeArticle = hiddenIndustryFree;
          break;
        }
      }

      if (matchedFreeArticle) {
        clueSourceType = 'DISCLOSED_FREE';
        clueSourceLabel = `당시 공개된 기사 (${matchedFreeArticle.year}년 무료 기사)`;
        clueText = `「${matchedFreeArticle.title}」 — ${formatClueSummaryText(matchedFreeArticle.summary || matchedFreeArticle.body)}`;
      }
    }

    // 3. 이후 결과 (직후 개장 결과 + 장기 사건인 경우 후속 개장 결과)
    const outcomes = [];
    const nextSnap = room.openingHistory[nextOpeningYear];
    const nextSc = nextSnap && nextSnap.stockChanges
      ? nextSnap.stockChanges.find((sc) => sc.stockId === act.stockId)
      : null;

    if (nextSc) {
      const r = nextSc.changeRatePercent;
      const rateStr = r > 0 ? `+${r}%` : (r < 0 ? `−${Math.abs(r)}%` : '0%');
      const moveWord = r >= 50 ? '급등했어요' : (r > 0 ? '상승했어요' : (r <= -15 ? '급락했어요' : (r < 0 ? '하락했어요' : '보합이었어요')));
      const cleanReason = formatReasonForReview(nextSc.reason);

      let outcomeText = '';
      if (cycleLiquidatedBeforeNextOpening) {
        // 이 거래분이 개장 전에 이미 전량 매도·청산된 경우:
        // 이후 재매수가 있었더라도 이 청산된 거래의 성과(수익/손실)처럼 표현하지 않고 종목 변동 사실만 표시합니다.
        const liquidatedNote = totalAccountHeldAtNextOpening > 0
          ? `${nextOpeningYear}년 개장 전 이 거래분은 전량 매도·청산 완료되었으며, 개장 시점 보유 수량(${totalAccountHeldAtNextOpening.toLocaleString('ko-KR')}주)은 이후 재매수한 별도 거래분입니다`
          : `${nextOpeningYear}년 개장 전 전량 매도하여 보유 수량 없음`;
        outcomeText = `${cleanReason} ${stock.name} 주가가 ${rateStr}(${nextSc.prevPrice.toLocaleString('ko-KR')}원 → ${nextSc.currentPrice.toLocaleString('ko-KR')}원) ${moveWord}. (${liquidatedNote})`;
      } else {
        // 개장 시점에 실제로 보유 중인 포지션: 개장 시점의 실제 보유 수량과 일치하게 표시
        const effectiveHeldQty = totalAccountHeldAtNextOpening;
        const evalDiff = (nextSc.currentPrice - nextSc.prevPrice) * effectiveHeldQty;
        const evalDiffStr = evalDiff > 0
          ? `보유 ${effectiveHeldQty.toLocaleString('ko-KR')}주 평가액 +${evalDiff.toLocaleString('ko-KR')}원`
          : (evalDiff < 0
            ? `보유 ${effectiveHeldQty.toLocaleString('ko-KR')}주 평가액 −${Math.abs(evalDiff).toLocaleString('ko-KR')}원`
            : `보유 ${effectiveHeldQty.toLocaleString('ko-KR')}주 유지`);
        outcomeText = `${cleanReason} 주가가 ${rateStr}(${nextSc.prevPrice.toLocaleString('ko-KR')}원 → ${nextSc.currentPrice.toLocaleString('ko-KR')}원) ${moveWord}. (${evalDiffStr})`;
      }

      outcomes.push({
        year: nextOpeningYear,
        isFollowUp: false,
        label: `${nextOpeningYear}년 결과`,
        changeRatePercent: r,
        prevPrice: nextSc.prevPrice,
        currentPrice: nextSc.currentPrice,
        reason: nextSc.reason,
        heldQtyAtOpening: cycleLiquidatedBeforeNextOpening ? 0 : totalAccountHeldAtNextOpening,
        actualAccountHeldQty: totalAccountHeldAtNextOpening,
        soldOutBeforeOpening: cycleLiquidatedBeforeNextOpening,
        text: outcomeText
      });
    }

    // 장기 사건(2~6년 아크)에 속한 종목이고 직후 개장 이후에 최종 결말이 이어진 경우 후속 결과 추가
    const relatedArc = arcs.find(
      (arc) =>
        (arc.targetStockIds || []).includes(act.stockId) &&
        act.year >= arc.startYear &&
        nextOpeningYear < arc.endOpeningYear &&
        arc.endOpeningYear <= CONFIG.SETTLEMENT_YEAR
    );

    if (relatedArc) {
      const followYear = relatedArc.endOpeningYear;
      const followSnap = room.openingHistory[followYear];
      const followSc = followSnap && followSnap.stockChanges
        ? followSnap.stockChanges.find((sc) => sc.stockId === act.stockId)
        : null;

      if (followSc) {
        const fr = followSc.changeRatePercent;
        const fRateStr = fr > 0 ? `+${fr}%` : (fr < 0 ? `−${Math.abs(fr)}%` : '0%');
        const fMoveWord = fr >= 50 ? '급등했어요' : (fr > 0 ? '상승했어요' : (fr <= -15 ? '급락했어요' : (fr < 0 ? '하락했어요' : '보합이었어요')));
        const fCleanReason = formatReasonForReview(followSc.reason);
        const cycleHeldAtFollow = getCycleHoldingAtOpening(act, followYear);
        const totalHeldAtFollow = getHoldingQuantityAtOpening(participant, act.stockId, followYear);
        const cycleLiquidatedBeforeFollow = cycleHeldAtFollow === 0;

        let followText = '';
        if (cycleLiquidatedBeforeFollow) {
          followText = `${fCleanReason} ${stock.name} 주가가 ${fRateStr}(${followSc.prevPrice.toLocaleString('ko-KR')}원 → ${followSc.currentPrice.toLocaleString('ko-KR')}원) ${fMoveWord}. (앞서 전량 매도·청산한 거래 이후의 종목 변동)`;
        } else {
          const fEvalDiff = (followSc.currentPrice - followSc.prevPrice) * totalHeldAtFollow;
          const fEvalStr = fEvalDiff >= 0
            ? `보유 ${totalHeldAtFollow.toLocaleString('ko-KR')}주 평가액 +${fEvalDiff.toLocaleString('ko-KR')}원`
            : `보유 ${totalHeldAtFollow.toLocaleString('ko-KR')}주 평가액 −${Math.abs(fEvalDiff).toLocaleString('ko-KR')}원`;
          followText = `${fCleanReason} 주가가 ${fRateStr}(${followSc.prevPrice.toLocaleString('ko-KR')}원 → ${followSc.currentPrice.toLocaleString('ko-KR')}원) ${fMoveWord}. (${fEvalStr})`;
        }

        outcomes.push({
          year: followYear,
          isFollowUp: true,
          label: `${followYear}년 후속 결과`,
          changeRatePercent: fr,
          prevPrice: followSc.prevPrice,
          currentPrice: followSc.currentPrice,
          reason: followSc.reason,
          heldQtyAtOpening: cycleLiquidatedBeforeFollow ? 0 : totalHeldAtFollow,
          actualAccountHeldQty: totalHeldAtFollow,
          soldOutBeforeOpening: cycleLiquidatedBeforeFollow,
          text: followText
        });
      }
    }

    reviews.push({
      cycleId: act.cycleId,
      year: act.year,
      entrySeq: act.entrySeq,
      stockId: act.stockId,
      stockName: stock.name,
      industry: stock.industry,
      side: act.side,
      isRebuy: act.isRebuy,
      quantity: act.quantity,
      price: act.price,
      amount: act.amount,
      actionTitle,
      actionMeta,
      clueSourceType,
      clueSourceLabel,
      clueText,
      purchasedArticleId,
      purchasedClueType,
      purchasedClueTypeLabel,
      outcomes
    });
  }

  return reviews;
}

/**
 * 개장 결과 스냅샷을 참가자 권한에 맞게 필터링 (기획서 10쪽, 11쪽)
 * - 일반 연도(2011~2014, 2016~2019년 개장): 10종목 시세·변동 이유와 '내 평가액 변화, 내 투자 순손익, 내 순위와 순위 변동'만 제공하며
 *   다른 참가자의 총자산·순위표는 공개하지 않습니다.
 * - 중간 점검(2015년 개장) 및 최종 정산(2020년): 전체 참가자의 닉네임·순위·총자산 순위표를 함께 공개합니다.
 */
function filterOpeningSnapshotForParticipant(room, snap, participantId) {
  if (!snap) return null;
  const myResult = snap.participantsSnapshot.find((p) => p.participantId === participantId) || null;
  const showFullLeaderboard = Boolean(snap.isMidterm || snap.isFinalSettlement);

  // 전체 참가자 순위표는 2015년 중간 점검과 2020년 최종 정산에서만 공개 (단, 타인의 개별 보유 종목 세부 내역은 본인에게만 공개)
  const leaderboard = showFullLeaderboard
    ? snap.participantsSnapshot.map((p) => ({
        rank: p.rank,
        prevRank: p.prevRank,
        rankDelta: p.rankDelta,
        participantId: p.participantId,
        nickname: p.nickname,
        isBot: p.isBot,
        preGrantTotalAssets: p.preGrantTotalAssets,
        netProfitLoss: p.netProfitLoss,
        postGrantTotalAssets: p.postGrantTotalAssets
      }))
    : null;

  return {
    year: snap.year,
    previousYear: snap.previousYear,
    isMidterm: snap.isMidterm,
    isFinalSettlement: snap.isFinalSettlement,
    showFullLeaderboard,
    articlePriceForYear: snap.articlePriceForYear,
    annualGrant: snap.annualGrant,
    stockChanges: snap.stockChanges,
    myResult,
    leaderboard,
    // 하위 호환용: 중간 점검/최종 정산에서는 전체 순위표, 일반 연도에서는 본인 스냅샷만 포함
    participantsSnapshot: showFullLeaderboard
      ? snap.participantsSnapshot.map((p) =>
          p.participantId === participantId
            ? p
            : {
                rank: p.rank,
                prevRank: p.prevRank,
                rankDelta: p.rankDelta,
                participantId: p.participantId,
                nickname: p.nickname,
                isBot: p.isBot,
                preGrantTotalAssets: p.preGrantTotalAssets,
                netProfitLoss: p.netProfitLoss,
                postGrantTotalAssets: p.postGrantTotalAssets
              }
        )
      : (myResult ? [myResult] : []),
    multiYearArcs: snap.isFinalSettlement ? (room.scenario.multiYearArcs || []) : undefined,
    myTradeReviews: snap.isFinalSettlement && room.participants.has(participantId)
      ? buildParticipantTradeReviews(room, room.participants.get(participantId))
      : undefined,
    createdAt: snap.createdAt
  };
}

/**
 * 특정 참가자 권한에 맞춘 방 상태 직렬화 (기획서 12쪽: 미공개 회사명, 미구매 유료 본문, 미래 가격은 포함하지 않는다)
 */
function serializeRoomForParticipant(room, participantId) {
  const me = room.participants.get(participantId);
  if (!me) return null;

  const effectivePriceYear = room.currentYear;
  const currentPrices = room.scenario.pricesByYear[effectivePriceYear] || room.scenario.pricesByYear[CONFIG.START_YEAR];
  const prevPrices = effectivePriceYear > CONFIG.START_YEAR
    ? room.scenario.pricesByYear[effectivePriceYear - 1]
    : null;

  // 1. 공개된 연도까지의 종목별 시세 및 등락률, 내 보유 수량
  const stocksView = STOCKS.map((stock) => {
    const currentPrice = currentPrices[stock.id];
    const prevPrice = prevPrices ? prevPrices[stock.id] : currentPrice;
    const changeAmount = prevPrices ? currentPrice - prevPrice : 0;
    const changeRatePercent = prevPrices && prevPrice > 0
      ? Number((((currentPrice - prevPrice) / prevPrice) * 100).toFixed(1))
      : 0;

    // 2010년부터 현재 연도까지만 과거 가격 히스토리 공개 (미래 가격 절대 미포함)
    const priceHistory = [];
    for (let y = CONFIG.START_YEAR; y <= effectivePriceYear; y++) {
      if (room.scenario.pricesByYear[y]) {
        priceHistory.push({
          year: y,
          price: room.scenario.pricesByYear[y][stock.id]
        });
      }
    }

    const myHolding = me.holdings[stock.id] || { quantity: 0, avgBuyPrice: 0 };
    const myEvaluation = myHolding.quantity * currentPrice;

    // 2011년부터 현재 연도까지 이미 공개된 개장 변동 이유 히스토리 (단서 타임라인용, 미래 연도 절대 미포함)
    const disclosedOpenings = [];
    for (let y = CONFIG.FIRST_OPENING_YEAR; y <= effectivePriceYear; y++) {
      const snap = room.openingHistory[y];
      if (snap && Array.isArray(snap.stockChanges)) {
        const sc = snap.stockChanges.find((item) => item.stockId === stock.id);
        if (sc) {
          disclosedOpenings.push({
            year: y,
            prevPrice: sc.prevPrice,
            currentPrice: sc.currentPrice,
            changeRatePercent: sc.changeRatePercent,
            reason: sc.reason
          });
        }
      }
    }

    return {
      id: stock.id,
      name: stock.name,
      displayName: stock.displayName,
      badge: stock.badge,
      industry: stock.industry,
      publicBusiness: stock.publicBusiness,
      description: stock.description,
      currentPrice,
      prevPrice,
      changeAmount,
      changeRatePercent,
      isBaseYear: effectivePriceYear === CONFIG.START_YEAR,
      myQuantity: myHolding.quantity,
      myAvgBuyPrice: myHolding.avgBuyPrice,
      myEvaluation,
      priceHistory,
      disclosedOpenings
    };
  });

  // 2. 연도별 기사 공개 시점 제어 (기획서 1쪽, 2쪽, 5쪽 및 기사 공개 시점 요구사항):
  //    - 그해 무료 기사 5개와 유료 기사 목록은 거래 단계(TRADING)가 시작될 때 동시에 공개합니다.
  //    - 개장 결과 단계(OPENING)나 대기/튜토리얼 단계에서는 그해(room.currentYear) 기사 제목·본문과 유료 기사 목록을
  //      세션 조회(/api/session)와 실시간 SSE(/api/events) 응답에 포함하지 않습니다.
  //    - 지난 연도(y < room.currentYear)의 무료 기사와 내가 구매한 유료 기사는 개장 단계에서도 그대로 다시 볼 수 있습니다.
  const articlesByYearView = {};
  const maxArticleYear = (room.status === 'TRADING' || room.status === 'SETTLEMENT')
    ? Math.min(room.currentYear, CONFIG.LAST_TRADING_YEAR)
    : Math.min(room.currentYear - 1, CONFIG.LAST_TRADING_YEAR);
  for (let y = CONFIG.START_YEAR; y <= maxArticleYear; y++) {
    const rawYearArticles = room.scenario.articlesByYear[y] || { free: [], paid: [] };
    const freeList = (rawYearArticles.free || []).map((a) => ({
      id: a.id,
      year: a.year,
      type: 'free',
      industry: a.industry,
      hideCompanyName: Boolean(a.hideCompanyName),
      relatedStockIds: a.hideCompanyName ? [] : (a.relatedStockIds || []),
      arcStageLabel: a.arcStageLabel || null,
      aiStatus: a.aiStatus || 'fact_verified',
      title: a.title,
      summary: a.summary,
      body: a.body
    }));

    const paidList = (rawYearArticles.paid || []).map((a) => {
      const isPurchased = me.purchasedArticles.includes(a.id);
      const siblingPayment = a.hasChoicePair
        ? me.articlePayments.find((ap) => ap.year === y && ap.stockId === a.stockId && ap.articleId !== a.id)
        : null;
      const lockedBySibling = Boolean(!isPurchased && siblingPayment);
      const isCurrentYearTrading = y === room.currentYear && room.status === 'TRADING';
      const baseItem = {
        id: a.id,
        year: a.year,
        type: 'paid',
        stockId: a.stockId,
        stockName: a.stockName,
        industry: a.industry,
        topic: a.topic,
        hasChoicePair: Boolean(a.hasChoicePair),
        choiceGroup: a.choiceGroup || null,
        clueType: a.clueType || 'single',
        clueTypeLabel: a.clueTypeLabel || '단일 단서',
        whatItTells: a.whatItTells || a.subtitle,
        preTitle: a.preTitle,
        subtitle: a.subtitle,
        arcStageLabel: a.arcStageLabel || null,
        price: y === room.currentYear ? room.currentArticlePrice : (room.openingHistory[y]?.articlePriceForYear || room.currentArticlePrice),
        purchased: isPurchased,
        lockedBySibling,
        siblingPurchasedArticleId: siblingPayment ? siblingPayment.articleId : null,
        siblingPurchasedTitle: siblingPayment ? siblingPayment.preTitle : null,
        siblingPurchasedTypeLabel: siblingPayment ? (siblingPayment.clueTypeLabel || null) : null,
        canPurchase: !isPurchased && !lockedBySibling && isCurrentYearTrading
      };
      if (isPurchased) {
        baseItem.postTitle = a.postTitle;
        baseItem.body = a.body;
        baseItem.highlightNote = a.highlightNote;
        baseItem.aiStatus = a.aiStatus || 'fact_verified';
      }
      return baseItem;
    });

    articlesByYearView[y] = {
      free: freeList,
      paid: paidList
    };
  }

  // 3. 내 자산 및 포트폴리오
  const myAssets = calculateParticipantAssets(room, me, effectivePriceYear);

  // 4. 참가자 목록 (평소에는 다른 참가자의 자산/순위를 노출하지 않고 내 순위만 me.currentRank로 표시 - 기획서 11쪽)
  const participantsList = [];
  let readyHumanCount = 0;
  let totalHumanCount = 0;

  for (const p of room.participants.values()) {
    if (!p.isBot) {
      totalHumanCount++;
      if (p.readyForNextPhase) readyHumanCount++;
    }
    participantsList.push({
      id: p.id,
      nickname: p.nickname,
      isBot: p.isBot,
      botStyle: p.botStyle,
      isHost: p.id === room.hostId,
      connected: p.connected,
      readyForNextPhase: p.readyForNextPhase
    });
  }

  // 5. 내가 볼 권한이 있는 채팅 메시지 (전체 메시지 + 나와 관련된 1:1 메시지)
  //    다시 플레이할 때도 이전 판 기록은 유지하되 gameNumber / isCurrentGame으로 현재 판과 이전 판을 명확히 구분
  const currentGameNumber = room.gameNumber || 1;
  const visibleChats = room.chats
    .filter((msg) => msg.targetId === null || msg.senderId === me.id || msg.targetId === me.id)
    .map((msg) => {
      const msgGameNumber = msg.gameNumber || 1;
      return {
        ...msg,
        gameNumber: msgGameNumber,
        isCurrentGame: msgGameNumber === currentGameNumber
      };
    });
  const currentGameChats = visibleChats.filter((msg) => msg.isCurrentGame);
  const previousGameChats = visibleChats.filter((msg) => !msg.isCurrentGame);

  // 6. 개장 결과 및 최종 정산 스냅샷 필터링 (일반 연도는 내 결과만, 2015년 중간 점검과 2020년 최종 정산만 전체 순위표 포함)
  const rawCurrentOpening = room.openingHistory[room.currentYear] || null;
  const currentOpeningResult = filterOpeningSnapshotForParticipant(room, rawCurrentOpening, me.id);

  const filteredOpeningHistory = {};
  for (const [yr, snap] of Object.entries(room.openingHistory)) {
    filteredOpeningHistory[yr] = filterOpeningSnapshotForParticipant(room, snap, me.id);
  }

  const settlementResult = room.settlementResult
    ? filterOpeningSnapshotForParticipant(room, room.settlementResult, me.id)
    : null;

  return {
    serverNow: Date.now(),
    config: {
      initialCash: CONFIG.INITIAL_CASH,
      annualGrant: CONFIG.ANNUAL_GRANT,
      startYear: CONFIG.START_YEAR,
      milestoneOpeningYear: CONFIG.MILESTONE_OPENING_YEAR,
      midtermYear: CONFIG.MIDTERM_YEAR,
      lastTradingYear: CONFIG.LAST_TRADING_YEAR,
      settlementYear: CONFIG.SETTLEMENT_YEAR
    },
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      mode: room.mode,
      capacity: room.capacity,
      hostId: room.hostId,
      gameNumber: currentGameNumber,
      status: room.status,
      currentYear: room.currentYear,
      roundIndex: Math.min(10, Math.max(1, room.currentYear - CONFIG.START_YEAR + 1)),
      totalRounds: 10,
      phaseStartedAt: room.phaseStartedAt,
      phaseEndsAt: room.phaseEndsAt,
      currentArticlePrice: room.currentArticlePrice,
      scenarioId: room.scenario.id,
      scenarioVersion: room.scenario.version,
      readyHumanCount,
      totalHumanCount
    },
    me: {
      id: me.id,
      nickname: me.nickname,
      isHost: me.id === room.hostId,
      cash: myAssets.cash,
      stockEvaluation: myAssets.stockEvaluation,
      totalAssets: myAssets.totalAssets,
      yearStartTotalAssets: me.yearStartTotalAssets,
      currentRank: me.currentRank,
      prevRank: me.prevRank,
      readyForNextPhase: me.readyForNextPhase,
      holdingsDetail: myAssets.holdingsDetail,
      purchasedArticles: me.purchasedArticles,
      articlePayments: me.articlePayments,
      orders: me.orders
    },
    participants: participantsList,
    stocks: stocksView,
    articlesByYear: articlesByYearView,
    currentOpeningResult,
    openingHistory: filteredOpeningHistory,
    settlementResult,
    chats: visibleChats,
    currentGameChats,
    previousGameChats
  };
}

/**
 * 방의 모든 연결된 SSE 클라이언트에 최신 상태 전송
 */
function broadcastRoomState(room) {
  for (const client of sseClients.values()) {
    if (client.roomCode === room.code) {
      const payload = serializeRoomForParticipant(room, client.participantId);
      if (payload) {
        try {
          client.res.write(`data: ${JSON.stringify({ type: 'ROOM_STATE', payload })}\n\n`);
        } catch (err) {
          // 연결 오류 무시
        }
      }
    }
  }
}

/**
 * 서버 공통 타이머 루프 (매 250ms마다 마감 시각 도달 여부 점검)
 * 모든 참가자가 동일한 서버 마감 시각을 공유합니다.
 */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.phaseEndsAt || now < room.phaseEndsAt) continue;

    if (room.status === 'TUTORIAL') {
      startTradingPhase(room, CONFIG.START_YEAR);
    } else if (room.status === 'TRADING') {
      transitionFromTradingToNextYear(room);
    } else if (room.status === 'OPENING') {
      startTradingPhase(room, room.currentYear);
    }
  }
}, 250);

/**
 * HTTP JSON Body 파서
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

/**
 * 정적 파일 서빙
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

function serveStaticFile(res, filePath) {
  let resolvedPath = filePath;
  if (!fs.existsSync(resolvedPath)) {
    if (fs.existsSync(filePath.normalize('NFD'))) {
      resolvedPath = filePath.normalize('NFD');
    } else if (fs.existsSync(filePath.normalize('NFC'))) {
      resolvedPath = filePath.normalize('NFC');
    }
  }
  fs.readFile(resolvedPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

/**
 * HTTP 서버 생성 및 라우팅
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // 0. 클라우드 배포(Render, Railway 등) 헬스체크 엔드포인트
  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/healthz')) {
    return sendJson(res, 200, {
      ok: true,
      status: 'healthy',
      activeRooms: rooms.size,
      timestamp: Date.now()
    });
  }

  // 1. SSE 실시간 이벤트 스트림
  if (req.method === 'GET' && pathname === '/api/events') {
    const roomCode = (parsedUrl.searchParams.get('roomCode') || '').toUpperCase().trim();
    const participantId = parsedUrl.searchParams.get('participantId') || '';
    const token = parsedUrl.searchParams.get('token') || '';

    const room = rooms.get(roomCode);
    const participant = room && room.participants.get(participantId);
    if (!room || !participant || participant.token !== token) {
      return sendJson(res, 401, { ok: false, message: '유효하지 않은 방 또는 참가 세션입니다.' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const clientId = generateId('sse');
    participant.connected = true;
    const heartbeatTimer = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch (err) {
        clearInterval(heartbeatTimer);
      }
    }, 15000);
    sseClients.set(clientId, { res, roomCode, participantId, heartbeatTimer });

    // 즉시 초기 상태 전송 및 방 브로드캐스트
    const initialPayload = serializeRoomForParticipant(room, participantId);
    res.write(`data: ${JSON.stringify({ type: 'ROOM_STATE', payload: initialPayload })}\n\n`);
    broadcastRoomState(room);

    req.on('close', () => {
      clearInterval(heartbeatTimer);
      sseClients.delete(clientId);
      // 해당 참가자의 다른 열린 SSE 연결이 없을 때만 connected = false 처리
      let stillConnected = false;
      for (const c of sseClients.values()) {
        if (c.roomCode === roomCode && c.participantId === participantId) {
          stillConnected = true;
          break;
        }
      }
      if (!stillConnected && room.participants.has(participantId)) {
        room.participants.get(participantId).connected = false;
        broadcastRoomState(room);
      }
    });
    return;
  }

  // 2. 세션 조회 / 복구 (브라우저 새로고침 시 기존 방 복귀 - 기획서 8쪽, 11쪽)
  if (req.method === 'GET' && pathname === '/api/session') {
    const roomCode = (parsedUrl.searchParams.get('roomCode') || '').toUpperCase().trim();
    const participantId = parsedUrl.searchParams.get('participantId') || '';
    const token = parsedUrl.searchParams.get('token') || '';

    const room = rooms.get(roomCode);
    const participant = room && room.participants.get(participantId);
    if (!room || !participant || participant.token !== token) {
      return sendJson(res, 404, { ok: false, message: '세션을 찾을 수 없습니다.' });
    }
    participant.connected = true;
    return sendJson(res, 200, {
      ok: true,
      state: serializeRoomForParticipant(room, participantId)
    });
  }

  // 3. 방 만들기 (친구방 또는 1인 모드)
  if (req.method === 'POST' && pathname === '/api/rooms/create') {
    try {
      const body = await parseJsonBody(req);
      const nickCheck = validateNickname(body.nickname);
      if (!nickCheck.valid) {
        return sendJson(res, 400, { ok: false, message: nickCheck.message });
      }
      const mode = body.mode === 'solo' ? 'solo' : 'friend';
      const nameCheck = validateRoomName(body.roomName, nickCheck.nickname);
      if (!nameCheck.valid) {
        return sendJson(res, 400, { ok: false, message: nameCheck.message });
      }

      const { room, host } = createRoom({
        roomName: nameCheck.roomName,
        capacity: body.capacity,
        mode,
        hostNickname: nickCheck.nickname,
        excludedSignatures: body.excludedSignatures || [],
        scenarioMode: body.scenarioMode === 'verification_p7' ? 'verification_p7' : 'dynamic'
      });

      return sendJson(res, 200, {
        ok: true,
        roomCode: room.code,
        participantId: host.id,
        token: host.token,
        nickname: host.nickname,
        state: serializeRoomForParticipant(room, host.id)
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '잘못된 요청입니다.' });
    }
  }

  // 4. 방 코드로 참여 (기획서 8쪽: 존재하지 않는 방, 정원 초과, 닉네임 중복, 시작된 방 각각 안내)
  if (req.method === 'POST' && pathname === '/api/rooms/join') {
    try {
      const body = await parseJsonBody(req);
      const nickCheck = validateNickname(body.nickname);
      if (!nickCheck.valid) {
        return sendJson(res, 400, { ok: false, message: nickCheck.message });
      }

      const roomCode = typeof body.roomCode === 'string' ? body.roomCode.toUpperCase().trim() : '';
      if (!roomCode || roomCode.length !== CONFIG.ROOM_CODE_LENGTH) {
        return sendJson(res, 400, { ok: false, code: 'INVALID_CODE', message: '6자리 방 코드를 정확히 입력해 주세요.' });
      }

      const room = rooms.get(roomCode);
      if (!room) {
        return sendJson(res, 404, { ok: false, code: 'ROOM_NOT_FOUND', message: '존재하지 않는 방입니다. 방 코드를 다시 확인해 주세요.' });
      }

      // 기존 참가자가 같은 토큰으로 재접속하는 경우 허용
      if (body.participantId && body.token) {
        const existing = room.participants.get(body.participantId);
        if (existing && existing.token === body.token) {
          existing.connected = true;
          broadcastRoomState(room);
          return sendJson(res, 200, {
            ok: true,
            roomCode: room.code,
            participantId: existing.id,
            token: existing.token,
            nickname: existing.nickname,
            state: serializeRoomForParticipant(room, existing.id)
          });
        }
      }

      if (room.status !== 'WAITING') {
        return sendJson(res, 400, { ok: false, code: 'ALREADY_STARTED', message: '이미 시작된 방에는 새로 참여할 수 없습니다.' });
      }

      if (room.participants.size >= room.capacity) {
        return sendJson(res, 400, { ok: false, code: 'ROOM_FULL', message: `정원 초과: 이 방의 최대 정원(${room.capacity}명)이 모두 찼습니다.` });
      }

      for (const p of room.participants.values()) {
        if (p.nickname.toLowerCase() === nickCheck.nickname.toLowerCase()) {
          return sendJson(res, 400, { ok: false, code: 'DUPLICATE_NICKNAME', message: '닉네임 중복: 같은 방에 이미 동일한 닉네임이 있습니다.' });
        }
      }

      const newParticipant = createParticipant({
        id: generateId('p'),
        nickname: nickCheck.nickname,
        isBot: false
      });
      room.participants.set(newParticipant.id, newParticipant);

      broadcastRoomState(room);

      return sendJson(res, 200, {
        ok: true,
        roomCode: room.code,
        participantId: newParticipant.id,
        token: newParticipant.token,
        nickname: newParticipant.nickname,
        state: serializeRoomForParticipant(room, newParticipant.id)
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '잘못된 요청입니다.' });
    }
  }

  // 5. 대기방 나가기 (기획서 11쪽: 대기 중 방장이 나가면 남아 있는 참가자 중 먼저 들어온 사람에게 권한을 넘긴다)
  if (req.method === 'POST' && pathname === '/api/rooms/leave') {
    try {
      const body = await parseJsonBody(req);
      const room = rooms.get((body.roomCode || '').toUpperCase().trim());
      if (!room) return sendJson(res, 200, { ok: true });

      const participant = room.participants.get(body.participantId);
      if (!participant || participant.token !== body.token) {
        return sendJson(res, 401, { ok: false, message: '권한이 없습니다.' });
      }

      if (room.status === 'WAITING') {
        room.participants.delete(participant.id);
        const remainingHumans = [...room.participants.values()]
          .filter((p) => !p.isBot)
          .sort((a, b) => a.joinedAt - b.joinedAt);

        if (remainingHumans.length === 0) {
          rooms.delete(room.code);
          return sendJson(res, 200, { ok: true });
        }
        if (room.hostId === participant.id) {
          room.hostId = remainingHumans[0].id;
        }
      } else {
        participant.connected = false;
      }

      broadcastRoomState(room);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '요청 처리에 실패했습니다.' });
    }
  }

  // 6. 게임 시작 (방장 전용, 친구방은 최소 2명 충족 필요 - 기획서 8쪽)
  if (req.method === 'POST' && pathname === '/api/rooms/start') {
    try {
      const body = await parseJsonBody(req);
      const room = rooms.get((body.roomCode || '').toUpperCase().trim());
      if (!room) return sendJson(res, 404, { ok: false, message: '방을 찾을 수 없습니다.' });

      const participant = room.participants.get(body.participantId);
      if (!participant || participant.token !== body.token) {
        return sendJson(res, 401, { ok: false, message: '권한이 없습니다.' });
      }
      if (room.hostId !== participant.id) {
        return sendJson(res, 403, { ok: false, message: '방장만 게임을 시작할 수 있습니다.' });
      }
      if (room.status !== 'WAITING') {
        return sendJson(res, 400, { ok: false, message: '이미 시작된 방입니다.' });
      }
      if (room.mode === 'friend' && room.participants.size < CONFIG.FRIEND_ROOM_MIN_PLAYERS) {
        return sendJson(res, 400, {
          ok: false,
          message: `친구방은 최소 ${CONFIG.FRIEND_ROOM_MIN_PLAYERS}명 이상 모여야 시작할 수 있습니다.`
        });
      }

      startTutorialPhase(room);
      return sendJson(res, 200, {
        ok: true,
        state: serializeRoomForParticipant(room, participant.id)
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '게임 시작 요청을 처리하지 못했습니다.' });
    }
  }

  // 7. 구간 준비 완료 / 건너뛰기 / 다음 해 진행 (튜토리얼 건너뛰기/확인, 거래 마감 준비, 개장 결과 확인)
  if (req.method === 'POST' && pathname === '/api/rooms/ready') {
    try {
      const body = await parseJsonBody(req);
      const room = rooms.get((body.roomCode || '').toUpperCase().trim());
      if (!room) return sendJson(res, 404, { ok: false, message: '방을 찾을 수 없습니다.' });

      const participant = room.participants.get(body.participantId);
      if (!participant || participant.token !== body.token) {
        return sendJson(res, 401, { ok: false, message: '권한이 없습니다.' });
      }

      // 토글 옵션 지원 (거래 중 마감 준비를 취소하고 싶을 때)
      if (typeof body.ready === 'boolean') {
        participant.readyForNextPhase = body.ready;
      } else {
        participant.readyForNextPhase = true;
      }

      if (areAllHumansReady(room)) {
        if (room.status === 'TUTORIAL') {
          startTradingPhase(room, CONFIG.START_YEAR);
        } else if (room.status === 'TRADING') {
          transitionFromTradingToNextYear(room);
        } else if (room.status === 'OPENING') {
          startTradingPhase(room, room.currentYear);
        }
      } else {
        broadcastRoomState(room);
      }

      return sendJson(res, 200, {
        ok: true,
        state: serializeRoomForParticipant(room, participant.id)
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '준비 상태 변경에 실패했습니다.' });
    }
  }

  // 8. 주식 매수·매도 주문 요청
  if (req.method === 'POST' && pathname === '/api/rooms/order') {
    try {
      const body = await parseJsonBody(req);
      const room = rooms.get((body.roomCode || '').toUpperCase().trim());
      if (!room) return sendJson(res, 404, { ok: false, message: '방을 찾을 수 없습니다.' });

      const participant = room.participants.get(body.participantId);
      if (!participant || participant.token !== body.token) {
        return sendJson(res, 401, { ok: false, message: '권한이 없습니다.' });
      }

      const result = executeStockOrder(room, participant, {
        year: body.year,
        stockId: body.stockId,
        side: body.side,
        quantity: body.quantity,
        requestId: body.requestId
      });

      if (!result.ok) {
        return sendJson(res, 400, result);
      }

      broadcastRoomState(room);
      return sendJson(res, 200, {
        ...result,
        state: serializeRoomForParticipant(room, participant.id)
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '주문 처리 중 오류가 발생했습니다.' });
    }
  }

  // 9. 유료 기사 구매 요청
  if (req.method === 'POST' && pathname === '/api/rooms/buy-article') {
    try {
      const body = await parseJsonBody(req);
      const room = rooms.get((body.roomCode || '').toUpperCase().trim());
      if (!room) return sendJson(res, 404, { ok: false, message: '방을 찾을 수 없습니다.' });

      const participant = room.participants.get(body.participantId);
      if (!participant || participant.token !== body.token) {
        return sendJson(res, 401, { ok: false, message: '권한이 없습니다.' });
      }

      const result = executeArticlePurchase(room, participant, {
        year: body.year,
        articleId: body.articleId,
        requestId: body.requestId
      });

      if (!result.ok) {
        return sendJson(res, 400, result);
      }

      broadcastRoomState(room);
      return sendJson(res, 200, {
        ...result,
        state: serializeRoomForParticipant(room, participant.id)
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '기사 구매 중 오류가 발생했습니다.' });
    }
  }

  // 10. 전체 방 및 1:1 채팅 전송 (기획서 17쪽)
  if (req.method === 'POST' && pathname === '/api/rooms/chat') {
    try {
      const body = await parseJsonBody(req);
      const room = rooms.get((body.roomCode || '').toUpperCase().trim());
      if (!room) return sendJson(res, 404, { ok: false, message: '방을 찾을 수 없습니다.' });

      const participant = room.participants.get(body.participantId);
      if (!participant || participant.token !== body.token) {
        return sendJson(res, 401, { ok: false, message: '채팅 전송 권한이 없습니다.' });
      }

      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) {
        return sendJson(res, 400, { ok: false, message: '메시지를 입력해 주세요.' });
      }

      let targetId = body.targetId || null;
      let targetNickname = null;
      if (targetId) {
        const targetParticipant = room.participants.get(targetId);
        if (!targetParticipant) {
          return sendJson(res, 400, { ok: false, message: '대화 상대를 찾을 수 없습니다.' });
        }
        targetNickname = targetParticipant.nickname;
      }

      const chatMsg = {
        id: generateId('msg'),
        gameNumber: room.gameNumber || 1,
        scenarioId: room.scenario ? room.scenario.id : null,
        senderId: participant.id,
        senderNickname: participant.nickname,
        targetId,
        targetNickname,
        text: text.slice(0, 300),
        year: room.currentYear,
        timestamp: Date.now()
      };
      room.chats.push(chatMsg);

      broadcastRoomState(room);
      return sendJson(res, 200, { ok: true, message: chatMsg });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '메시지 전송에 실패했습니다.' });
    }
  }

  // 11. 같은 방에서 다시 플레이 / 초기화 (기획서 15쪽, 18쪽)
  if (req.method === 'POST' && pathname === '/api/rooms/reset') {
    try {
      const body = await parseJsonBody(req);
      const room = rooms.get((body.roomCode || '').toUpperCase().trim());
      if (!room) return sendJson(res, 404, { ok: false, message: '방을 찾을 수 없습니다.' });

      const participant = room.participants.get(body.participantId);
      if (!participant || participant.token !== body.token) {
        return sendJson(res, 401, { ok: false, message: '권한이 없습니다.' });
      }

      // 다시 플레이 시 기존 판에서 나온 대표 사건들을 제외하고 완전히 새로운 동적 시나리오·시세·사건을 생성
      // 이전 판 채팅은 유지하되, 새 판 번호(gameNumber)를 올려 이전 판 대화와 현재 판 대화를 구분
      for (const m of room.chats) {
        if (!m.gameNumber) m.gameNumber = room.gameNumber || 1;
      }
      room.gameNumber = (room.gameNumber || 1) + 1;
      const prevSignatures = room.playedEventSignatures || [];
      const newScenario = buildScenarioForRoom({
        excludedSignatures: prevSignatures,
        scenarioMode: body.scenarioMode === 'verification_p7' ? 'verification_p7' : 'dynamic'
      });
      room.scenario = newScenario;
      room.playedEventSignatures = [...prevSignatures, ...(newScenario.majorEvents || [])];
      prewarmScenarioArticles(room).catch(() => {});
      room.status = 'WAITING';
      room.currentYear = CONFIG.START_YEAR;
      room.phaseStartedAt = Date.now();
      room.phaseEndsAt = null;
      room.currentArticlePrice = 0;
      room.actionSeq = 0;
      room.processedRequests.clear();
      room.openingHistory = {};
      room.settlementResult = null;

      for (const p of room.participants.values()) {
        p.cash = CONFIG.INITIAL_CASH;
        p.yearStartTotalAssets = CONFIG.INITIAL_CASH;
        for (const s of STOCKS) {
          p.holdings[s.id] = { quantity: 0, avgBuyPrice: 0 };
        }
        p.purchasedArticles = [];
        p.articlePayments = [];
        p.orders = [];
        p.currentRank = 1;
        p.prevRank = 1;
        p.readyForNextPhase = p.isBot;
      }

      broadcastRoomState(room);
      return sendJson(res, 200, {
        ok: true,
        state: serializeRoomForParticipant(room, participant.id)
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: '방 초기화에 실패했습니다.' });
    }
  }

  // 12. 정적 배경 이미지 및 프론트엔드 파일 서빙
  if (req.method === 'GET') {
    if (pathname === '/assets/bg-desktop.png') {
      return serveStaticFile(res, path.join(__dirname, '푸른 시간의 서울 금융지구.png'));
    }
    if (pathname === '/assets/bg-mobile.png') {
      return serveStaticFile(res, path.join(__dirname, '모바일.png'));
    }

    const publicDir = path.join(__dirname, 'public');
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const targetPath = path.normalize(path.join(publicDir, safePath));
    if (targetPath.startsWith(publicDir) && fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      return serveStaticFile(res, targetPath);
    }
    return serveStaticFile(res, path.join(publicDir, 'index.html'));
  }

  sendJson(res, 404, { ok: false, message: 'Not Found' });
});

if (require.main === module) {
  const HOST = process.env.HOST || '0.0.0.0';
  server.listen(CONFIG.PORT, HOST, () => {
    console.log(`[개미광장] 모의 주식 웹게임 서버가 http://localhost:${CONFIG.PORT} (${HOST}:${CONFIG.PORT}) 에서 실행 중입니다.`);
  });
}

module.exports = { server, rooms, calculateArticlePrice };
