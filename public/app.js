/**
 * 개미광장 (모의 주식 웹게임) - 프론트엔드 클라이언트 로직
 * 기획서 1~18쪽 및 웹·모바일 프로토타입 화면 흐름(01~12)을 연결합니다.
 */

(function () {
  'use strict';

  const SESSION_STORAGE_KEY = 'ant_square_session_v1';
  const PLAYED_SCENARIOS_KEY = 'ant_square_played_scenarios_v1';
  const BGM_STORAGE_KEY = 'ant_square_bgm_enabled_v1';
  const WARNING_15S_STORAGE_KEY = 'ant_square_warned_15s_rounds_v1';

  // 서버 상태 및 UI 로컬 상태
  let appState = null;
  let session = null; // { roomCode, participantId, token, nickname }
  let eventSource = null;
  let isConnected = true;
  let serverClockOffset = 0;

  // BGM 싱글턴 오디오 인스턴스 (화면 전환 및 다시 플레이 시 겹쳐 재생 방지)
  let bgmAudio = null;
  let bgmAutoplayResumeBound = false;
  let warning15SecHideTimer = null;

  function loadWarned15SecRoundKeys() {
    try {
      const raw = sessionStorage.getItem(WARNING_15S_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }

  function persistWarned15SecRoundKeys(setObj) {
    try {
      const arr = Array.from(setObj).slice(-40);
      sessionStorage.setItem(WARNING_15S_STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      // ignore
    }
  }

  function ensureBgmAudio() {
    if (!bgmAudio) {
      bgmAudio = new Audio('/audio/bgm-ambient.wav');
      bgmAudio.loop = true;
      bgmAudio.volume = 0.14; // 기사 읽기와 거래에 방해되지 않는 낮은 볼륨
      bgmAudio.preload = 'auto';
    }
    return bgmAudio;
  }

  function syncBgmToggleUI() {
    const btn = $('btn-bgm-toggle');
    const icon = $('bgm-toggle-icon');
    const label = $('bgm-toggle-label');
    if (!btn) return;
    const isOn = Boolean(uiState.bgmEnabled);
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    btn.classList.toggle('is-on', isOn);
    if (icon) icon.textContent = isOn ? '🔊' : '🔇';
    if (label) label.textContent = isOn ? 'BGM 켜짐' : 'BGM 꺼짐';
  }

  function bindOneTimeBgmResume() {
    if (bgmAutoplayResumeBound) return;
    bgmAutoplayResumeBound = true;
    const resume = () => {
      bgmAutoplayResumeBound = false;
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      if (uiState.bgmEnabled) {
        const audio = ensureBgmAudio();
        if (audio.paused) {
          audio.play().catch(() => {});
        }
      }
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  function setBgmEnabled(enabled, { persist = true } = {}) {
    uiState.bgmEnabled = Boolean(enabled);
    if (persist) {
      try {
        localStorage.setItem(BGM_STORAGE_KEY, uiState.bgmEnabled ? 'true' : 'false');
      } catch (e) {
        // ignore
      }
    }
    syncBgmToggleUI();

    if (uiState.bgmEnabled) {
      const audio = ensureBgmAudio();
      if (audio.paused) {
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            // 브라우저 자동재생 정책으로 차단된 경우 첫 사용자 상호작용 시 1회 재개
            bindOneTimeBgmResume();
          });
        }
      }
    } else if (bgmAudio && !bgmAudio.paused) {
      bgmAudio.pause();
    }
  }

  function initBgm() {
    let savedEnabled = false;
    try {
      savedEnabled = localStorage.getItem(BGM_STORAGE_KEY) === 'true';
    } catch (e) {
      savedEnabled = false;
    }
    setBgmEnabled(savedEnabled, { persist: false });
  }

  const uiState = {
    entryMode: 'friend',          // 'friend' | 'solo'
    activeTab: 'market',          // 'market' | 'articles' | 'chat'
    showMyInvestment: false,      // 내 투자 패널 열림 여부
    mobileShowDetail: false,      // 모바일에서 종목 상세 드릴다운 여부
    mobileShowReader: false,      // 모바일에서 기사 본문 드릴다운 여부
    selectedStockId: 'a_enter',   // 기본 선택 종목
    detailSubview: 'order',       // 'order' | 'timeline' (종목 상세 내부 서브뷰)
    orderSide: 'BUY',             // 'BUY' | 'SELL'
    orderQty: 1,
    lastFocusedYear: null,
    lastTradingResetYear: null,   // 새 연도 거래 시작 시 '올해 기사' 기본 화면 초기화 기준 연도
    articleNav: 'current_free',   // 'current_free' (올해 기사) | 'paid_clues' (유료 단서) | 'archive' (보관함)
    selectedFreeArticleId: null,  // 올해 기사에서 읽던 무료 기사 ID
    selectedPaidStockId: null,    // 유료 단서에서 선택한 종목 ID
    selectedPaidArticleId: null,  // 유료 단서에서 선택한 단서 ID
    selectedArticleYear: 2011,    // 보관함 선택 연도
    showAllYearsInArticles: true, // 보관함에서 전 연도 모아보기 여부
    articleFilter: 'ALL',         // 보관함 필터: 'ALL' | 'OWNED' | 'ARC' | '바이오' | '반도체' | '조선' | '엔터' | 'OTHER'
    selectedArchiveArticleId: null, // 보관함에서 읽던 기사 ID
    articleScrollTopByNav: {      // 같은 연도 내 탭 이동 시 PC 목록 요소(#article-list-ul) 스크롤 위치 복원
      current_free: 0,
      paid_clues: 0,
      archive: 0
    },
    articlePageScrollYByNav: {    // 같은 연도 내 탭 이동 시 모바일/페이지 목록 영역(window.scrollY) 스크롤 위치 복원
      current_free: 0,
      paid_clues: 0,
      archive: 0
    },
    articleReaderPageScrollYByNav: { // 같은 연도 내 모바일 기사 본문 영역(window.scrollY) 스크롤 위치 복원
      current_free: 0,
      paid_clues: 0,
      archive: 0
    },
    pendingArticleScrollRestore: false, // 기사 탭/네비게이션/본문↔목록 전환 시 스크롤 복원 대기 여부
    cameFromArticles: false,      // 기사 본문의 '관련 종목 보기'에서 시장으로 이동했는지 여부
    selectedChatTargetId: null,   // null = 전체 방, participantId = 1:1 대화
    showPreviousGameChats: false, // '이전 판 대화' 펼침 여부 (새 판 시작 시 기본 접힘)
    lastRoomGameNumber: 1,        // 현재 방의 판 번호 추적
    readChatIds: new Set(),       // 현재 세션에서 읽음 처리된 채팅 메시지 ID 집합
    warned15SecRoundKeys: loadWarned15SecRoundKeys(), // 15초 경고가 이미 표시된 거래 라운드 키
    warning15SecTriggerCountByRound: {}, // 라운드별 15초 경고 트리거 횟수 (검증 및 중복 방지 확인용)
    bgmEnabled: false,            // BGM 켜짐 여부 (첫 방문은 항상 꺼짐)
    inspectingMarketDuringOpening: false, // 개장 결과 중 시장·내 투자 확인 모드
    isSubmittingOrder: false,
    isBuyingArticle: false,
    isEntrySubmitting: false
  };

  let isRenderingArticles = false;

  function getPageScrollY() {
    return Math.max(0, Math.round(window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0));
  }

  function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function isMobileReaderDrilldown() {
    return isMobileViewport() && Boolean(uiState.mobileShowReader);
  }

  function isArticlesPanelActiveAndVisible() {
    const tradingScreen = $('screen-trading');
    const articlesPanel = $('tab-panel-articles');
    return Boolean(
      uiState.activeTab === 'articles' &&
      tradingScreen &&
      !tradingScreen.classList.contains('hidden') &&
      articlesPanel &&
      !articlesPanel.classList.contains('hidden')
    );
  }

  function saveCurrentArticleScrollState(navKey = uiState.articleNav) {
    if (!navKey || isRenderingArticles || !isArticlesPanelActiveAndVisible()) return;
    const listUl = $('article-list-ul');
    if (listUl && listUl.offsetParent !== null) {
      uiState.articleScrollTopByNav[navKey] = listUl.scrollTop;
    }
    if (isMobileReaderDrilldown()) {
      uiState.articleReaderPageScrollYByNav[navKey] = getPageScrollY();
    } else {
      uiState.articlePageScrollYByNav[navKey] = getPageScrollY();
    }
  }

  function restoreArticleScrollState(navKey = uiState.articleNav) {
    if (!navKey) return;
    const listUl = $('article-list-ul');
    if (listUl && listUl.offsetParent !== null) {
      listUl.scrollTop = uiState.articleScrollTopByNav[navKey] || 0;
    }
    if (isArticlesPanelActiveAndVisible() && (uiState.pendingArticleScrollRestore || isMobileViewport())) {
      uiState.pendingArticleScrollRestore = false;
      const targetY = isMobileReaderDrilldown()
        ? (uiState.articleReaderPageScrollYByNav[navKey] || 0)
        : (uiState.articlePageScrollYByNav[navKey] || 0);
      window.scrollTo(0, targetY);
    }
  }

  /**
   * 종목별 추리 태그 정의 (숨겨진 회사 후보 표시 및 호재/악재 추리 메모)
   * 플레이어가 직접 단서를 조합해 종목에 붙이는 개인 추리 태그입니다.
   */
  const DEDUCTION_TAGS = [
    { id: 'bullish', label: '📈 호재 유력', colorClass: 'tag-bullish', industries: null },
    { id: 'bearish', label: '⚠️ 악재 주의', colorClass: 'tag-bearish', industries: null },
    { id: 'longterm', label: '⏳ 장기 관찰', colorClass: 'tag-longterm', industries: null },
    { id: 'obesity_cand', label: '💊 비만신약 후보', colorClass: 'tag-mystery', industries: ['바이오'] },
    { id: 'vaccine_cand', label: '💉 백신 후보', colorClass: 'tag-vaccine', industries: ['바이오'] },
    { id: 'mega_cand', label: '🚢 대형계약·증설 주목', colorClass: 'tag-mystery', industries: ['조선', '반도체', '엔터', '게임'] }
  ];

  function getDeductionStorageKey() {
    if (!appState || !session) return 'ant_square_deduction_default';
    return `ant_square_deduction_${appState.room.code}_${appState.room.scenarioId}_${session.participantId}`;
  }

  function loadAllDeductionNotes() {
    try {
      const raw = sessionStorage.getItem(getDeductionStorageKey());
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function getStockDeduction(stockId) {
    const all = loadAllDeductionNotes();
    const item = all[stockId] || { tags: [], memo: '' };
    return {
      tags: Array.isArray(item.tags) ? item.tags : [],
      memo: typeof item.memo === 'string' ? item.memo : ''
    };
  }

  function saveStockDeduction(stockId, nextData) {
    const all = loadAllDeductionNotes();
    all[stockId] = nextData;
    try {
      sessionStorage.setItem(getDeductionStorageKey(), JSON.stringify(all));
    } catch (e) {
      // ignore
    }
  }

  function toggleStockDeductionTag(stockId, tagId) {
    const cur = getStockDeduction(stockId);
    const exists = cur.tags.includes(tagId);
    const nextTags = exists ? cur.tags.filter((t) => t !== tagId) : [...cur.tags, tagId];
    saveStockDeduction(stockId, { ...cur, tags: nextTags });
  }

  function updateStockDeductionMemo(stockId, memoText) {
    const cur = getStockDeduction(stockId);
    saveStockDeduction(stockId, { ...cur, memo: String(memoText || '').slice(0, 80) });
  }

  function getAvailableTagsForStock(stock) {
    return DEDUCTION_TAGS.filter(
      (t) => !t.industries || t.industries.includes(stock.industry)
    );
  }

  /**
   * 특정 종목과 관련된 연도별 단서(무료 기사 + 유료 단서 + 공개된 개장 변동 이유) 수집
   * 주의 (기획서 5쪽): 숨겨진 회사(hideCompanyName: true) 무료 기사는 특정 한 종목이 아니라
   * 해당 업종(예: 바이오 2종목 모두)에 동일하게 '업종 공통 추리 기사'로 표시되어 정답이 조기 노출되지 않습니다.
   */
  function collectCluesForStock(stock) {
    if (!appState || !stock) return { totalCount: 0, ownedPaidCount: 0, byYear: [] };
    const { room, articlesByYear } = appState;
    const maxY = Math.min(room.currentYear, 2019);
    const openingsMap = new Map(
      (stock.disclosedOpenings || []).map((op) => [op.year, op])
    );

    let totalCount = 0;
    let ownedPaidCount = 0;
    const byYear = [];

    for (let y = room.currentYear; y >= 2010; y--) {
      const openingInfo = openingsMap.get(y) || null;
      const yearArts = y <= maxY ? (articlesByYear[y] || { free: [], paid: [] }) : { free: [], paid: [] };

      // 직접 연결된 무료 기사 또는 같은 업종의 회사명 숨김 무료 기사
      const relatedFree = (yearArts.free || []).filter((f) => {
        if (f.hideCompanyName) {
          return f.industry === stock.industry;
        }
        return (f.relatedStockIds || []).includes(stock.id) || f.industry === stock.industry;
      });

      // 해당 종목의 유료 기사
      const relatedPaid = (yearArts.paid || []).filter((p) => p.stockId === stock.id);

      for (const p of relatedPaid) {
        if (p.purchased) ownedPaidCount++;
      }

      const yearClueCount = relatedFree.length + relatedPaid.filter((p) => p.purchased).length + (openingInfo ? 1 : 0);
      totalCount += yearClueCount;

      byYear.push({
        year: y,
        priceAtYear: (stock.priceHistory.find((ph) => ph.year === y) || {}).price || stock.currentPrice,
        openingInfo,
        freeArticles: relatedFree,
        paidArticles: relatedPaid
      });
    }

    return { totalCount, ownedPaidCount, byYear };
  }

  // DOM 헬퍼
  const $ = (id) => document.getElementById(id);

  function resetOrderQuantityToOne() {
    uiState.orderQty = 1;
    const qtyInput = $('input-order-qty');
    if (qtyInput) {
      qtyInput.value = '1';
    }
  }

  function formatWon(num) {
    const n = Number(num) || 0;
    return `${n.toLocaleString('ko-KR')}원`;
  }

  function formatSignedWon(num) {
    const n = Number(num) || 0;
    if (n > 0) return `+${n.toLocaleString('ko-KR')}원`;
    if (n < 0) return `−${Math.abs(n).toLocaleString('ko-KR')}원`;
    return '0원';
  }

  function formatRate(rate) {
    const r = Number(rate) || 0;
    if (r > 0) return `+${r}%`;
    if (r < 0) return `−${Math.abs(r)}%`;
    return '0%';
  }

  function formatMMSS(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function showToast(msg, isError = false) {
    const container = $('toast-container');
    if (!container) return;
    const item = document.createElement('div');
    item.className = `toast-item${isError ? ' error' : ''}`;
    item.textContent = msg;
    container.appendChild(item);
    setTimeout(() => {
      item.remove();
    }, 3200);
  }

  function saveSession(sess) {
    session = sess;
    if (sess) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sess));
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getPlayedScenarios() {
    try {
      const raw = localStorage.getItem(PLAYED_SCENARIOS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function recordPlayedScenario(scenarioId) {
    if (!scenarioId) return;
    const list = getPlayedScenarios();
    if (!list.includes(scenarioId)) {
      list.push(scenarioId);
      try {
        localStorage.setItem(PLAYED_SCENARIOS_KEY, JSON.stringify(list));
      } catch (e) {
        // ignore
      }
    }
  }

  async function apiPost(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  /**
   * SSE 실시간 스트림 연결 (기획서 11쪽 재접속 처리 포함)
   */
  function connectSSE() {
    if (!session) return;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    const qs = new URLSearchParams({
      roomCode: session.roomCode,
      participantId: session.participantId,
      token: session.token
    });

    const es = new EventSource(`/api/events?${qs.toString()}`);
    eventSource = es;

    es.onopen = () => {
      isConnected = true;
      $('reconnect-banner').classList.add('hidden');
      if (appState) renderAll();
    };

    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'ROOM_STATE' && msg.payload) {
          isConnected = true;
          $('reconnect-banner').classList.add('hidden');
          applyServerState(msg.payload);
        }
      } catch (err) {
        // ignore parse error
      }
    };

    es.onerror = () => {
      isConnected = false;
      $('reconnect-banner').classList.remove('hidden');
      if (appState) renderOrderPanel();
    };
  }

  /**
   * 서버 상태를 수신하여 화면 갱신
   */
  function applyServerState(newState) {
    const prevStatus = appState ? appState.room.status : null;
    const prevYear = appState ? appState.room.currentYear : null;

    appState = newState;
    if (newState.serverNow) {
      serverClockOffset = newState.serverNow - Date.now();
    }

    const currentGameNumber = (newState.room && newState.room.gameNumber) || 1;
    if (uiState.lastRoomGameNumber !== currentGameNumber) {
      uiState.lastRoomGameNumber = currentGameNumber;
      uiState.showPreviousGameChats = false;
    }

    // 새 연도 거래 시작 시 '올해 기사'를 기본 화면으로 초기화하고, 같은 연도 내에서는 읽던 기사와 목록 위치를 유지
    if (prevYear !== newState.room.currentYear || prevStatus !== newState.room.status) {
      if (newState.room.status === 'TRADING') {
        uiState.inspectingMarketDuringOpening = false;
        if (uiState.lastTradingResetYear !== newState.room.currentYear) {
          uiState.lastTradingResetYear = newState.room.currentYear;
          resetOrderQuantityToOne();
          uiState.articleNav = 'current_free';
          uiState.selectedFreeArticleId = null;
          uiState.selectedPaidStockId = null;
          uiState.selectedPaidArticleId = null;
          uiState.selectedArticleYear = newState.room.currentYear;
          uiState.mobileShowReader = false;
          uiState.cameFromArticles = false;
          uiState.articleScrollTopByNav = {
            current_free: 0,
            paid_clues: 0,
            archive: 0
          };
          uiState.articlePageScrollYByNav = {
            current_free: 0,
            paid_clues: 0,
            archive: 0
          };
          uiState.articleReaderPageScrollYByNav = {
            current_free: 0,
            paid_clues: 0,
            archive: 0
          };
          uiState.pendingArticleScrollRestore = true;
        }
      }
      if (newState.room.status === 'OPENING') {
        uiState.inspectingMarketDuringOpening = false;
        uiState.cameFromArticles = false;
      }
      if (newState.room.status === 'SETTLEMENT') {
        recordPlayedScenario(newState.room.scenarioId);
      }
    }

    renderAll();
  }

  /**
   * 현재 활성 화면 전환 및 전체 렌더링
   */
  function renderAll() {
    const screens = ['screen-entry', 'screen-waiting', 'screen-tutorial', 'screen-trading', 'screen-opening', 'screen-settlement'];

    if (!appState || !session) {
      for (const s of screens) {
        $(s).classList.toggle('hidden', s !== 'screen-entry');
      }
      return;
    }

    const status = appState.room.status;
    let activeScreenId = 'screen-entry';

    if (status === 'WAITING') {
      activeScreenId = 'screen-waiting';
    } else if (status === 'TUTORIAL') {
      activeScreenId = 'screen-tutorial';
    } else if (status === 'TRADING') {
      activeScreenId = 'screen-trading';
    } else if (status === 'OPENING') {
      activeScreenId = uiState.inspectingMarketDuringOpening ? 'screen-trading' : 'screen-opening';
    } else if (status === 'SETTLEMENT') {
      activeScreenId = 'screen-settlement';
    }

    for (const s of screens) {
      $(s).classList.toggle('hidden', s !== activeScreenId);
    }

    if (activeScreenId === 'screen-waiting') {
      renderWaitingScreen();
    } else if (activeScreenId === 'screen-tutorial') {
      renderTutorialScreen();
    } else if (activeScreenId === 'screen-trading') {
      renderTradingScreen();
    } else if (activeScreenId === 'screen-opening') {
      renderOpeningScreen();
    } else if (activeScreenId === 'screen-settlement') {
      renderSettlementScreen();
    }

    updateTimersDisplay();
  }

  /**
   * 02. 대기방 화면 렌더링
   */
  function renderWaitingScreen() {
    const { room, me, participants } = appState;
    $('waiting-room-name-label').textContent = `${room.mode === 'solo' ? '1인 모드' : '친구방 대기'} · ${room.name}`;
    $('waiting-count-badge').textContent = `${participants.length} / ${room.capacity}명`;
    $('waiting-room-code').textContent = room.code;

    const ul = $('waiting-participants-list');
    ul.innerHTML = '';

    participants.forEach((p, idx) => {
      const li = document.createElement('li');
      li.className = 'participant-row';
      const firstChar = (p.nickname || '?').charAt(0);
      const badgeClass = idx === 0 ? '' : ` alt-${idx % 3 || 1}`;
      const roleText = p.isHost ? '방장' : (p.isBot ? 'AI 봇' : (p.connected ? '참가 중' : '재접속 대기'));

      li.innerHTML = `
        <div class="participant-left">
          <span class="avatar-badge${badgeClass}">${firstChar}</span>
          <span class="participant-name">${escapeHtml(p.nickname)}${p.id === me.id ? ' <span class="me-pill">나</span>' : ''}</span>
        </div>
        <span class="participant-role${p.isHost ? ' host' : ''}">${roleText}</span>
      `;
      ul.appendChild(li);
    });

    const startBtn = $('btn-start-game');
    const hintEl = $('waiting-status-hint');

    if (me.isHost) {
      const minRequired = room.mode === 'friend' ? 2 : 1;
      const canStart = participants.length >= minRequired;
      startBtn.disabled = !canStart;
      startBtn.textContent = '게임 시작';
      hintEl.textContent = canStart
        ? '참가자가 모였습니다. 게임 시작을 누르면 동시에 시작합니다.'
        : `최소 ${minRequired}명 이상 참가해야 시작할 수 있습니다.`;
    } else {
      startBtn.disabled = true;
      startBtn.textContent = '방장 시작 대기 중';
      hintEl.textContent = '방장이 게임을 시작하면 동시에 튜토리얼과 첫 거래가 열립니다.';
    }
  }

  /**
   * 03. 튜토리얼 화면 렌더링
   */
  function renderTutorialScreen() {
    const { room, me } = appState;
    const statusText = $('tutorial-ready-status');
    if (room.mode === 'friend') {
      statusText.textContent = me.readyForNextPhase
        ? `내 준비 완료! 다른 참가자를 기다리는 중입니다 (${room.readyHumanCount} / ${room.totalHumanCount}명 완료)`
        : `참가자 준비 현황: ${room.readyHumanCount} / ${room.totalHumanCount}명`;
    } else {
      statusText.textContent = '확인 또는 건너뛰기를 누르면 즉시 2010년 첫 거래를 시작합니다.';
    }

    $('btn-tutorial-skip').disabled = me.readyForNextPhase;
    $('btn-tutorial-confirm').disabled = me.readyForNextPhase;
  }

  /**
   * 04 ~ 09. 메인 거래 화면 렌더링 (상단바 + 시장 / 기사 / 채팅 탭)
   */
  function renderTradingScreen() {
    const { room, me } = appState;

    // 상단 상태바 (현재 연도, 남은 시간 + 마감 준비, 거래 가능 현금 집중 배치)
    $('top-year-label').textContent = `${room.currentYear}년`;
    $('top-round-label').textContent = `${room.roundIndex} / ${room.totalRounds}`;
    $('top-available-cash').textContent = formatWon(me.cash);
    $('room-code-mini-chip').textContent = `방 코드: ${room.code}`;

    // 총자산과 직전 순위는 '내 투자'에서 확인하도록 항상 최신 값으로 동기화
    if ($('pf-total-assets')) {
      $('pf-total-assets').textContent = formatWon(me.totalAssets);
    }
    if ($('pf-my-rank')) {
      const rankDelta = (me.prevRank || me.currentRank) - me.currentRank;
      let rankSuffix = '';
      if (room.currentYear > 2010) {
        if (rankDelta > 0) rankSuffix = ` (↑${rankDelta})`;
        else if (rankDelta < 0) rankSuffix = ` (↓${Math.abs(rankDelta)})`;
      }
      $('pf-my-rank').textContent = `${me.currentRank}위${rankSuffix}`;
    }

    // 거래 마감 준비 버튼 및 개장 결과 복귀 버튼
    const readyBtn = $('btn-trading-ready');
    const backToOpeningBtn = $('btn-back-to-opening');

    if (room.status === 'OPENING' && uiState.inspectingMarketDuringOpening) {
      readyBtn.classList.add('hidden');
      backToOpeningBtn.classList.remove('hidden');
      backToOpeningBtn.textContent = `${room.currentYear}년 개장 결과로 돌아가기`;
    } else {
      backToOpeningBtn.classList.add('hidden');
      readyBtn.classList.remove('hidden');
      readyBtn.classList.toggle('is-ready', me.readyForNextPhase);
      readyBtn.textContent = me.readyForNextPhase
        ? `마감 대기 중 (${room.readyHumanCount}/${room.totalHumanCount})`
        : `마감 준비 (${room.readyHumanCount}/${room.totalHumanCount})`;
    }

    // 기사 탭 배지 (거래 단계가 시작되어 올해 무료 기사 5개가 공개된 시점에만 '5' 표시)
    const artBadge = $('tab-article-badge');
    if (room.currentYear >= 2011 && room.status === 'TRADING') {
      artBadge.textContent = '5';
      artBadge.classList.remove('hidden');
    } else {
      artBadge.classList.add('hidden');
    }

    // 탭 활성화 동기화
    document.querySelectorAll('.main-tab-btn, .mobile-nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === uiState.activeTab);
    });

    $('tab-panel-market').classList.toggle('hidden', uiState.activeTab !== 'market');
    $('tab-panel-articles').classList.toggle('hidden', uiState.activeTab !== 'articles');
    $('tab-panel-chat').classList.toggle('hidden', uiState.activeTab !== 'chat');

    // 각 탭 세부 렌더링
    renderMarketTab();
    renderArticlesTab();
    renderChatTab();
  }

  /**
   * 시장 탭 (10종목 목록 + 종목 상세 / 내 투자)
   */
  function renderMarketTab() {
    const { room, stocks } = appState;
    const marketGrid = document.querySelector('.market-grid');
    if (marketGrid) {
      marketGrid.classList.toggle('mobile-show-detail', uiState.mobileShowDetail || uiState.showMyInvestment);
    }

    $('market-2010-notice').textContent = room.currentYear === 2010
      ? '2010년은 기사 없이 시작합니다. 무료 기사 5개와 유료 기사는 2011년 거래가 시작될 때 공개됩니다.'
      : (room.status === 'OPENING'
        ? `현재 ${room.currentYear}년 개장 결과 확인 단계입니다. ${room.currentYear}년 무료 기사 5개와 유료 기사 목록은 거래 시작 시 동시에 공개됩니다.`
        : `${room.currentYear}년 무료 기사 5건이 공개되었습니다. 기사 탭에서 단서를 확인하세요.`);

    const ul = $('stock-list-ul');
    ul.innerHTML = '';

    for (const stock of stocks) {
      const li = document.createElement('li');
      const isSelected = stock.id === uiState.selectedStockId;
      li.className = `stock-item-row${isSelected ? ' selected' : ''}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');

      let changeText = '—';
      let changeClass = 'text-neutral';
      if (!stock.isBaseYear) {
        changeText = formatRate(stock.changeRatePercent);
        if (stock.changeRatePercent > 0) changeClass = 'text-up';
        else if (stock.changeRatePercent < 0) changeClass = 'text-down';
      }

      const holdClass = stock.myQuantity > 0 ? 'stock-hold-cell has-holding' : 'stock-hold-cell';
      const deduction = getStockDeduction(stock.id);
      const clues = collectCluesForStock(stock);

      const tagBadgesHtml = deduction.tags
        .map((tid) => {
          const tMeta = DEDUCTION_TAGS.find((t) => t.id === tid);
          return tMeta
            ? `<span class="stock-tag-pill ${tMeta.colorClass}">${escapeHtml(tMeta.label)}</span>`
            : '';
        })
        .join('');

      const ownedClueHtml = clues.ownedPaidCount > 0
        ? `<span class="stock-clue-pill">내 단서 ${clues.ownedPaidCount}</span>`
        : '';

      li.innerHTML = `
        <div class="stock-name-cell">
          <span class="stock-badge">${escapeHtml(stock.badge)}</span>
          <div class="stock-title-wrap">
            <span class="stock-title-main">${escapeHtml(stock.name)}</span>
            <span class="stock-title-sub">${escapeHtml(stock.industry)}</span>
            ${(tagBadgesHtml || ownedClueHtml) ? `<div class="stock-tags-inline">${tagBadgesHtml}${ownedClueHtml}</div>` : ''}
          </div>
        </div>
        <div class="stock-price-cell">${formatWon(stock.currentPrice)}</div>
        <div class="stock-change-cell ${changeClass}">${changeText}</div>
        <div class="${holdClass}">${stock.myQuantity.toLocaleString('ko-KR')}주</div>
      `;

      li.addEventListener('click', () => {
        if (uiState.selectedStockId !== stock.id) {
          resetOrderQuantityToOne();
        }
        uiState.selectedStockId = stock.id;
        uiState.showMyInvestment = false;
        uiState.mobileShowDetail = true;
        renderMarketTab();
      });

      ul.appendChild(li);
    }

    // 오른쪽 패널: 내 투자 vs 종목 상세
    $('market-detail-col').classList.toggle('hidden', uiState.showMyInvestment);
    $('market-portfolio-col').classList.toggle('hidden', !uiState.showMyInvestment);
    $('btn-toggle-my-investment').textContent = uiState.showMyInvestment ? '종목 주문' : '내 투자';

    if (uiState.showMyInvestment) {
      renderPortfolioPanel();
    } else {
      renderOrderPanel();
    }
  }

  /**
   * 종목 상세 및 매수·매도 주문 패널 렌더링
   */
  function renderOrderPanel() {
    if (!appState) return;
    const { room, me, stocks } = appState;
    const stock = stocks.find((s) => s.id === uiState.selectedStockId) || stocks[0];
    if (!stock) return;

    $('detail-industry-chip').textContent = stock.industry;
    $('detail-stock-name').textContent = stock.name;
    $('detail-public-business').textContent = stock.publicBusiness;
    $('detail-current-price').textContent = formatWon(stock.currentPrice);

    const returnArticleBar = $('detail-return-article-bar');
    if (returnArticleBar) {
      returnArticleBar.classList.toggle('hidden', !uiState.cameFromArticles);
    }

    const badgeEl = $('detail-change-badge');
    if (stock.isBaseYear) {
      badgeEl.className = 'detail-change-badge neutral';
      badgeEl.textContent = '첫 거래';
    } else if (stock.changeRatePercent > 0) {
      badgeEl.className = 'detail-change-badge up';
      badgeEl.textContent = formatRate(stock.changeRatePercent);
    } else if (stock.changeRatePercent < 0) {
      badgeEl.className = 'detail-change-badge down';
      badgeEl.textContent = formatRate(stock.changeRatePercent);
    } else {
      badgeEl.className = 'detail-change-badge neutral';
      badgeEl.textContent = '0%';
    }

    $('detail-my-qty').textContent = `${stock.myQuantity.toLocaleString('ko-KR')}주`;
    $('detail-my-eval').textContent = formatWon(stock.myEvaluation);
    if (stock.myQuantity > 0) {
      $('detail-my-avg-wrap').classList.remove('hidden');
      $('detail-my-avg').textContent = formatWon(stock.myAvgBuyPrice);
    } else {
      $('detail-my-avg-wrap').classList.add('hidden');
    }

    // 내 추리 태그 & 단서 메모 렌더링
    renderStockDeductionBox(stock);

    // 단서 타임라인 카운트 및 서브뷰 전환
    const cluesInfo = collectCluesForStock(stock);
    $('detail-timeline-count').textContent = String(cluesInfo.totalCount);

    const isTimelineView = uiState.detailSubview === 'timeline';
    $('btn-detail-view-order').classList.toggle('active', !isTimelineView);
    $('btn-detail-view-timeline').classList.toggle('active', isTimelineView);
    $('detail-order-subview').classList.toggle('hidden', isTimelineView);
    $('detail-timeline-subview').classList.toggle('hidden', !isTimelineView);

    if (isTimelineView) {
      renderStockTimelineSubview(stock, cluesInfo);
    }

    // 차트 영역 렌더링 (2010년은 안내 문구, 2011년 이상은 SVG 추세 차트)
    renderStockChartBox(stock);

    // 매수/매도 탭 상태
    const isBuy = uiState.orderSide === 'BUY';
    $('btn-side-buy').className = `order-side-btn${isBuy ? ' active-buy' : ''}`;
    $('btn-side-sell').className = `order-side-btn${!isBuy ? ' active-sell' : ''}`;

    // 수량 입력창 동기화 (포커스 중이 아닐 때만 값 덮어쓰기)
    const qtyInput = $('input-order-qty');
    if (document.activeElement !== qtyInput) {
      qtyInput.value = String(uiState.orderQty);
    }

    const qty = Math.max(0, Math.floor(Number(uiState.orderQty) || 0));
    const maxBuyQty = Math.floor(me.cash / stock.currentPrice);
    const maxSellQty = stock.myQuantity;
    const maxAllowedQty = isBuy ? maxBuyQty : maxSellQty;

    $('calc-max-label').textContent = isBuy ? '최대 매수 가능 수량' : '매도 가능 보유 수량';
    $('calc-max-qty').textContent = `${maxAllowedQty.toLocaleString('ko-KR')}주`;

    const orderAmount = qty * stock.currentPrice;
    const cashAfter = isBuy ? me.cash - orderAmount : me.cash + orderAmount;

    $('calc-order-amount').textContent = formatWon(orderAmount);
    $('calc-cash-after').textContent = formatWon(Math.max(0, cashAfter));

    // 상태 및 유효성 텍스트 구분 표시 (기획서 9쪽: 잔고 부족, 수량 초과, 마감, 연결 복구 중은 텍스트로 구분)
    const statusEl = $('order-status-text');
    const submitBtn = $('btn-submit-order');

    let blockReason = null;
    if (!isConnected) {
      blockReason = '연결 복구 중: 서버와 재접속이 완료될 때까지 주문이 잠깁니다.';
    } else if (room.status !== 'TRADING') {
      blockReason = '마감: 현재 연도의 거래가 마감되었습니다.';
    } else if (qty < 1) {
      blockReason = '수량을 1주 이상 정수로 입력해 주세요.';
    } else if (isBuy && orderAmount > me.cash) {
      blockReason = `잔고 부족: 보유 현금(${formatWon(me.cash)})을 초과하여 매수할 수 없습니다. (최대 ${maxBuyQty}주)`;
    } else if (!isBuy && qty > maxSellQty) {
      blockReason = `수량 초과: 보유 수량(${maxSellQty}주) 이하만 매도할 수 있습니다.`;
    }

    if (blockReason) {
      statusEl.textContent = blockReason;
      statusEl.className = 'order-status-text error';
      statusEl.classList.remove('hidden');
      submitBtn.disabled = true;
    } else {
      statusEl.classList.add('hidden');
      submitBtn.disabled = uiState.isSubmittingOrder;
    }

    if (uiState.isSubmittingOrder) {
      submitBtn.textContent = '주문 처리 중...';
    } else {
      submitBtn.textContent = `${stock.name} ${qty.toLocaleString('ko-KR')}주 ${isBuy ? '매수' : '매도'}`;
    }
  }

  /**
   * 종목 상세 내 '내 추리 태그 & 한줄 메모' 렌더링
   */
  function renderStockDeductionBox(stock) {
    const tagsContainer = $('detail-deduction-tags');
    const memoInput = $('input-deduction-memo');
    if (!tagsContainer || !memoInput) return;

    const currentDeduction = getStockDeduction(stock.id);
    const availableTags = getAvailableTagsForStock(stock);

    tagsContainer.innerHTML = '';
    for (const tag of availableTags) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = currentDeduction.tags.includes(tag.id);
      btn.className = `deduction-tag-btn ${tag.colorClass}${isActive ? ' active' : ''}`;
      btn.textContent = tag.label;
      btn.addEventListener('click', () => {
        toggleStockDeductionTag(stock.id, tag.id);
        renderMarketTab();
      });
      tagsContainer.appendChild(btn);
    }

    if (document.activeElement !== memoInput) {
      memoInput.value = currentDeduction.memo || '';
    }
  }

  /**
   * 종목별 단서 타임라인 서브뷰 렌더링
   * - 연도별(현재 연도 -> 2010년) 공개된 개장 변동 이유, 관련 무료 기사(숨겨진 회사 업종 공통 기사 포함),
   *   내가 구매한 유료 단서 및 올해 미구매 유료 단서 바로가기를 한눈에 보여줍니다.
   */
  function renderStockTimelineSubview(stock, cluesInfo) {
    const listEl = $('detail-timeline-list');
    if (!listEl || !appState) return;
    const { room } = appState;

    listEl.innerHTML = '';

    for (const yrGroup of cluesInfo.byYear) {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'tl-year-group';

      let priceHeaderRight = `기준가 ${formatWon(yrGroup.priceAtYear)}`;
      let priceHeaderClass = 'tl-price-summary text-neutral';

      if (yrGroup.openingInfo) {
        const op = yrGroup.openingInfo;
        priceHeaderRight = `${formatWon(op.prevPrice)} → ${formatWon(op.currentPrice)} (${formatRate(op.changeRatePercent)})`;
        priceHeaderClass = `tl-price-summary ${op.changeRatePercent > 0 ? 'text-up' : (op.changeRatePercent < 0 ? 'text-down' : 'text-neutral')}`;
      }

      let cardsHtml = '';

      // 1. 해당 연도 개장 시세 변동 이유
      if (yrGroup.openingInfo) {
        cardsHtml += `
          <div class="tl-event-card">
            <div class="tl-card-top">
              <span class="tl-card-tag">${yrGroup.year}년 개장 반영 결과</span>
              <span style="font-size:11px;color:#9bb2c0;">확정 시세</span>
            </div>
            <div class="tl-card-body">${escapeHtml(yrGroup.openingInfo.reason)}</div>
          </div>
        `;
      } else if (yrGroup.year === 2010) {
        cardsHtml += `
          <div class="tl-event-card">
            <div class="tl-card-top">
              <span class="tl-card-tag">2010년 첫 거래</span>
              <span style="font-size:11px;color:#9bb2c0;">기사 없음</span>
            </div>
            <div class="tl-card-body">2010년 시작가 ${formatWon(yrGroup.priceAtYear)}으로 첫 거래가 시작되었습니다.</div>
          </div>
        `;
      }

      // 2. 해당 연도 무료 기사 (직접 관련 또는 업종 공통 숨겨진 회사 기사)
      for (const fArt of yrGroup.freeArticles) {
        const isMystery = Boolean(fArt.hideCompanyName);
        const stageText = fArt.arcStageLabel ? ` · ${escapeHtml(fArt.arcStageLabel)}` : '';
        cardsHtml += `
          <div class="tl-event-card${isMystery ? ' mystery-free' : ''}">
            <div class="tl-card-top">
              <span class="tl-card-tag${isMystery ? ' warn' : ''}">
                ${isMystery ? `무료 기사 · ${escapeHtml(fArt.industry)} 업종 공통 (대상 회사 추리)` : `무료 기사 · ${escapeHtml(fArt.industry)}`}
              </span>
              <span style="font-size:11px;color:#9bb2c0;">${yrGroup.year}년 공개${stageText}</span>
            </div>
            <div class="tl-card-title">${escapeHtml(fArt.title)}</div>
            <div class="tl-card-body">${escapeHtml(fArt.body)}</div>
          </div>
        `;
      }

      // 3. 해당 연도 유료 단서 (구매 완료 시 본문 전체 표시, 다른 유형 선택 완료 시 '올해 단서 선택 완료' 표시, 미구매 시 올해 거래 중이면 바로 구매/조사 이동 버튼 표시)
      for (const pArt of yrGroup.paidArticles) {
        const stageText = pArt.arcStageLabel ? ` · ${escapeHtml(pArt.arcStageLabel)}` : '';
        const typeTag = pArt.clueTypeLabel ? ` (${escapeHtml(pArt.clueTypeLabel)})` : '';
        if (pArt.purchased) {
          cardsHtml += `
            <div class="tl-event-card paid-owned">
              <div class="tl-card-top">
                <span class="tl-card-tag">내가 구매한 유료 단서 · ${escapeHtml(pArt.preTitle)}</span>
                <span style="font-size:11px;color:#4fe3b5;font-weight:700;">구매 완료${stageText}</span>
              </div>
              <div class="tl-card-title">${escapeHtml(pArt.postTitle)}</div>
              <div class="tl-card-body">${escapeHtml(pArt.body)}</div>
            </div>
          `;
        } else if (pArt.lockedBySibling) {
          cardsHtml += `
            <div class="tl-event-card paid-locked-sibling" style="opacity:0.75;">
              <div class="tl-card-top">
                <span class="tl-card-tag" style="color:#9bb2c0;">${escapeHtml(pArt.preTitle)}</span>
                <span class="tl-locked-pill">올해 단서 선택 완료</span>
              </div>
              <div class="tl-card-body">알려주는 정보: ${escapeHtml(pArt.whatItTells || pArt.subtitle)} · 이 종목의 올해 유료 단서는 하나만 구매할 수 있어요.</div>
            </div>
          `;
        } else if (yrGroup.year === room.currentYear && room.status === 'TRADING') {
          cardsHtml += `
            <div class="tl-event-card">
              <div class="tl-card-top">
                <span class="tl-card-tag warn">올해 유료 단서 미구매 · ${escapeHtml(pArt.preTitle)}</span>
                <span style="font-size:11px;color:#9bb2c0;">${formatWon(pArt.price)}${stageText}</span>
              </div>
              <div class="tl-card-body">
                <strong>알려주는 정보${typeTag}:</strong> ${escapeHtml(pArt.whatItTells || pArt.subtitle)}
                ${pArt.hasChoicePair ? '<div style="font-size:11.5px;color:#ffca68;margin-top:4px;">※ 이 종목의 올해 유료 단서는 하나만 구매할 수 있어요</div>' : ''}
              </div>
              <button
                type="button"
                class="tl-card-action-btn"
                data-goto-paid-id="${escapeHtml(pArt.id)}"
                data-goto-paid-year="${yrGroup.year}"
              >
                기사 탭에서 [${escapeHtml(pArt.clueTypeLabel || '유료 단서')}] 조사하기 (${formatWon(pArt.price)})
              </button>
            </div>
          `;
        } else {
          cardsHtml += `
            <div class="tl-event-card" style="opacity:0.65;">
              <div class="tl-card-top">
                <span class="tl-card-tag" style="color:#657f8f;">지난해 미구매 유료 단서 · ${escapeHtml(pArt.preTitle)}</span>
                <span style="font-size:11px;color:#657f8f;">구매 종료</span>
              </div>
              <div class="tl-card-body">${yrGroup.year}년에 구매하지 않고 마감된 유료 기사입니다.</div>
            </div>
          `;
        }
      }

      groupDiv.innerHTML = `
        <div class="tl-year-header">
          <span class="tl-year-badge">${yrGroup.year}년</span>
          <span class="${priceHeaderClass}">${priceHeaderRight}</span>
        </div>
        ${cardsHtml}
      `;

      groupDiv.querySelectorAll('[data-goto-paid-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          uiState.articleNav = 'paid_clues';
          uiState.selectedPaidStockId = stock.id;
          uiState.selectedPaidArticleId = btn.dataset.gotoPaidId;
          uiState.mobileShowReader = true;
          switchTab('articles');
        });
      });

      listEl.appendChild(groupDiv);
    }
  }

  /**
   * 종목 과거 가격 차트 렌더링
   */
  function renderStockChartBox(stock) {
    const box = $('detail-chart-box');
    const history = stock.priceHistory || [];
    if (history.length <= 1) {
      box.innerHTML = `
        <span class="chart-empty-title">2010년 기준가</span>
        <strong class="chart-empty-sub">가격 추이는 다음 개장부터</strong>
      `;
      return;
    }

    const prices = history.map((h) => h.price);
    const minP = Math.min(...prices) * 0.95;
    const maxP = Math.max(...prices) * 1.05 || 1;
    const w = 360;
    const h = 72;
    const padX = 24;
    const padY = 12;

    const points = history.map((item, idx) => {
      const x = padX + (idx / Math.max(1, history.length - 1)) * (w - padX * 2);
      const ratio = maxP === minP ? 0.5 : (item.price - minP) / (maxP - minP);
      const y = h - padY - ratio * (h - padY * 2);
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), year: item.year, price: item.price };
    });

    const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
    const lastPt = points[points.length - 1];
    const firstYear = history[0].year;
    const lastYear = history[history.length - 1].year;

    box.innerHTML = `
      <svg width="100%" height="76" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="#4fe3b5"
          stroke-width="2.5"
          points="${polylinePoints}"
        />
        <circle cx="${lastPt.x}" cy="${lastPt.y}" r="4" fill="#4fe3b5" />
      </svg>
      <div style="width:100%;display:flex;justify-content:space-between;font-size:11px;color:#657f8f;">
        <span>${firstYear}년 (${formatWon(history[0].price)})</span>
        <span>${lastYear}년 (${formatWon(lastPt.price)})</span>
      </div>
    `;
  }

  /**
   * 내 투자 패널 렌더링 (기획서 3쪽, 9쪽: 현금, 주식 평가액 합계, 종목별 보유 수량·평균 매수가·미실현 손익, 주문/기사 결제 내역)
   */
  function renderPortfolioPanel() {
    if (!appState) return;
    const { room, me } = appState;

    $('pf-cash').textContent = formatWon(me.cash);
    $('pf-stock-eval').textContent = formatWon(me.stockEvaluation);
    $('pf-total-assets').textContent = formatWon(me.totalAssets);
    if ($('pf-my-rank')) {
      const rankDelta = (me.prevRank || me.currentRank) - me.currentRank;
      let rankSuffix = '';
      if (room.currentYear > 2010) {
        if (rankDelta > 0) rankSuffix = ` (↑${rankDelta})`;
        else if (rankDelta < 0) rankSuffix = ` (↓${Math.abs(rankDelta)})`;
      }
      $('pf-my-rank').textContent = `${me.currentRank}위${rankSuffix}`;
    }

    const heldListEl = $('pf-holdings-list');
    heldListEl.innerHTML = '';

    const heldStocks = (me.holdingsDetail || []).filter((h) => h.quantity > 0);
    if (heldStocks.length === 0) {
      heldListEl.innerHTML = `<div class="pf-history-item" style="color:#657f8f;">현재 보유 중인 주식이 없습니다.</div>`;
    } else {
      for (const h of heldStocks) {
        const div = document.createElement('div');
        div.className = 'pf-holding-item';
        const pnlClass = h.unrealizedPnl > 0 ? 'text-up' : (h.unrealizedPnl < 0 ? 'text-down' : 'text-neutral');
        div.innerHTML = `
          <div>
            <strong>${escapeHtml(h.name)} · ${h.quantity.toLocaleString('ko-KR')}주</strong>
            <div style="font-size:12px;color:#9bb2c0;">
              평균 매수가 ${formatWon(h.avgBuyPrice)} · 현재가 ${formatWon(h.currentPrice)}
            </div>
          </div>
          <div style="text-align:right;">
            <strong>${formatWon(h.evaluation)}</strong>
            <div class="${pnlClass}" style="font-size:12px;font-weight:700;">
              미실현 ${formatSignedWon(h.unrealizedPnl)} (${formatRate(h.unrealizedRate)})
            </div>
          </div>
        `;
        div.addEventListener('click', () => {
          if (uiState.selectedStockId !== h.stockId) {
            resetOrderQuantityToOne();
          }
          uiState.selectedStockId = h.stockId;
          uiState.showMyInvestment = false;
          uiState.mobileShowDetail = true;
          renderMarketTab();
        });
        heldListEl.appendChild(div);
      }
    }

    // 내 주문 및 기사 결제 내역
    const historyEl = $('pf-history-list');
    historyEl.innerHTML = '';

    const combinedLogs = [
      ...(me.orders || []).map((o) => ({
        timestamp: o.timestamp,
        year: o.year,
        label: `[주식 ${o.side === 'BUY' ? '매수' : '매도'}] ${o.stockName} ${o.quantity}주 (@${formatWon(o.price)})`,
        amountText: `${o.side === 'BUY' ? '−' : '+'}${formatWon(o.amount)}`
      })),
      ...(me.articlePayments || []).map((ap) => ({
        timestamp: ap.timestamp,
        year: ap.year,
        label: `[유료 단서 구매] ${ap.preTitle}`,
        amountText: `−${formatWon(ap.price)}`
      }))
    ].sort((a, b) => b.timestamp - a.timestamp);

    if (combinedLogs.length === 0) {
      historyEl.innerHTML = `<div class="pf-history-item" style="color:#657f8f;">아직 주문이나 유료 단서 결제 내역이 없습니다.</div>`;
    } else {
      for (const item of combinedLogs) {
        const row = document.createElement('div');
        row.className = 'pf-history-item';
        row.innerHTML = `
          <span><strong>${item.year}년</strong> · ${escapeHtml(item.label)}</span>
          <strong>${item.amountText}</strong>
        `;
        historyEl.appendChild(row);
      }
    }
  }

  /**
   * 관련 종목 보기 이동 헬퍼 (같은 연도 내 읽던 기사 및 목록 위치 보존)
   */
  function navigateToRelatedStock(stockId) {
    if (!stockId) return;
    saveCurrentArticleScrollState(uiState.articleNav);
    if (uiState.selectedStockId !== stockId) {
      resetOrderQuantityToOne();
    }
    uiState.selectedStockId = stockId;
    uiState.showMyInvestment = false;
    uiState.mobileShowDetail = true;
    uiState.cameFromArticles = true;
    switchTab('market');
  }

  /**
   * 05 & 06. 기사 탭 렌더링
   * - 내부 탐색 3가지: 올해 기사(current_free) / 유료 단서(paid_clues) / 보관함(archive)
   * - 기본 화면은 '올해 기사'이며, 새 연도 거래가 시작되면 '올해 기사'로 열립니다.
   * - 연도 선택과 업종·장기 사건·구매 내역 필터는 '보관함'으로 이동했습니다.
   * - '유료 단서' 목록은 기사별이 아닌 종목별 한 줄로 표시하고, 종목을 열면 단일 기사 또는 일정·사업 리스크 비교가 나타납니다.
   */
  function renderArticlesTab() {
    if (!appState) return;
    const { room, me, stocks, articlesByYear } = appState;
    const nav = uiState.articleNav || 'current_free';
    if (!uiState.pendingArticleScrollRestore) {
      saveCurrentArticleScrollState(nav);
    }
    isRenderingArticles = true;

    try {
      const articlesGrid = document.querySelector('.articles-grid');
      if (articlesGrid) {
        articlesGrid.classList.toggle('mobile-show-reader', uiState.mobileShowReader);
      }

      // 내부 탐색 탭 활성화 상태 동기화
      $('btn-art-nav-current').classList.toggle('active', nav === 'current_free');
      $('btn-art-nav-paid').classList.toggle('active', nav === 'paid_clues');
      $('btn-art-nav-archive').classList.toggle('active', nav === 'archive');

    // 보관함 전용 컨트롤은 보관함 탭에서만 표시
    $('articles-archive-controls').classList.toggle('hidden', nav !== 'archive');

    const listUl = $('article-list-ul');
    const availableYears = Object.keys(articlesByYear)
      .map(Number)
      .filter((y) => y >= 2011 && y <= room.currentYear)
      .sort((a, b) => b - a);

    const isOpeningStage = room.currentYear >= 2011 && room.status === 'OPENING';
    const is2010Stage = room.currentYear === 2010;

    // -------------------------------------------------------------------------
    // 1. [올해 기사] 탭 (기본 화면: 거래 시작 후 올해 무료 기사 5개의 제목을 바로 표시)
    // -------------------------------------------------------------------------
    if (nav === 'current_free') {
      $('paid-price-banner').classList.add('hidden');
      $('articles-year-heading').textContent = `${room.currentYear}년 올해 기사`;
      $('articles-section-sublabel').textContent = is2010Stage
        ? '첫 거래'
        : (isOpeningStage ? '거래 시작 전' : '무료 기사 5건');

      if (is2010Stage || isOpeningStage) {
        listUl.innerHTML = `
          <li class="article-card-item" style="cursor:default;">
            <div class="art-item-title">${
              isOpeningStage
                ? `${room.currentYear}년 신규 기사는 아직 열리지 않았습니다`
                : '2010년은 기사 없이 첫 거래를 진행합니다'
            }</div>
            <div class="art-item-desc">${
              isOpeningStage
                ? `개장 결과 단계에서는 그해 개장가와 등락률을 먼저 확인합니다. [${room.currentYear}년 거래]가 시작되면 무료 기사 5개와 유료 단서가 동시에 공개됩니다.`
                : '무료 기사 5개와 유료 단서는 2011년 거래가 시작될 때 동시에 공개됩니다.'
            }</div>
          </li>
        `;
        $('article-reader-content').innerHTML = `
          <div>
            <div class="reader-top-badges">
              <span class="reader-badge">${isOpeningStage ? `${room.currentYear}년 개장 단계` : '2010년 첫 거래'}</span>
            </div>
            <h3 class="reader-headline">${
              isOpeningStage ? `${room.currentYear}년 신규 기사는 거래 시작 시 공개됩니다` : '2010년 첫 거래 구간입니다'
            }</h3>
            <p class="reader-body-p">${
              isOpeningStage
                ? `기존 공개 규칙에 따라 개장 결과 단계에서는 ${room.currentYear}년 신규 기사가 아직 열리지 않습니다. 지난 연도의 무료 기사와 구매한 유료 단서는 [보관함]에서 바로 다시 볼 수 있습니다.`
                : '2010년에는 기사 없이 10개 종목의 기준가를 확인하고 첫 매수 여부를 결정합니다. 2011년 거래 시작부터 해마다 무료 기사 5개와 유료 단서가 공개됩니다.'
            }</p>
          </div>
          <div class="reader-footer-bar">
            <span class="reader-meta-text">${isOpeningStage ? '지난 연도 단서는 보관함에서 열람 가능' : '2010년 기준가 거래'}</span>
            <div class="reader-footer-actions">
              ${isOpeningStage && availableYears.length > 0 ? '<button type="button" class="btn-secondary" id="btn-opening-to-archive">보관함 보기</button>' : ''}
              <button type="button" class="btn-primary" id="btn-wait-to-market">시장으로 이동</button>
            </div>
          </div>
        `;
        const archBtn = $('btn-opening-to-archive');
        if (archBtn) {
          archBtn.addEventListener('click', () => {
            uiState.articleNav = 'archive';
            renderArticlesTab();
          });
        }
        const mktBtn = $('btn-wait-to-market');
        if (mktBtn) {
          mktBtn.addEventListener('click', () => switchTab('market'));
        }
        return;
      }

      const currentFreeList = (articlesByYear[room.currentYear] && articlesByYear[room.currentYear].free) || [];
      if (!uiState.selectedFreeArticleId || !currentFreeList.some((a) => a.id === uiState.selectedFreeArticleId)) {
        uiState.selectedFreeArticleId = currentFreeList[0] ? currentFreeList[0].id : null;
      }

      listUl.innerHTML = '';
      currentFreeList.forEach((art, idx) => {
        const li = document.createElement('li');
        const isSelected = art.id === uiState.selectedFreeArticleId;
        li.className = `article-card-item free-headline-card${isSelected ? ' selected' : ''}`;

        // 숨겨진 회사 기사는 업종만 표시하고 특정 종목을 노출하지 않음
        const disclosedNames = !art.hideCompanyName && Array.isArray(art.relatedStockIds) && art.relatedStockIds.length > 0
          ? art.relatedStockIds
              .map((sid) => (stocks.find((s) => s.id === sid) || {}).name)
              .filter(Boolean)
              .join('·')
          : null;
        const badgeText = art.hideCompanyName
          ? `${art.industry} 업종`
          : (disclosedNames ? `${art.industry} · ${disclosedNames}` : art.industry);

        li.innerHTML = `
          <div class="art-item-top">
            <span class="art-item-tag">${escapeHtml(badgeText)}</span>
            <span class="art-item-num">기사 ${idx + 1}</span>
          </div>
          <div class="art-item-title">${escapeHtml(art.title)}</div>
        `;

        li.addEventListener('click', () => {
          saveCurrentArticleScrollState('current_free');
          uiState.selectedFreeArticleId = art.id;
          uiState.mobileShowReader = true;
          uiState.articleReaderPageScrollYByNav.current_free = 0;
          uiState.pendingArticleScrollRestore = true;
          renderArticlesTab();
        });
        listUl.appendChild(li);
      });

      const selectedFree = currentFreeList.find((a) => a.id === uiState.selectedFreeArticleId) || currentFreeList[0] || null;
      renderFreeArticleReader(selectedFree);
      return;
    }

    // -------------------------------------------------------------------------
    // 2. [유료 단서] 탭 (종목별 한 줄 목록 -> 선택 시 단일 기사 또는 일정·사업 리스크 비교)
    // -------------------------------------------------------------------------
    if (nav === 'paid_clues') {
      $('articles-year-heading').textContent = `${room.currentYear}년 유료 단서`;
      $('articles-section-sublabel').textContent = is2010Stage || isOpeningStage ? '거래 시작 전' : '10종목 · 종목별 선택';

      if (is2010Stage || isOpeningStage) {
        $('paid-price-banner').classList.add('hidden');
        listUl.innerHTML = `
          <li class="article-card-item" style="cursor:default;">
            <div class="art-item-title">${
              isOpeningStage
                ? `${room.currentYear}년 유료 단서는 거래 시작 시 공개됩니다`
                : '2010년에는 유료 단서를 판매하지 않습니다'
            }</div>
            <div class="art-item-desc">${
              isOpeningStage
                ? `개장 결과 단계에서는 그해 신규 단서가 열리지 않습니다. 지난 연도에 구매한 단서는 [보관함]에서 다시 열람할 수 있습니다.`
                : '2011년 거래가 시작되면 10개 종목의 유료 단서가 공개됩니다.'
            }</div>
          </li>
        `;
        $('article-reader-content').innerHTML = `
          <div>
            <div class="reader-top-badges">
              <span class="reader-badge">${isOpeningStage ? `${room.currentYear}년 개장 단계` : '2010년 첫 거래'}</span>
            </div>
            <h3 class="reader-headline">${
              isOpeningStage ? `${room.currentYear}년 신규 유료 단서는 아직 열리지 않았습니다` : '2011년 거래부터 유료 단서가 제공됩니다'
            }</h3>
            <p class="reader-body-p">${
              isOpeningStage
                ? `[${room.currentYear}년 거래]가 시작되면 종목별 유료 단서와 공통 가격이 공개됩니다. 이미 구매한 지난 연도 단서는 [보관함]에서 확인하세요.`
                : '2010년 첫 거래 이후 2011년부터 매년 종목별 유료 단서를 조사할 수 있습니다.'
            }</p>
          </div>
          <div class="reader-footer-bar">
            <span class="reader-meta-text">거래 시작 시 동시 공개</span>
            <div class="reader-footer-actions">
              ${isOpeningStage && availableYears.length > 0 ? '<button type="button" class="btn-secondary" id="btn-paid-wait-archive">보관함 보기</button>' : ''}
              <button type="button" class="btn-primary" id="btn-paid-wait-market">시장으로 이동</button>
            </div>
          </div>
        `;
        const archBtn = $('btn-paid-wait-archive');
        if (archBtn) {
          archBtn.addEventListener('click', () => {
            uiState.articleNav = 'archive';
            renderArticlesTab();
          });
        }
        const mktBtn = $('btn-paid-wait-market');
        if (mktBtn) {
          mktBtn.addEventListener('click', () => switchTab('market'));
        }
        return;
      }

      const currentPaidList = (articlesByYear[room.currentYear] && articlesByYear[room.currentYear].paid) || [];
      const commonPrice = room.currentArticlePrice;
      $('paid-price-banner').classList.remove('hidden');
      $('paid-common-price-label').textContent = formatWon(commonPrice);

      if (!uiState.selectedPaidStockId || !stocks.some((s) => s.id === uiState.selectedPaidStockId)) {
        uiState.selectedPaidStockId = stocks[0] ? stocks[0].id : null;
      }

      listUl.innerHTML = '';
      for (const stock of stocks) {
        const stockClues = currentPaidList.filter((p) => p.stockId === stock.id);
        const hasChoice = stockClues.length > 1 || (stockClues[0] && stockClues[0].hasChoicePair);
        const purchasedClue = stockClues.find((p) => p.purchased) || null;
        const priceVal = stockClues[0] ? stockClues[0].price : commonPrice;
        const isSelected = stock.id === uiState.selectedPaidStockId;

        const li = document.createElement('li');
        li.className = `paid-stock-row${isSelected ? ' selected' : ''}${purchasedClue ? ' is-owned' : ''}`;

        let statusText = hasChoice ? `일정·리스크 2종 · ${formatWon(priceVal)}` : `단일 단서 · ${formatWon(priceVal)}`;
        let statusClass = hasChoice ? 'psr-status choice' : 'psr-status single';
        if (purchasedClue) {
          statusText = hasChoice
            ? `선택 완료 · ${purchasedClue.clueTypeLabel || '구매함'}`
            : '구매 완료';
          statusClass = 'psr-status owned';
        } else if (room.status !== 'TRADING') {
          statusText = '거래 마감';
          statusClass = 'psr-status closed';
        } else if (me.cash < priceVal) {
          statusText = `잔고 부족 · ${formatWon(priceVal)}`;
          statusClass = 'psr-status insufficient';
        }

        li.innerHTML = `
          <div class="psr-left">
            <strong class="psr-stock-name">${escapeHtml(stock.name)}</strong>
            <span class="psr-industry">${escapeHtml(stock.industry)}</span>
          </div>
          <span class="${statusClass}">${escapeHtml(statusText)}</span>
        `;

        li.addEventListener('click', () => {
          saveCurrentArticleScrollState('paid_clues');
          uiState.selectedPaidStockId = stock.id;
          if (purchasedClue) {
            uiState.selectedPaidArticleId = purchasedClue.id;
          } else if (stockClues[0]) {
            uiState.selectedPaidArticleId = stockClues[0].id;
          }
          uiState.mobileShowReader = true;
          uiState.articleReaderPageScrollYByNav.paid_clues = 0;
          uiState.pendingArticleScrollRestore = true;
          renderArticlesTab();
        });

        listUl.appendChild(li);
      }

      const activeStock = stocks.find((s) => s.id === uiState.selectedPaidStockId) || stocks[0];
      const activeStockClues = currentPaidList.filter((p) => p.stockId === (activeStock && activeStock.id));
      renderPaidStockClueReader(activeStock, activeStockClues);
      return;
    }

    // -------------------------------------------------------------------------
    // 3. [보관함] 탭 (연도 선택 + 업종·장기 사건·구매 내역 필터 + 지난 무료 기사 및 구매 단서 열람)
    // -------------------------------------------------------------------------
    $('paid-price-banner').classList.add('hidden');
    $('articles-year-heading').textContent = '기사 · 단서 보관함';

    if (availableYears.length === 0) {
      $('articles-section-sublabel').textContent = '0건';
      $('articles-year-tabs').innerHTML = '';
      listUl.innerHTML = `
        <li class="article-card-item" style="color:#657f8f;cursor:default;">
          아직 보관함에 공개된 기사가 없습니다. 2011년 거래가 시작되면 무료 기사와 구매한 유료 단서가 보관함에 기록됩니다.
        </li>
      `;
      $('article-reader-content').innerHTML = `
        <div style="color:#9bb2c0;padding:16px 4px;">
          2011년 거래 시작 이후 공개된 무료 기사와 내가 구매한 유료 단서를 이곳 보관함에서 연도별·업종별로 다시 찾아볼 수 있습니다.
        </div>
      `;
      return;
    }

    if (!availableYears.includes(uiState.selectedArticleYear)) {
      uiState.selectedArticleYear = availableYears[0];
    }

    const yearTabsEl = $('articles-year-tabs');
    yearTabsEl.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `year-pill-btn${uiState.showAllYearsInArticles ? ' active' : ''}`;
    allBtn.textContent = '전 연도';
    allBtn.addEventListener('click', () => {
      uiState.showAllYearsInArticles = true;
      uiState.selectedArchiveArticleId = null;
      uiState.articleScrollTopByNav.archive = 0;
      uiState.articlePageScrollYByNav.archive = 0;
      uiState.pendingArticleScrollRestore = true;
      renderArticlesTab();
    });
    yearTabsEl.appendChild(allBtn);

    for (const y of availableYears) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `year-pill-btn${!uiState.showAllYearsInArticles && y === uiState.selectedArticleYear ? ' active' : ''}`;
      btn.textContent = `${y}년`;
      btn.addEventListener('click', () => {
        uiState.showAllYearsInArticles = false;
        uiState.selectedArticleYear = y;
        uiState.selectedArchiveArticleId = null;
        uiState.articleScrollTopByNav.archive = 0;
        uiState.articlePageScrollYByNav.archive = 0;
        uiState.pendingArticleScrollRestore = true;
        renderArticlesTab();
      });
      yearTabsEl.appendChild(btn);
    }

    document.querySelectorAll('#articles-filter-bar .art-filter-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.filter === uiState.articleFilter);
    });

    const targetYears = uiState.showAllYearsInArticles ? availableYears : [uiState.selectedArticleYear];
    let archiveItems = [];
    for (const y of targetYears) {
      const yd = articlesByYear[y] || { free: [], paid: [] };
      const ownedPaidForY = (yd.paid || []).filter((p) => p.purchased);
      const freeForY = yd.free || [];
      archiveItems = archiveItems.concat(ownedPaidForY, freeForY);
    }

    const filteredArchive = archiveItems.filter((art) => {
      const f = uiState.articleFilter;
      if (f === 'ALL') return true;
      if (f === 'OWNED') return art.type === 'paid' && Boolean(art.purchased);
      if (f === 'ARC') return Boolean(art.arcStageLabel);
      if (f === 'OTHER') return ['식품', '게임', '항공'].includes(art.industry);
      return art.industry === f;
    });

    $('articles-section-sublabel').textContent = `${filteredArchive.length}건`;

    if (!uiState.selectedArchiveArticleId || !filteredArchive.some((a) => a.id === uiState.selectedArchiveArticleId)) {
      uiState.selectedArchiveArticleId = filteredArchive[0] ? filteredArchive[0].id : null;
    }

    listUl.innerHTML = '';
    if (filteredArchive.length === 0) {
      listUl.innerHTML = `
        <li class="article-card-item" style="color:#657f8f;cursor:default;">
          선택한 연도·필터 조건에 해당하는 보관 기사가 없습니다.
        </li>
      `;
      $('article-reader-content').innerHTML = `<div style="color:#657f8f;padding:16px 4px;">왼쪽 보관함에서 기사를 선택하세요.</div>`;
      return;
    }

    for (const art of filteredArchive) {
      const li = document.createElement('li');
      const isSelected = art.id === uiState.selectedArchiveArticleId;
      li.className = `article-card-item${isSelected ? ' selected' : ''}`;

      if (art.type === 'free') {
        const tagLabel = art.hideCompanyName ? `${art.industry} 업종` : art.industry;
        li.innerHTML = `
          <div class="art-item-top">
            <span class="art-item-tag">${art.year}년 · ${escapeHtml(tagLabel)}</span>
            <span class="art-item-status">무료 기사</span>
          </div>
          <div class="art-item-title">${escapeHtml(art.title)}</div>
        `;
      } else {
        const clueTypeLabel = art.clueTypeLabel || '유료 단서';
        li.innerHTML = `
          <div class="art-item-top">
            <span class="art-item-tag">${art.year}년 · ${escapeHtml(art.stockName)}</span>
            <span class="art-item-status owned">내 구매 단서 · ${escapeHtml(clueTypeLabel)}</span>
          </div>
          <div class="art-item-title">${escapeHtml(art.postTitle || art.preTitle)}</div>
        `;
      }

      li.addEventListener('click', () => {
        saveCurrentArticleScrollState('archive');
        uiState.selectedArchiveArticleId = art.id;
        uiState.mobileShowReader = true;
        uiState.articleReaderPageScrollYByNav.archive = 0;
        uiState.pendingArticleScrollRestore = true;
        renderArticlesTab();
      });

      listUl.appendChild(li);
    }

    const selectedArch = filteredArchive.find((a) => a.id === uiState.selectedArchiveArticleId) || filteredArchive[0];
    if (selectedArch.type === 'free') {
      renderFreeArticleReader(selectedArch);
    } else {
      const stockObj = stocks.find((s) => s.id === selectedArch.stockId) || { id: selectedArch.stockId, name: selectedArch.stockName, industry: selectedArch.industry };
      renderPaidStockClueReader(stockObj, [selectedArch], true);
    }
    } finally {
      restoreArticleScrollState(nav);
      isRenderingArticles = false;
    }
  }

  function renderArticleBodyParagraphsHtml(bodyText) {
    const paragraphs = String(bodyText || '')
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) return '';
    return paragraphs
      .map((p) => `<p class="reader-body-p">${escapeHtml(p)}</p>`)
      .join('');
  }

  /**
   * 무료 기사 본문 리더 렌더링
   * - 공개된 종목이 있는 기사에는 '관련 종목 보기' 버튼 제공
   * - 회사가 숨겨진 기사(hideCompanyName: true)에는 업종만 표시하고 특정 종목과 절대 연결하지 않음
   */
  function renderFreeArticleReader(article) {
    const container = $('article-reader-content');
    if (!article || !appState) {
      container.innerHTML = `<div style="color:#657f8f;padding:20px;">왼쪽 목록에서 읽을 기사를 선택하세요.</div>`;
      return;
    }

    const { stocks } = appState;
    const isHiddenCompany = Boolean(article.hideCompanyName);
    const disclosedStocks = !isHiddenCompany && Array.isArray(article.relatedStockIds)
      ? article.relatedStockIds
          .map((sid) => stocks.find((s) => s.id === sid))
          .filter(Boolean)
      : [];

    const badgeText = isHiddenCompany
      ? `${article.industry} 업종`
      : (disclosedStocks.length > 0
          ? `${article.industry} · ${disclosedStocks.map((s) => s.name).join(' · ')}`
          : article.industry);

    const relatedButtonsHtml = disclosedStocks.length > 0
      ? disclosedStocks
          .map(
            (st, idx) => `
              <button
                type="button"
                class="${idx === 0 ? 'btn-primary' : 'btn-secondary'}"
                data-goto-related-stock="${escapeHtml(st.id)}"
              >
                관련 종목 보기 (${escapeHtml(st.name)})
              </button>
            `
          )
          .join('')
      : '';

    container.innerHTML = `
      <div>
        <div class="reader-top-badges">
          <span class="reader-badge">${escapeHtml(badgeText)}</span>
          <span class="reader-meta-text">${article.year}년 무료 기사${article.arcStageLabel ? ` · ${escapeHtml(article.arcStageLabel)}` : ''}</span>
        </div>
        <h3 class="reader-headline">${escapeHtml(article.title)}</h3>
        <div class="reader-body-paragraphs">${renderArticleBodyParagraphsHtml(article.body)}</div>
        ${
          isHiddenCompany
            ? `<div class="reader-highlight-box">대상 회사명이 비공개인 ${escapeHtml(article.industry)} 업종 기사입니다. 특정 종목과 바로 연결되지 않으며, [유료 단서] 탭에서 종목별 단서를 조사해 실제 당사자를 추리할 수 있습니다.</div>`
            : ''
        }
        ${!isHiddenCompany ? '<div id="reader-quick-deduction-slot"></div>' : ''}
      </div>
      <div class="reader-footer-bar">
        <span class="reader-meta-text">${
          isHiddenCompany
            ? `${escapeHtml(article.industry)} 업종 공통 단서 (대상 회사 비공개)`
            : `${article.year}년 공개 기사`
        }</span>
        <div class="reader-footer-actions">
          ${relatedButtonsHtml}
        </div>
      </div>
    `;

    if (!isHiddenCompany) {
      mountReaderQuickDeduction(article);
    }

    container.querySelectorAll('[data-goto-related-stock]').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigateToRelatedStock(btn.dataset.gotoRelatedStock);
      });
    });
  }

  /**
   * 종목별 유료 단서 리더 렌더링 (단일 기사 또는 일정·사업 리스크 2종 비교 + 결제/열람)
   */
  function renderPaidStockClueReader(stock, stockClues, isFromArchive = false) {
    const container = $('article-reader-content');
    if (!stock || !Array.isArray(stockClues) || stockClues.length === 0 || !appState) {
      container.innerHTML = `<div style="color:#657f8f;padding:20px;">왼쪽 목록에서 조사할 종목을 선택하세요.</div>`;
      return;
    }

    const { room, me } = appState;
    const hasChoice = !isFromArchive && (stockClues.length > 1 || Boolean(stockClues[0].hasChoicePair));
    const purchasedClue = stockClues.find((c) => c.purchased) || null;

    let activeClue = stockClues.find((c) => c.id === uiState.selectedPaidArticleId) || purchasedClue || stockClues[0];
    uiState.selectedPaidArticleId = activeClue.id;

    // 2종 선택형 단서(일정 단서 vs 사업 리스크 단서) 비교 카드 생성
    let compareBoxHtml = '';
    if (hasChoice && stockClues.length >= 2) {
      const cardsHtml = stockClues
        .map((item) => {
          const isCurrent = item.id === activeClue.id;
          const typeClass = item.clueType === 'schedule' ? 'schedule' : 'risk';
          let stateBadgeHtml = `<span class="choice-card-status available">선택 가능 · ${formatWon(item.price)}</span>`;
          if (item.purchased) {
            stateBadgeHtml = `<span class="choice-card-status owned">구매 완료 (본문 열림)</span>`;
          } else if (item.lockedBySibling) {
            stateBadgeHtml = `<span class="choice-card-status locked">올해 단서 선택 완료</span>`;
          }

          return `
            <div
              class="reader-choice-card${isCurrent ? ' active' : ''}${item.purchased ? ' is-owned' : ''}${item.lockedBySibling ? ' is-locked' : ''}"
              data-select-choice-id="${escapeHtml(item.id)}"
            >
              <div class="choice-card-header">
                <span class="clue-type-pill ${typeClass}">${escapeHtml(item.clueTypeLabel || '선택 단서')}</span>
                ${stateBadgeHtml}
              </div>
              <div class="choice-card-what">
                ${escapeHtml(item.whatItTells || item.subtitle)}
              </div>
              <div class="choice-card-foot">
                <span>공통 가격 ${formatWon(item.price)}</span>
                <span class="choice-card-select-hint">${
                  item.purchased
                    ? '구매한 본문 열람 중'
                    : (item.lockedBySibling
                      ? '올해 단서 선택 완료'
                      : (isCurrent ? '현재 선택됨' : '이 유형 선택 →'))
                }</span>
              </div>
            </div>
          `;
        })
        .join('');

      compareBoxHtml = `
        <div class="reader-choice-compare-box">
          <div class="rcc-top">
            <div>
              <span class="rcc-title">${escapeHtml(stock.name)} (${escapeHtml(stock.industry)}) · ${activeClue.year}년 유료 단서 비교</span>
              <p class="rcc-sub">일정 단서와 사업 리스크 단서가 알려주는 정보를 비교하고 하나를 선택하세요.</p>
            </div>
            <span class="status-pill">공통 가격 ${formatWon(activeClue.price)}</span>
          </div>
          <div class="reader-choice-grid">
            ${cardsHtml}
          </div>
        </div>
      `;
    }

    const clueTypeClass = activeClue.clueType === 'schedule'
      ? 'schedule'
      : (activeClue.clueType === 'risk' ? 'risk' : 'single');
    const clueTypeLabel = activeClue.clueTypeLabel || (hasChoice ? '선택 단서' : '단일 단서');

    let detailBodyHtml = '';

    // Case 1: 이미 구매한 단서 -> 본문 즉시 표시
    if (activeClue.purchased) {
      detailBodyHtml = `
        <div class="reader-top-badges">
          <span class="reader-badge">${escapeHtml(stock.name)} · ${escapeHtml(clueTypeLabel)}</span>
          <span class="reader-owned-pill">구매 완료 · ${formatWon(activeClue.price)}</span>
        </div>
        <h3 class="reader-headline">${escapeHtml(activeClue.postTitle)}</h3>
        <div class="reader-body-paragraphs">${renderArticleBodyParagraphsHtml(activeClue.body)}</div>
        <div id="reader-quick-deduction-slot"></div>
      `;
    } else if (activeClue.lockedBySibling) {
      // Case 2: 같은 해 같은 종목에서 다른 유형을 이미 선택해 잠긴 단서 ('올해 단서 선택 완료')
      detailBodyHtml = `
        <div class="reader-purchase-box locked-sibling-box">
          <div class="reader-top-badges" style="margin-bottom:8px;">
            <span class="clue-type-pill ${clueTypeClass}">${escapeHtml(clueTypeLabel)}</span>
            <span class="status-pill locked-pill">올해 단서 선택 완료</span>
          </div>
          <div class="reader-one-choice-notice">이 종목의 올해 유료 단서는 하나만 구매할 수 있어요</div>
          <p class="reader-body-p" style="font-size:13.5px;margin:8px 0 14px;">
            올해 <strong>${escapeHtml(stock.name)}</strong> 종목에서는 이미
            <strong>「${escapeHtml(activeClue.siblingPurchasedTitle || '다른 유형 단서')}」</strong>를 선택해 구매했습니다.
          </p>
          ${
            activeClue.siblingPurchasedArticleId
              ? `<button type="button" id="btn-open-purchased-sibling" class="btn-primary btn-full">내가 구매한 「${escapeHtml(activeClue.siblingPurchasedTitle || '단서')}」 본문 보기</button>`
              : ''
          }
        </div>
      `;
    } else {
      // Case 3: 미구매 상태 -> 알려주는 정보 + 구매 확인 및 결제 버튼
      const isPastYear = activeClue.year !== room.currentYear;
      const isClosed = room.status !== 'TRADING';
      const isInsufficient = me.cash < activeClue.price;
      const cashAfterPurchase = me.cash - activeClue.price;

      let unavailableReason = null;
      if (!isConnected) {
        unavailableReason = '연결 복구 중에는 유료 단서를 구매할 수 없습니다.';
      } else if (isPastYear) {
        unavailableReason = '해당 연도에 구매하지 않은 지난 유료 단서는 구매가 종료되었습니다.';
      } else if (isClosed) {
        unavailableReason = '거래 시간이 마감되어 유료 단서를 구매할 수 없습니다.';
      } else if (isInsufficient) {
        unavailableReason = `잔고 부족: 보유 현금(${formatWon(me.cash)})이 단서 가격(${formatWon(activeClue.price)})보다 부족합니다.`;
      }

      detailBodyHtml = `
        ${
          !hasChoice
            ? `
              <div class="reader-top-badges">
                <span class="reader-badge">${escapeHtml(stock.name)} (${escapeHtml(stock.industry)})</span>
                <span class="clue-type-pill single">단일 단서 · ${formatWon(activeClue.price)}</span>
              </div>
              <h3 class="reader-headline">${escapeHtml(activeClue.preTitle)}</h3>
              <p class="reader-body-p">
                <strong>알려주는 정보:</strong> ${escapeHtml(activeClue.whatItTells || activeClue.subtitle)}
              </p>
            `
            : ''
        }
        <div class="reader-purchase-box">
          <div class="reader-purchase-title">${escapeHtml(stock.name)} · ${escapeHtml(clueTypeLabel)} 구매 확인</div>
          ${hasChoice ? '<div class="reader-one-choice-notice">이 종목의 올해 유료 단서는 하나만 구매할 수 있어요</div>' : ''}
          <div class="order-calc-box" style="margin-bottom:14px;">
            <div class="calc-row">
              <span>선택한 단서</span>
              <strong>${escapeHtml(activeClue.preTitle)}</strong>
            </div>
            <div class="calc-row">
              <span>공통 가격 (${activeClue.year}년)</span>
              <strong>${formatWon(activeClue.price)}</strong>
            </div>
            <div class="calc-row">
              <span>거래 가능 현금</span>
              <strong>${formatWon(me.cash)}</strong>
            </div>
            <div class="calc-row">
              <span>구매 후 남는 현금</span>
              <strong class="${isInsufficient ? 'text-up' : 'highlight-mint'}">
                ${isInsufficient ? '잔고 부족' : formatWon(cashAfterPurchase)}
              </strong>
            </div>
          </div>

          ${unavailableReason ? `<p class="order-status-text error">${escapeHtml(unavailableReason)}</p>` : ''}

          <button
            type="button"
            id="btn-confirm-buy-article"
            class="btn-primary btn-full"
            ${unavailableReason || uiState.isBuyingArticle ? 'disabled' : ''}
          >
            ${uiState.isBuyingArticle ? '결제 중...' : `${formatWon(activeClue.price)}에 [${escapeHtml(clueTypeLabel)}] 구매하고 본문 열기`}
          </button>
        </div>
      `;
    }

    container.innerHTML = `
      <div>
        ${compareBoxHtml}
        ${detailBodyHtml}
      </div>
      <div class="reader-footer-bar">
        <span class="reader-meta-text">${
          activeClue.purchased
            ? '구매한 단서는 보관함과 종목 타임라인에서 언제든 다시 볼 수 있습니다.'
            : '구매 전에는 실제 단서 본문이 숨겨지며 결제 즉시 열립니다.'
        }</span>
        <div class="reader-footer-actions">
          <button type="button" id="btn-paid-related-stock" class="btn-secondary">
            관련 종목 보기 (${escapeHtml(stock.name)})
          </button>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-select-choice-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const targetId = card.dataset.selectChoiceId;
        if (targetId && targetId !== uiState.selectedPaidArticleId) {
          uiState.selectedPaidArticleId = targetId;
          renderArticlesTab();
        }
      });
    });

    if (activeClue.purchased) {
      mountReaderQuickDeduction(activeClue);
    }

    const openSiblingBtn = $('btn-open-purchased-sibling');
    if (openSiblingBtn && activeClue.siblingPurchasedArticleId) {
      openSiblingBtn.addEventListener('click', () => {
        uiState.selectedPaidArticleId = activeClue.siblingPurchasedArticleId;
        renderArticlesTab();
      });
    }

    const buyBtn = $('btn-confirm-buy-article');
    if (buyBtn && !activeClue.purchased && !activeClue.lockedBySibling) {
      buyBtn.addEventListener('click', () => handleBuyArticle(activeClue));
    }

    const relatedBtn = $('btn-paid-related-stock');
    if (relatedBtn) {
      relatedBtn.addEventListener('click', () => {
        navigateToRelatedStock(stock.id);
      });
    }
  }

  /**
   * 기사 읽기 화면 하단에 공개된 관련 종목의 추리 태그를 즉시 토글할 수 있는 위젯을 마운트합니다.
   * 주의: 회사가 숨겨진 기사(hideCompanyName: true)에서는 특정 종목과 절대 연결하지 않습니다.
   */
  function mountReaderQuickDeduction(article) {
    const slot = $('reader-quick-deduction-slot');
    if (!slot || !appState || !article || article.hideCompanyName) return;

    const candidateStocks = article.type === 'paid'
      ? appState.stocks.filter((s) => s.id === article.stockId)
      : appState.stocks.filter((s) => (article.relatedStockIds || []).includes(s.id));

    if (candidateStocks.length === 0) return;

    const box = document.createElement('div');
    box.className = 'reader-quick-deduction-box';
    box.innerHTML = `<div class="rqd-header">내 추리 태그 메모 (시장 목록에도 함께 표시됩니다)</div>`;

    for (const st of candidateStocks) {
      const row = document.createElement('div');
      row.className = 'rqd-stock-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'rqd-stock-name';
      nameSpan.textContent = `${st.name} (${formatWon(st.currentPrice)})`;

      const tagsWrap = document.createElement('div');
      tagsWrap.className = 'deduction-tags-row';

      const curDed = getStockDeduction(st.id);
      for (const tag of getAvailableTagsForStock(st)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isActive = curDed.tags.includes(tag.id);
        btn.className = `deduction-tag-btn ${tag.colorClass}${isActive ? ' active' : ''}`;
        btn.textContent = tag.label;
        btn.addEventListener('click', () => {
          toggleStockDeductionTag(st.id, tag.id);
          renderArticlesTab();
        });
        tagsWrap.appendChild(btn);
      }

      row.appendChild(nameSpan);
      row.appendChild(tagsWrap);
      box.appendChild(row);
    }

    slot.appendChild(box);
  }

  function isChatPanelVisible() {
    const tradingScreen = $('screen-trading');
    const chatPanel = $('tab-panel-chat');
    return Boolean(
      uiState.activeTab === 'chat' &&
      tradingScreen &&
      !tradingScreen.classList.contains('hidden') &&
      chatPanel &&
      !chatPanel.classList.contains('hidden')
    );
  }

  /**
   * 현재 열려 있는 채팅 채널(전체 방 또는 특정 1:1 대화)의 현재 판 메시지만 읽음 처리
   */
  function markActiveChatChannelAsRead() {
    if (!appState || !isChatPanelVisible()) return;
    const { room, me, chats } = appState;
    const currentGameNumber = (room && room.gameNumber) || 1;
    const isAllChannel = uiState.selectedChatTargetId === null;

    for (const m of chats || []) {
      if ((m.gameNumber || 1) !== currentGameNumber) continue;
      if (isAllChannel) {
        if (m.targetId === null) {
          uiState.readChatIds.add(m.id);
        }
      } else {
        const isTargetPair =
          (m.senderId === me.id && m.targetId === uiState.selectedChatTargetId) ||
          (m.senderId === uiState.selectedChatTargetId && m.targetId === me.id);
        if (isTargetPair) {
          uiState.readChatIds.add(m.id);
        }
      }
    }
  }

  /**
   * 읽지 않은 채팅 메시지 수 계산
   * - 내가 보낸 메시지(m.senderId === me.id)는 포함하지 않음
   * - 이전 판 메시지는 포함하지 않음
   * - 1:1 메시지는 서버에서 당사자에게만 전달되므로 상대방에게만 알림이 집계됨
   */
  function computeUnreadChatCounts() {
    if (!appState) {
      return { totalUnread: 0, allUnread: 0, dmUnreadByPartner: {} };
    }
    const { room, me, chats } = appState;
    const currentGameNumber = (room && room.gameNumber) || 1;
    let allUnread = 0;
    const dmUnreadByPartner = {};

    for (const m of chats || []) {
      if ((m.gameNumber || 1) !== currentGameNumber) continue;
      if (m.senderId === me.id) continue;
      if (uiState.readChatIds.has(m.id)) continue;

      if (m.targetId === null) {
        allUnread++;
      } else if (m.targetId === me.id) {
        dmUnreadByPartner[m.senderId] = (dmUnreadByPartner[m.senderId] || 0) + 1;
      }
    }

    const dmTotal = Object.values(dmUnreadByPartner).reduce((sum, n) => sum + n, 0);
    return {
      totalUnread: allUnread + dmTotal,
      allUnread,
      dmUnreadByPartner
    };
  }

  function updateChatUnreadBadges() {
    markActiveChatChannelAsRead();
    const { totalUnread, allUnread, dmUnreadByPartner } = computeUnreadChatCounts();

    const pcBadge = $('tab-chat-badge');
    if (pcBadge) {
      if (totalUnread > 0) {
        pcBadge.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
        pcBadge.classList.remove('hidden');
      } else {
        pcBadge.classList.add('hidden');
      }
    }

    const mobileBadge = $('mobile-tab-chat-badge');
    if (mobileBadge) {
      if (totalUnread > 0) {
        mobileBadge.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
        mobileBadge.classList.remove('hidden');
      } else {
        mobileBadge.classList.add('hidden');
      }
    }

    const allBadge = $('chat-all-unread-badge');
    if (allBadge) {
      if (allUnread > 0) {
        allBadge.textContent = allUnread > 99 ? '99+' : String(allUnread);
        allBadge.classList.remove('hidden');
      } else {
        allBadge.classList.add('hidden');
      }
    }

    return { totalUnread, allUnread, dmUnreadByPartner };
  }

  /**
   * 08 & 09. 채팅 탭 렌더링 (전체 방 + 1:1 대화, 기획서 17쪽)
   */
  function renderChatTab() {
    if (!appState) return;
    const { me, participants, chats } = appState;
    const { dmUnreadByPartner } = updateChatUnreadBadges();

    const isAllChannel = uiState.selectedChatTargetId === null;
    $('btn-chat-channel-all').classList.toggle('active', isAllChannel);

    const dmUl = $('chat-dm-participants-ul');
    dmUl.innerHTML = '';

    const otherParticipants = participants.filter((p) => p.id !== me.id);
    if (otherParticipants.length === 0) {
      dmUl.innerHTML = `<li style="font-size:12px;color:#657f8f;">다른 참가자가 없습니다.</li>`;
    } else {
      otherParticipants.forEach((p, idx) => {
        const li = document.createElement('li');
        const isActive = uiState.selectedChatTargetId === p.id;
        li.className = `chat-dm-item${isActive ? ' active' : ''}`;
        li.dataset.dmPartnerId = p.id;
        const badgeClass = ` alt-${(idx % 3) + 1}`;
        const unreadCount = dmUnreadByPartner[p.id] || 0;
        const unreadBadgeHtml = unreadCount > 0
          ? `<span class="chat-unread-badge chat-dm-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>`
          : '';
        li.innerHTML = `
          <div class="chat-dm-item-left">
            <span class="avatar-badge${badgeClass}">${escapeHtml(p.nickname.charAt(0))}</span>
            <span style="font-weight:700;font-size:13.5px;">${escapeHtml(p.nickname)}</span>
          </div>
          ${unreadBadgeHtml}
        `;
        li.addEventListener('click', () => {
          uiState.selectedChatTargetId = p.id;
          renderChatTab();
        });
        dmUl.appendChild(li);
      });
    }

    // 대화창 헤더 (기획서 17쪽: 1:1 대화 상단에 상대 닉네임과 "둘만 볼 수 있어요" 표시)
    if (isAllChannel) {
      $('chat-header-title').textContent = '전체 방';
      $('chat-header-sub').textContent = `${participants.length}명 참여`;
    } else {
      const targetP = participants.find((p) => p.id === uiState.selectedChatTargetId);
      const targetName = targetP ? targetP.nickname : '상대방';
      $('chat-header-title').textContent = `${targetName}과 1:1 대화`;
      $('chat-header-sub').textContent = `나와 ${targetName}만 볼 수 있어요 (둘만 볼 수 있어요)`;
    }

    const msgBox = $('chat-messages-box');
    const currentGameNumber = (appState.room && appState.room.gameNumber) || 1;
    const filteredMsgs = (chats || []).filter((m) => {
      if (isAllChannel) return m.targetId === null;
      return (
        (m.senderId === me.id && m.targetId === uiState.selectedChatTargetId) ||
        (m.senderId === uiState.selectedChatTargetId && m.targetId === me.id)
      );
    });

    const previousMsgs = filteredMsgs.filter((m) => (m.gameNumber || 1) < currentGameNumber);
    const currentMsgs = filteredMsgs.filter((m) => (m.gameNumber || 1) === currentGameNumber);

    msgBox.innerHTML = '';

    // 이전 판 대화가 있는 경우 상단에 펼쳐볼 수 있는 '이전 판 대화' 영역 제공
    if (previousMsgs.length > 0) {
      const prevSection = document.createElement('div');
      prevSection.className = 'prev-game-chat-section';
      prevSection.innerHTML = `
        <button
          type="button"
          id="btn-toggle-prev-game-chats"
          class="btn-prev-game-chat-toggle"
          aria-expanded="${uiState.showPreviousGameChats ? 'true' : 'false'}"
        >
          <span>이전 판 대화 (${previousMsgs.length}건)</span>
          <span class="prev-chat-toggle-label">${uiState.showPreviousGameChats ? '접기 ▲' : '펼쳐보기 ▼'}</span>
        </button>
        <div id="prev-game-chat-list" class="prev-game-chat-list${uiState.showPreviousGameChats ? '' : ' hidden'}"></div>
      `;
      msgBox.appendChild(prevSection);

      const toggleBtn = prevSection.querySelector('#btn-toggle-prev-game-chats');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          uiState.showPreviousGameChats = !uiState.showPreviousGameChats;
          renderChatTab();
        });
      }

      const prevListEl = prevSection.querySelector('#prev-game-chat-list');
      if (prevListEl && uiState.showPreviousGameChats) {
        for (const m of previousMsgs) {
          const isMine = m.senderId === me.id;
          const row = document.createElement('div');
          row.className = `chat-msg-row prev-game-msg ${isMine ? 'mine' : 'others'}`;
          const gameNum = m.gameNumber || 1;
          row.innerHTML = `
            <span class="chat-sender-name">${escapeHtml(m.senderNickname)} <span class="chat-game-tag">${gameNum}번째 판 · ${m.year}년</span></span>
            <div class="chat-bubble">${escapeHtml(m.text)}</div>
          `;
          prevListEl.appendChild(row);
        }
      }
    }

    // 현재 판 대화 (새 판에서는 현재 판 대화를 기본으로 표시)
    const currentListWrap = document.createElement('div');
    currentListWrap.id = 'current-game-chat-list';
    currentListWrap.className = 'current-game-chat-list';

    if (currentMsgs.length === 0) {
      currentListWrap.innerHTML = `
        <div class="chat-current-empty" style="color:#657f8f;font-size:13px;margin:auto;text-align:center;padding:24px 12px;">
          ${isAllChannel ? '전체 방 대화를 시작해 보세요.' : '1:1 비밀 대화를 시작해 보세요. 둘만 볼 수 있어요.'}
        </div>
      `;
      msgBox.appendChild(currentListWrap);
    } else {
      for (const m of currentMsgs) {
        const isMine = m.senderId === me.id;
        const row = document.createElement('div');
        row.className = `chat-msg-row current-game-msg ${isMine ? 'mine' : 'others'}`;
        row.innerHTML = `
          <span class="chat-sender-name">${escapeHtml(m.senderNickname)}</span>
          <div class="chat-bubble">${escapeHtml(m.text)}</div>
        `;
        currentListWrap.appendChild(row);
      }
      msgBox.appendChild(currentListWrap);
      msgBox.scrollTop = msgBox.scrollHeight;
    }
  }

  /**
   * 10. 연도별 개장 결과 및 2015년 중간 점검 화면 렌더링 (기획서 10쪽, 11쪽)
   * - 일반 연도: 10종목의 이전·현재 시세, 등락률과 공개 가능한 변동 이유 + 내 평가액 변화, 기사 지출이 반영된 투자 순손익, 내 순위와 순위 변동만 표시
   * - 2015년 중간 점검: 위 정보와 전체 참가자의 닉네임·순위·총자산 순위표를 '연간 자금 지급 전 스냅샷' 표시와 함께 공개
   */
  function renderOpeningScreen() {
    if (!appState) return;
    const { room, me, currentOpeningResult } = appState;
    if (!currentOpeningResult) return;

    const snap = currentOpeningResult;
    const mySnap = snap.myResult || (snap.participantsSnapshot && snap.participantsSnapshot.find((p) => p.participantId === me.id)) || snap.participantsSnapshot[0];
    if (!mySnap) return;

    $('opening-round-eyebrow').textContent = snap.isMidterm
      ? `라운드 ${room.roundIndex} / ${room.totalRounds} · 2015년 중간 점검`
      : `라운드 ${room.roundIndex} / ${room.totalRounds}`;
    $('opening-year-title').textContent = snap.isMidterm
      ? `${snap.year}년 개장 (중간 점검)`
      : `${snap.year}년 개장`;
    $('opening-subtitle').textContent = snap.isMidterm
      ? '2010~2014년 거래 결과 반영 · 연간 자금 지급 전 스냅샷'
      : `${snap.previousYear}년 거래 결과 · 연간 자금 지급 전`;

    $('opening-type-badge').textContent = snap.isMidterm ? '중간 점검 (연간 자금 지급 전 스냅샷)' : '개장 결과';

    // 대표 하이라이트 종목 (내가 보유한 종목 중 가장 평가액이 큰 종목, 없으면 등락폭이 가장 큰 종목)
    let featuredStock = null;
    if (mySnap && mySnap.holdingsDetail && mySnap.holdingsDetail.length > 0) {
      const topHeld = [...mySnap.holdingsDetail].sort((a, b) => b.evaluation - a.evaluation)[0];
      featuredStock = snap.stockChanges.find((sc) => sc.stockId === topHeld.stockId);
    }
    if (!featuredStock) {
      featuredStock = [...snap.stockChanges].sort((a, b) => Math.abs(b.changeRatePercent) - Math.abs(a.changeRatePercent))[0];
    }

    if (featuredStock) {
      const rateClass = featuredStock.changeRatePercent > 0
        ? 'text-up'
        : (featuredStock.changeRatePercent < 0 ? 'text-down' : 'text-neutral');
      $('opening-highlight-card').innerHTML = `
        <div class="oh-left">
          <span class="industry-chip" style="align-self:flex-start;">${escapeHtml(featuredStock.industry)}</span>
          <strong class="oh-stock-name">${escapeHtml(featuredStock.name)}</strong>
          <span class="oh-reason">${escapeHtml(featuredStock.reason)}</span>
        </div>
        <div class="oh-right">
          <div class="oh-rate ${rateClass}">${formatRate(featuredStock.changeRatePercent)}</div>
          <div class="oh-price-range">${formatWon(featuredStock.prevPrice)} → ${formatWon(featuredStock.currentPrice)}</div>
        </div>
      `;
    }

    // 내 핵심 지표 3칸 (지급 전 총자산, 투자 순손익, 내 순위와 순위 변동)
    $('opening-my-pre-assets').textContent = formatWon(mySnap.preGrantTotalAssets);

    const pnlEl = $('opening-my-net-pnl');
    pnlEl.textContent = formatSignedWon(mySnap.netProfitLoss);
    pnlEl.className = `om-value ${mySnap.netProfitLoss > 0 ? 'text-up' : (mySnap.netProfitLoss < 0 ? 'text-down' : '')}`;

    let rankDeltaStr = ' (변동 없음)';
    if (mySnap.rankDelta > 0) rankDeltaStr = ` ↑${mySnap.rankDelta}`;
    else if (mySnap.rankDelta < 0) rankDeltaStr = ` ↓${Math.abs(mySnap.rankDelta)}`;
    $('opening-my-rank').textContent = `${mySnap.rank}위${rankDeltaStr}`;

    // 내 자산 상세 내역
    const breakdownBox = $('opening-my-breakdown');
    let holdingsRowsHtml = '';
    if (mySnap.holdingsDetail && mySnap.holdingsDetail.length > 0) {
      for (const h of mySnap.holdingsDetail) {
        holdingsRowsHtml += `
          <div class="bd-row">
            <span>${escapeHtml(h.name)} ${h.quantity.toLocaleString('ko-KR')}주 평가액 (${formatWon(h.prevPrice)} → ${formatWon(h.currentPrice)}, ${formatRate(h.changeRatePercent)})</span>
            <strong>${formatWon(h.evaluation)}</strong>
          </div>
        `;
      }
    } else {
      holdingsRowsHtml = `
        <div class="bd-row">
          <span>보유 주식 평가액</span>
          <strong>0원</strong>
        </div>
      `;
    }

    const articleSpentRowHtml = mySnap.articleSpentLastYear > 0
      ? `<div class="bd-row"><span>${snap.previousYear}년 유료 기사 구매 지출 (투자 순손익에 반영됨)</span><strong>−${formatWon(mySnap.articleSpentLastYear)}</strong></div>`
      : '';

    breakdownBox.innerHTML = `
      <div class="bd-row">
        <span>보유 현금 (${snap.previousYear}년 마감)</span>
        <strong>${formatWon(mySnap.cashBeforeGrant)}</strong>
      </div>
      ${holdingsRowsHtml}
      ${articleSpentRowHtml}
      <div class="bd-row">
        <span><strong>지급 전 총자산</strong> (${formatWon(mySnap.cashBeforeGrant)} + ${formatWon(mySnap.stockEvaluation)})</span>
        <strong>${formatWon(mySnap.preGrantTotalAssets)}</strong>
      </div>
      <div class="bd-row">
        <span>새해 지원금 (${snap.year}년 개장 지급)</span>
        <strong class="highlight-mint">+${formatWon(mySnap.annualGrant)}</strong>
      </div>
      <div class="bd-row bd-total">
        <span>지급 후 총자산 (다음 거래 시작 총자산)</span>
        <strong>${formatWon(mySnap.postGrantTotalAssets)}</strong>
      </div>
    `;

    // 전체 참가자 총자산 순위표 노출 제어 (기획서 10쪽, 11쪽: 일반 연도에는 내 순위만 표시하고, 전체 총자산 순위표는 2015년 중간 점검과 2020년 종료 화면에만 표시)
    const leaderboardBlock = $('opening-leaderboard-block');
    const pTableWrap = $('opening-participants-table-wrap');
    const leaderNoteEl = $('opening-leader-note');
    const leaderboardTitleEl = $('opening-leaderboard-title');

    if (snap.showFullLeaderboard && Array.isArray(snap.leaderboard) && snap.leaderboard.length > 0) {
      leaderboardBlock.classList.remove('hidden');
      leaderboardTitleEl.textContent = '2015년 중간 점검 전체 참가자 순위표';
      leaderNoteEl.textContent = '2010~2014년 거래 결과 반영 · 연간 자금 지급 전 스냅샷';

      let pRowsHtml = '';
      for (const ps of snap.leaderboard) {
        const isMe = ps.participantId === me.id;
        const pnlClass = ps.netProfitLoss > 0 ? 'text-up' : (ps.netProfitLoss < 0 ? 'text-down' : 'text-neutral');
        let deltaText = '—';
        if (ps.rankDelta > 0) deltaText = `↑${ps.rankDelta}`;
        else if (ps.rankDelta < 0) deltaText = `↓${Math.abs(ps.rankDelta)}`;

        pRowsHtml += `
          <tr class="${isMe ? 'is-me' : ''}">
            <td><strong>${ps.rank}위</strong> <span style="font-size:11.5px;color:#9bb2c0;">(${deltaText})</span></td>
            <td>${escapeHtml(ps.nickname)}${isMe ? '<span class="me-pill">나</span>' : ''}</td>
            <td class="num"><strong>${formatWon(ps.preGrantTotalAssets)}</strong></td>
            <td class="num ${pnlClass}">${formatSignedWon(ps.netProfitLoss)}</td>
            <td class="num highlight-mint"><strong>${formatWon(ps.postGrantTotalAssets)}</strong></td>
          </tr>
        `;
      }

      pTableWrap.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>순위 (변동)</th>
              <th>참가자</th>
              <th class="num">지급 전 총자산 (스냅샷 기준)</th>
              <th class="num">직전 연도 투자 순손익</th>
              <th class="num">지원금 지급 후 총자산</th>
            </tr>
          </thead>
          <tbody>${pRowsHtml}</tbody>
        </table>
      `;
    } else {
      // 일반 연도: 다른 참가자의 총자산 순위표를 숨기고 안내만 표시
      leaderboardBlock.classList.remove('hidden');
      leaderboardTitleEl.textContent = '다른 참가자 순위 안내';
      leaderNoteEl.textContent = `현재 내 순위: ${mySnap.rank}위`;
      pTableWrap.innerHTML = `
        <div style="padding:14px 16px;font-size:13px;color:#9bb2c0;">
          평소 개장 결과에서는 <strong>내 순위(${mySnap.rank}위)</strong>와 내 자산 변동만 공개됩니다.
          전체 참가자의 총자산 순위표는 <strong>2015년 중간 점검</strong>과 <strong>2020년 최종 정산</strong>에서 공개됩니다.
        </div>
      `;
    }

    // 10종목 개장 시세 및 변동 이유 표 (기획서 7쪽 & 10쪽)
    const sTableWrap = $('opening-stocks-table-wrap');
    let sRowsHtml = '';
    for (const sc of snap.stockChanges) {
      const rateClass = sc.changeRatePercent > 0
        ? 'text-up'
        : (sc.changeRatePercent < 0 ? 'text-down' : 'text-neutral');
      sRowsHtml += `
        <tr>
          <td><strong>${escapeHtml(sc.name)}</strong> <span style="font-size:11.5px;color:#657f8f;">(${escapeHtml(sc.industry)})</span></td>
          <td class="num">${formatWon(sc.prevPrice)}</td>
          <td class="num"><strong>${formatWon(sc.currentPrice)}</strong></td>
          <td class="num ${rateClass}"><strong>${formatRate(sc.changeRatePercent)}</strong></td>
          <td>${escapeHtml(sc.reason)}</td>
        </tr>
      `;
    }

    sTableWrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>종목</th>
            <th class="num">${snap.previousYear}년 주당 가격</th>
            <th class="num">${snap.year}년 주당 가격</th>
            <th class="num">개장 등락률</th>
            <th>공개 가능한 변동 이유</th>
          </tr>
        </thead>
        <tbody>${sRowsHtml}</tbody>
      </table>
    `;

    $('opening-next-cash-label').textContent = `다음 거래 현금 ${formatWon(mySnap.nextTradingCash)}`;
    $('opening-post-grant-label').textContent = `지급 후 총자산 ${formatWon(mySnap.postGrantTotalAssets)} · 올해 유료 기사 가격 ${formatWon(snap.articlePriceForYear)}`;

    const nextBtn = $('btn-opening-next-trading');
    if (me.readyForNextPhase) {
      nextBtn.textContent = `${snap.year}년 거래 대기 중 (${room.readyHumanCount}/${room.totalHumanCount})`;
      nextBtn.disabled = true;
    } else {
      nextBtn.textContent = `${snap.year}년 거래 (${room.readyHumanCount}/${room.totalHumanCount})`;
      nextBtn.disabled = false;
    }
  }

  /**
   * 11 & 12. 2020년 최종 정산 화면 렌더링 (기획서 2쪽, 10쪽: 최종 순위, 자산, 보유 종목별 결과, 주요 가격 변동 이유)
   */
  function renderSettlementScreen() {
    if (!appState || !appState.settlementResult) return;
    const { me, settlementResult } = appState;
    const snap = settlementResult;
    const mySnap = snap.myResult || (snap.participantsSnapshot && snap.participantsSnapshot.find((p) => p.participantId === me.id)) || snap.participantsSnapshot[0];
    if (!mySnap) return;

    const isWinner = mySnap.rank === 1;
    const heroBox = $('settlement-hero-box');
    heroBox.className = `settlement-hero-box${isWinner ? '' : ' non-winner'}`;

    if (isWinner) {
      heroBox.innerHTML = `
        <div>
          <span class="win-chip">WIN</span>
          <h3 class="settlement-hero-title">1등을 축하합니다!</h3>
          <span style="font-size:13px;color:#9bb2c0;">내 총자산</span>
        </div>
        <strong class="settlement-hero-assets">${formatWon(mySnap.preGrantTotalAssets)}</strong>
      `;
    } else {
      heroBox.innerHTML = `
        <div>
          <span class="status-pill" style="display:inline-block;margin-bottom:8px;">내 결과</span>
          <h3 class="settlement-hero-title">최종 ${mySnap.rank}위</h3>
          <span style="font-size:13px;color:#9bb2c0;">내 총자산</span>
        </div>
        <strong class="settlement-hero-assets" style="color:#f1f7fa;">${formatWon(mySnap.preGrantTotalAssets)}</strong>
      `;
    }

    // 1. 전체 참가자 최종 순위표
    const leaderboardList = snap.leaderboard || snap.participantsSnapshot || [];
    let rowsHtml = '';
    for (const ps of leaderboardList) {
      const isMe = ps.participantId === me.id;
      rowsHtml += `
        <tr class="${isMe ? 'is-me' : ''}">
          <td><strong>${ps.rank}</strong></td>
          <td>${escapeHtml(ps.nickname)}${isMe ? ' · <span style="color:#4fe3b5;">나</span>' : ''}</td>
          <td class="num"><strong>${formatWon(ps.preGrantTotalAssets)}</strong></td>
        </tr>
      `;
    }

    $('settlement-leaderboard').innerHTML = `
      <div class="opening-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>참가자</th>
              <th class="num">총자산</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;

    // 1-2. 내 투자 복기 (최종 순위표 바로 아래에 내 거래와 연결된 사례 최대 3개 표시)
    const reviewsWrap = $('settlement-trade-reviews-wrap');
    if (reviewsWrap) {
      const reviews = Array.isArray(snap.myTradeReviews) ? snap.myTradeReviews : [];
      if (reviews.length === 0) {
        reviewsWrap.innerHTML = `
          <div class="trade-review-empty">복기할 거래 내역이 없어요</div>
        `;
      } else {
        let cardsHtml = '';
        for (const rev of reviews) {
          const clueBadgeClass = rev.clueSourceType === 'PURCHASED_PAID'
            ? 'trc-step-badge paid-clue'
            : 'trc-step-badge public-clue';

          let outcomesHtml = '';
          for (const out of rev.outcomes || []) {
            const outBadgeClass = out.changeRatePercent > 0
              ? 'trc-step-badge result-up'
              : (out.changeRatePercent < 0 ? 'trc-step-badge result-down' : 'trc-step-badge');
            outcomesHtml += `
              <div class="trc-step-line">
                <span class="${outBadgeClass}">${escapeHtml(out.label)}</span>
                <span class="trc-step-text">${escapeHtml(out.text)}</span>
              </div>
            `;
          }

          cardsHtml += `
            <article class="trade-review-card">
              <div class="trc-action-row">
                <strong class="trc-action-title">${escapeHtml(rev.actionTitle)}</strong>
                <span class="trc-action-meta">${escapeHtml(rev.actionMeta)}</span>
              </div>
              <div class="trc-step-list">
                <div class="trc-step-line">
                  <span class="${clueBadgeClass}">당시 단서 · ${escapeHtml(rev.clueSourceLabel)}</span>
                  <span class="trc-step-text">${escapeHtml(rev.clueText)}</span>
                </div>
                ${outcomesHtml}
              </div>
            </article>
          `;
        }
        reviewsWrap.innerHTML = cardsHtml;
      }
    }

    // 2. 내 보유 종목별 최종 평가 결과 (기획서 2쪽)
    const myHoldingsWrap = $('settlement-my-holdings-wrap');
    if (myHoldingsWrap) {
      const heldList = (mySnap.holdingsDetail || []).filter((h) => h.quantity > 0);
      if (heldList.length === 0) {
        myHoldingsWrap.innerHTML = `
          <div style="padding:14px 16px;font-size:13px;color:#9bb2c0;">
            보유 현금: <strong>${formatWon(mySnap.cashBeforeGrant)}</strong> · 최종 정산 시점 보유 주식이 없습니다.
          </div>
        `;
      } else {
        let hRows = '';
        for (const h of heldList) {
          const pnl = h.evaluation - h.quantity * h.avgBuyPrice;
          const pnlClass = pnl > 0 ? 'text-up' : (pnl < 0 ? 'text-down' : 'text-neutral');
          hRows += `
            <tr>
              <td><strong>${escapeHtml(h.name)}</strong></td>
              <td class="num">${h.quantity.toLocaleString('ko-KR')}주</td>
              <td class="num">${formatWon(h.avgBuyPrice)}</td>
              <td class="num"><strong>${formatWon(h.currentPrice)}</strong></td>
              <td class="num"><strong>${formatWon(h.evaluation)}</strong></td>
              <td class="num ${pnlClass}">${formatSignedWon(pnl)}</td>
            </tr>
          `;
        }
        myHoldingsWrap.innerHTML = `
          <table class="data-table">
            <thead>
              <tr>
                <th>보유 종목</th>
                <th class="num">수량</th>
                <th class="num">평균 매수가</th>
                <th class="num">2020년 최종가</th>
                <th class="num">최종 평가액</th>
                <th class="num">최종 평가손익</th>
              </tr>
            </thead>
            <tbody>${hRows}</tbody>
          </table>
        `;
      }
    }

    // 3. 이번 판의 다년도(2~6년) 장기 사건 및 주요 결말 요약
    const arcsBlock = $('settlement-arcs-block');
    const arcsWrap = $('settlement-arcs-wrap');
    if (arcsBlock && arcsWrap) {
      const arcs = snap.multiYearArcs || [];
      if (arcs.length === 0) {
        arcsBlock.classList.add('hidden');
      } else {
        arcsBlock.classList.remove('hidden');
        let arcRows = '';
        for (const arc of arcs) {
          arcRows += `
            <tr>
              <td><span class="industry-chip">${escapeHtml(arc.industry)}</span></td>
              <td><strong>${escapeHtml(arc.title)}</strong></td>
              <td>${arc.durationYears}년 장기 사건</td>
              <td>${escapeHtml(arc.finalOutcomeSummary)}</td>
            </tr>
          `;
        }
        arcsWrap.innerHTML = `
          <table class="data-table">
            <thead>
              <tr>
                <th>업종</th>
                <th>장기 사건명</th>
                <th>기간</th>
                <th>이번 판의 최종 결말 및 사업 주인</th>
              </tr>
            </thead>
            <tbody>${arcRows}</tbody>
          </table>
        `;
      }
    }

    // 4. 2020년 최종 종목 시세표
    let sRows = '';
    for (const sc of snap.stockChanges) {
      const rateClass = sc.changeRatePercent > 0 ? 'text-up' : (sc.changeRatePercent < 0 ? 'text-down' : 'text-neutral');
      sRows += `
        <tr>
          <td><strong>${escapeHtml(sc.name)}</strong></td>
          <td class="num">${formatWon(sc.prevPrice)}</td>
          <td class="num"><strong>${formatWon(sc.currentPrice)}</strong></td>
          <td class="num ${rateClass}">${formatRate(sc.changeRatePercent)}</td>
          <td>${escapeHtml(sc.reason)}</td>
        </tr>
      `;
    }
    $('settlement-stocks-wrap').innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>종목</th>
            <th class="num">2019년 주가</th>
            <th class="num">2020년 최종 주가</th>
            <th class="num">등락률</th>
            <th>변동 이유</th>
          </tr>
        </thead>
        <tbody>${sRows}</tbody>
      </table>
    `;
  }

  function hide15SecWarningBanner() {
    if (warning15SecHideTimer) {
      clearTimeout(warning15SecHideTimer);
      warning15SecHideTimer = null;
    }
    const banner = $('trading-15s-warning-banner');
    if (banner) {
      banner.classList.add('hidden');
    }
  }

  function trigger15SecWarningOnceForRound(roundKey) {
    if (!roundKey || uiState.warned15SecRoundKeys.has(roundKey)) return;
    uiState.warned15SecRoundKeys.add(roundKey);
    persistWarned15SecRoundKeys(uiState.warned15SecRoundKeys);
    uiState.warning15SecTriggerCountByRound[roundKey] =
      (uiState.warning15SecTriggerCountByRound[roundKey] || 0) + 1;

    const banner = $('trading-15s-warning-banner');
    if (banner) {
      banner.textContent = '거래 마감까지 30초 남았어요';
      banner.classList.remove('hidden');
      if (warning15SecHideTimer) clearTimeout(warning15SecHideTimer);
      warning15SecHideTimer = setTimeout(() => {
        banner.classList.add('hidden');
        warning15SecHideTimer = null;
      }, 5000);
    }
  }

  /**
   * 서버 마감 시각(phaseEndsAt)과 동기화된 타이머 갱신
   */
  function updateTimersDisplay() {
    if (!appState) return;
    const { room } = appState;
    const nowServer = Date.now() + serverClockOffset;

    if (!room.phaseEndsAt) {
      $('tutorial-timer-badge').textContent = '대기 중';
      $('trading-timer-pill').textContent = `${room.currentYear}년 개장`;
      $('trading-timer-pill').classList.remove('urgent');
      $('opening-timer-badge').classList.add('hidden');
      hide15SecWarningBanner();
      return;
    }

    const remainingMs = Math.max(0, room.phaseEndsAt - nowServer);
    const formatted = formatMMSS(remainingMs);
    const isUrgent = remainingMs <= 15000;

    if (room.status === 'TUTORIAL') {
      $('tutorial-timer-badge').textContent = formatted;
      hide15SecWarningBanner();
    } else if (room.status === 'TRADING') {
      const pill = $('trading-timer-pill');
      pill.textContent = formatted;
      pill.classList.toggle('urgent', isUrgent);

      // 서버 타이머 기준으로 남은 시간이 30초 이하로 처음 진입할 때 라운드당 1회만 경고 배너 표시
      if (remainingMs > 0 && remainingMs <= 30000) {
        const roundKey = `${room.code}:${room.gameNumber || 1}:${room.currentYear}:${room.phaseStartedAt}`;
        trigger15SecWarningOnceForRound(roundKey);
      } else if (remainingMs === 0) {
        hide15SecWarningBanner();
      }
    } else if (room.status === 'OPENING') {
      const opBadge = $('opening-timer-badge');
      opBadge.classList.remove('hidden');
      opBadge.textContent = formatted;
      hide15SecWarningBanner();
    } else {
      hide15SecWarningBanner();
    }
  }

  setInterval(updateTimersDisplay, 200);

  /**
   * 탭 전환 헬퍼
   */
  function switchTab(tabName) {
    if (uiState.activeTab === 'articles') {
      saveCurrentArticleScrollState(uiState.articleNav);
    }
    uiState.activeTab = tabName;
    if (tabName === 'market') {
      uiState.showMyInvestment = false;
    } else if (tabName === 'articles') {
      uiState.cameFromArticles = false;
      uiState.pendingArticleScrollRestore = true;
    }
    renderTradingScreen();
  }

  /**
   * 주식 매수/매도 주문 제출 핸들러
   */
  async function handleSubmitOrder(customRequestId = null) {
    if (!appState || !session || uiState.isSubmittingOrder) return;
    const { room, stocks } = appState;
    const stock = stocks.find((s) => s.id === uiState.selectedStockId);
    if (!stock) return;

    const quantity = Math.floor(Number($('input-order-qty').value) || uiState.orderQty);
    const requestId = customRequestId || `ord_${session.participantId}_${room.currentYear}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    uiState.isSubmittingOrder = true;
    renderOrderPanel();

    try {
      const { data } = await apiPost('/api/rooms/order', {
        roomCode: session.roomCode,
        participantId: session.participantId,
        token: session.token,
        year: room.currentYear,
        stockId: stock.id,
        side: uiState.orderSide,
        quantity,
        requestId
      });

      uiState.isSubmittingOrder = false;

      if (!data.ok) {
        const statusEl = $('order-status-text');
        statusEl.textContent = data.message || '주문을 처리할 수 없습니다.';
        statusEl.className = 'order-status-text error';
        statusEl.classList.remove('hidden');
        showToast(data.message || '주문 실패', true);
        return data;
      }

      // 주문(매수/매도) 체결 완료 후 수량을 1주로 초기화
      resetOrderQuantityToOne();

      if (data.state) {
        applyServerState(data.state);
      }
      showToast(data.message);
      return data;
    } catch (err) {
      uiState.isSubmittingOrder = false;
      renderOrderPanel();
      showToast('주문 요청 중 네트워크 오류가 발생했습니다.', true);
      return { ok: false };
    }
  }

  /**
   * 유료 기사 구매 핸들러
   */
  async function handleBuyArticle(article, customRequestId = null) {
    if (!appState || !session || !article || uiState.isBuyingArticle) return;
    const { room } = appState;
    const requestId = customRequestId || `art_${session.participantId}_${room.currentYear}_${article.id}`;

    uiState.isBuyingArticle = true;
    renderArticlesTab();

    try {
      const { data } = await apiPost('/api/rooms/buy-article', {
        roomCode: session.roomCode,
        participantId: session.participantId,
        token: session.token,
        year: room.currentYear,
        articleId: article.id,
        requestId
      });

      uiState.isBuyingArticle = false;

      if (!data.ok) {
        showToast(data.message || '기사 구매에 실패했습니다.', true);
        renderArticlesTab();
        return data;
      }

      if (data.state) {
        applyServerState(data.state);
      }
      showToast(data.message);
      return data;
    } catch (err) {
      uiState.isBuyingArticle = false;
      renderArticlesTab();
      showToast('기사 구매 요청 중 오류가 발생했습니다.', true);
      return { ok: false };
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 이벤트 리스너 바인딩
   */
  function bindEvents() {
    // BGM 켜기/끄기 토글 버튼 (사용자 직접 조작 시 설정 저장)
    const bgmBtn = $('btn-bgm-toggle');
    if (bgmBtn) {
      bgmBtn.addEventListener('click', () => {
        setBgmEnabled(!uiState.bgmEnabled, { persist: true });
      });
    }

    // 게임 방법 안내 모달
    const openGuide = () => $('modal-guide').classList.remove('hidden');
    const closeGuide = () => $('modal-guide').classList.add('hidden');
    $('btn-open-guide-entry').addEventListener('click', openGuide);
    $('btn-open-guide-tutorial').addEventListener('click', openGuide);
    $('btn-close-guide').addEventListener('click', closeGuide);
    $('btn-confirm-guide').addEventListener('click', closeGuide);

    // 01. 입장 화면: 1인 / 친구방 모드 전환
    const setEntryMode = (mode) => {
      uiState.entryMode = mode;
      $('mode-card-solo').classList.toggle('selected', mode === 'solo');
      $('mode-card-friend').classList.toggle('selected', mode === 'friend');
      $('friend-mode-panel').classList.toggle('hidden', mode !== 'friend');
      $('solo-mode-panel').classList.toggle('hidden', mode !== 'solo');
    };
    $('mode-card-solo').addEventListener('click', () => setEntryMode('solo'));
    $('mode-card-friend').addEventListener('click', () => setEntryMode('friend'));

    // 닉네임 실시간 검증
    const checkEntryNickname = () => {
      const raw = $('input-nickname').value;
      const trimmed = raw.trim();
      const errEl = $('nickname-error');
      if (!raw) {
        errEl.textContent = '닉네임을 입력해 주세요.';
        errEl.classList.remove('hidden');
        return null;
      }
      if (!trimmed) {
        errEl.textContent = '공백만으로는 닉네임을 사용할 수 없습니다.';
        errEl.classList.remove('hidden');
        return null;
      }
      if (trimmed.length < 2 || trimmed.length > 12) {
        errEl.textContent = '닉네임은 2~12자로 입력해 주세요.';
        errEl.classList.remove('hidden');
        return null;
      }
      errEl.classList.add('hidden');
      return trimmed;
    };

    $('input-nickname').addEventListener('input', () => {
      $('nickname-error').classList.add('hidden');
      $('entry-action-error').classList.add('hidden');
      $('solo-action-error').classList.add('hidden');
    });

    // 친구방 만들기 버튼
    $('btn-create-room').addEventListener('click', async () => {
      if (uiState.isEntrySubmitting) return;
      const nickname = checkEntryNickname();
      if (!nickname) return;

      const roomName = $('input-room-name').value.trim() || `${nickname}의 투자방`;
      const capacity = Number($('select-room-capacity').value) || 4;
      const errEl = $('entry-action-error');
      errEl.classList.add('hidden');

      uiState.isEntrySubmitting = true;
      $('btn-create-room').disabled = true;
      $('btn-join-room').disabled = true;

      try {
        const { data } = await apiPost('/api/rooms/create', {
          nickname,
          roomName,
          capacity,
          mode: 'friend',
          excludedSignatures: getPlayedScenarios()
        });
        uiState.isEntrySubmitting = false;
        $('btn-create-room').disabled = false;
        $('btn-join-room').disabled = false;

        if (!data.ok) {
          errEl.textContent = data.message;
          errEl.classList.remove('hidden');
          return;
        }

        saveSession({
          roomCode: data.roomCode,
          participantId: data.participantId,
          token: data.token,
          nickname: data.nickname
        });
        applyServerState(data.state);
        connectSSE();
      } catch (err) {
        uiState.isEntrySubmitting = false;
        $('btn-create-room').disabled = false;
        $('btn-join-room').disabled = false;
        errEl.textContent = '방 생성 중 오류가 발생했습니다.';
        errEl.classList.remove('hidden');
      }
    });

    // 친구방 코드로 참여 버튼
    $('btn-join-room').addEventListener('click', async () => {
      if (uiState.isEntrySubmitting) return;
      const nickname = checkEntryNickname();
      if (!nickname) return;

      const codeInput = $('input-join-code');
      const roomCode = codeInput.value.toUpperCase().trim();
      const errEl = $('entry-action-error');

      if (!roomCode) {
        codeInput.focus();
        errEl.textContent = '참여할 6자리 방 코드를 입력해 주세요.';
        errEl.classList.remove('hidden');
        return;
      }

      errEl.classList.add('hidden');
      uiState.isEntrySubmitting = true;
      $('btn-create-room').disabled = true;
      $('btn-join-room').disabled = true;

      try {
        const { data } = await apiPost('/api/rooms/join', {
          nickname,
          roomCode
        });
        uiState.isEntrySubmitting = false;
        $('btn-create-room').disabled = false;
        $('btn-join-room').disabled = false;

        if (!data.ok) {
          errEl.textContent = data.message;
          errEl.classList.remove('hidden');
          return;
        }

        saveSession({
          roomCode: data.roomCode,
          participantId: data.participantId,
          token: data.token,
          nickname: data.nickname
        });
        applyServerState(data.state);
        connectSSE();
      } catch (err) {
        uiState.isEntrySubmitting = false;
        $('btn-create-room').disabled = false;
        $('btn-join-room').disabled = false;
        errEl.textContent = '방 참여 요청에 실패했습니다.';
        errEl.classList.remove('hidden');
      }
    });

    // 1인 모드 시작 버튼
    $('btn-start-solo').addEventListener('click', async () => {
      if (uiState.isEntrySubmitting) return;
      const nickname = checkEntryNickname();
      if (!nickname) return;

      const errEl = $('solo-action-error');
      errEl.classList.add('hidden');
      uiState.isEntrySubmitting = true;
      $('btn-start-solo').disabled = true;

      try {
        const { data } = await apiPost('/api/rooms/create', {
          nickname,
          roomName: `${nickname}의 1인 투자`,
          mode: 'solo',
          excludedSignatures: getPlayedScenarios()
        });

        if (!data.ok) {
          uiState.isEntrySubmitting = false;
          $('btn-start-solo').disabled = false;
          errEl.textContent = data.message;
          errEl.classList.remove('hidden');
          return;
        }

        saveSession({
          roomCode: data.roomCode,
          participantId: data.participantId,
          token: data.token,
          nickname: data.nickname
        });

        // 1인 모드는 대기방 단계 없이 바로 게임을 시작 (기획서 8쪽)
        const startRes = await apiPost('/api/rooms/start', {
          roomCode: data.roomCode,
          participantId: data.participantId,
          token: data.token
        });

        uiState.isEntrySubmitting = false;
        $('btn-start-solo').disabled = false;

        applyServerState(startRes.data.ok ? startRes.data.state : data.state);
        connectSSE();
      } catch (err) {
        uiState.isEntrySubmitting = false;
        $('btn-start-solo').disabled = false;
        errEl.textContent = '1인 모드 시작 중 오류가 발생했습니다.';
        errEl.classList.remove('hidden');
      }
    });

    // 02. 대기방 이벤트 (코드 복사, 나가기, 게임 시작)
    $('btn-copy-code').addEventListener('click', async () => {
      if (!appState) return;
      try {
        await navigator.clipboard.writeText(appState.room.code);
        showToast(`방 코드(${appState.room.code})가 복사되었습니다.`);
      } catch (e) {
        showToast(`방 코드: ${appState.room.code}`);
      }
    });

    $('btn-leave-waiting').addEventListener('click', async () => {
      if (session) {
        await apiPost('/api/rooms/leave', session);
      }
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      saveSession(null);
      appState = null;
      renderAll();
      refreshEntryUsageStats();
    });

    $('btn-start-game').addEventListener('click', async () => {
      if (!session) return;
      const { data } = await apiPost('/api/rooms/start', session);
      if (!data.ok) {
        showToast(data.message || '게임을 시작할 수 없습니다.', true);
        return;
      }
      if (data.state) applyServerState(data.state);
    });

    // 03. 튜토리얼 확인 & 건너뛰기 (두 버튼 모두 진행 준비로 집계 - 기획서 8쪽)
    const sendReady = async (readyVal = true) => {
      if (!session) return;
      const { data } = await apiPost('/api/rooms/ready', {
        ...session,
        ready: readyVal
      });
      if (data.ok && data.state) {
        applyServerState(data.state);
      }
    };

    $('btn-tutorial-skip').addEventListener('click', () => sendReady(true));
    $('btn-tutorial-confirm').addEventListener('click', () => sendReady(true));

    // 04~09. 상단 마감 준비 토글 버튼
    $('btn-trading-ready').addEventListener('click', () => {
      if (!appState) return;
      const nextReady = !appState.me.readyForNextPhase;
      sendReady(nextReady);
    });

    // 개장 결과 화면 <-> 개장 시점 시장 화면 전환
    $('btn-opening-inspect-market').addEventListener('click', () => {
      uiState.inspectingMarketDuringOpening = true;
      uiState.activeTab = 'market';
      renderAll();
    });
    $('btn-back-to-opening').addEventListener('click', () => {
      uiState.inspectingMarketDuringOpening = false;
      renderAll();
    });

    // 개장 결과 화면에서 다음 해 거래로 이동 버튼
    $('btn-opening-next-trading').addEventListener('click', () => sendReady(true));

    // 메인 탭 전환 (시장 / 기사 / 채팅)
    document.querySelectorAll('.main-tab-btn, .mobile-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    // 내 투자 토글 버튼
    const toggleMyInvestment = (forceVal) => {
      if (uiState.activeTab === 'articles') {
        saveCurrentArticleScrollState(uiState.articleNav);
      }
      uiState.activeTab = 'market';
      uiState.showMyInvestment = typeof forceVal === 'boolean' ? forceVal : !uiState.showMyInvestment;
      renderTradingScreen();
    };
    $('btn-toggle-my-investment').addEventListener('click', () => toggleMyInvestment());
    $('btn-mobile-my-investment').addEventListener('click', () => toggleMyInvestment(true));
    $('btn-mobile-detail-my-inv').addEventListener('click', () => toggleMyInvestment(true));
    $('btn-close-my-investment').addEventListener('click', () => toggleMyInvestment(false));

    // 모바일 뒤로가기 버튼 및 읽던 기사로 돌아가기 버튼
    $('btn-mobile-back-to-list').addEventListener('click', () => {
      uiState.mobileShowDetail = false;
      uiState.showMyInvestment = false;
      renderMarketTab();
    });
    $('btn-mobile-back-to-articles').addEventListener('click', () => {
      uiState.mobileShowReader = false;
      uiState.pendingArticleScrollRestore = true;
      renderArticlesTab();
    });
    const backToArticleBtn = $('btn-back-to-reading-article');
    if (backToArticleBtn) {
      backToArticleBtn.addEventListener('click', () => {
        uiState.cameFromArticles = false;
        switchTab('articles');
      });
    }

    // 기사 목록 스크롤 위치 실시간 저장 (PC 목록 요소 스크롤 및 모바일 페이지 스크롤 모두 대응)
    const artListUl = $('article-list-ul');
    if (artListUl) {
      artListUl.addEventListener('scroll', () => {
        if (isRenderingArticles || !isArticlesPanelActiveAndVisible()) return;
        if (artListUl.offsetParent !== null) {
          uiState.articleScrollTopByNav[uiState.articleNav] = artListUl.scrollTop;
        }
      });
    }
    window.addEventListener('scroll', () => {
      if (isRenderingArticles || !isArticlesPanelActiveAndVisible()) return;
      const navKey = uiState.articleNav || 'current_free';
      if (isMobileReaderDrilldown()) {
        uiState.articleReaderPageScrollYByNav[navKey] = getPageScrollY();
      } else {
        uiState.articlePageScrollYByNav[navKey] = getPageScrollY();
      }
    }, { passive: true });

    // 매수/매도 전환
    $('btn-side-buy').addEventListener('click', () => {
      uiState.orderSide = 'BUY';
      renderOrderPanel();
    });
    $('btn-side-sell').addEventListener('click', () => {
      uiState.orderSide = 'SELL';
      renderOrderPanel();
    });

    // 수량 입력 및 증감 버튼
    $('btn-qty-minus').addEventListener('click', () => {
      uiState.orderQty = Math.max(1, (Number(uiState.orderQty) || 1) - 1);
      $('input-order-qty').value = String(uiState.orderQty);
      renderOrderPanel();
    });
    $('btn-qty-plus').addEventListener('click', () => {
      uiState.orderQty = Math.max(1, (Number(uiState.orderQty) || 0) + 1);
      $('input-order-qty').value = String(uiState.orderQty);
      renderOrderPanel();
    });
    $('input-order-qty').addEventListener('input', (e) => {
      const val = Math.floor(Number(e.target.value) || 0);
      uiState.orderQty = val >= 0 ? val : 0;
      renderOrderPanel();
    });

    document.querySelectorAll('.qty-chip[data-qty-pct]').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (!appState) return;
        const stock = appState.stocks.find((s) => s.id === uiState.selectedStockId);
        if (!stock) return;
        const pct = Number(chip.dataset.qtyPct) || 0;
        const maxQty = uiState.orderSide === 'BUY'
          ? Math.floor(appState.me.cash / stock.currentPrice)
          : stock.myQuantity;
        const targetQty = pct >= 100
          ? maxQty
          : Math.floor((maxQty * pct) / 100);
        uiState.orderQty = Math.max(1, targetQty);
        $('input-order-qty').value = String(uiState.orderQty);
        renderOrderPanel();
      });
    });

    // 주문 실행 버튼
    $('btn-submit-order').addEventListener('click', () => handleSubmitOrder());

    // 종목 상세 내부 서브뷰 전환 (주문 · 가격 추이 vs 단서 타임라인)
    $('btn-detail-view-order').addEventListener('click', () => {
      uiState.detailSubview = 'order';
      renderOrderPanel();
    });
    $('btn-detail-view-timeline').addEventListener('click', () => {
      uiState.detailSubview = 'timeline';
      renderOrderPanel();
    });

    // 종목 추리 메모 입력 저장
    $('input-deduction-memo').addEventListener('input', (e) => {
      if (!appState) return;
      updateStockDeductionMemo(uiState.selectedStockId, e.target.value);
    });

    // 기사 보관함 업종·단서 필터 바
    document.querySelectorAll('#articles-filter-bar .art-filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        uiState.articleFilter = chip.dataset.filter || 'ALL';
        uiState.selectedArchiveArticleId = null;
        uiState.articleScrollTopByNav.archive = 0;
        uiState.articlePageScrollYByNav.archive = 0;
        uiState.pendingArticleScrollRestore = true;
        renderArticlesTab();
      });
    });

    // 기사 내부 탐색 3가지 (올해 기사 / 유료 단서 / 보관함)
    const switchArticleNav = (nextNav) => {
      saveCurrentArticleScrollState(uiState.articleNav);
      uiState.articleNav = nextNav;
      uiState.mobileShowReader = false;
      uiState.pendingArticleScrollRestore = true;
      renderArticlesTab();
    };
    $('btn-art-nav-current').addEventListener('click', () => switchArticleNav('current_free'));
    $('btn-art-nav-paid').addEventListener('click', () => switchArticleNav('paid_clues'));
    $('btn-art-nav-archive').addEventListener('click', () => switchArticleNav('archive'));

    // 채팅 채널 및 전송
    $('btn-chat-channel-all').addEventListener('click', () => {
      uiState.selectedChatTargetId = null;
      renderChatTab();
    });

    $('form-chat-send').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!session || !appState) return;
      const input = $('input-chat-text');
      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      const { data } = await apiPost('/api/rooms/chat', {
        ...session,
        targetId: uiState.selectedChatTargetId,
        text
      });
      if (!data.ok) {
        showToast(data.message || '채팅 전송 실패', true);
      }
    });

    // 11 & 12. 최종 정산 홈으로 / 다시 플레이
    $('btn-settlement-home').addEventListener('click', async () => {
      if (session) {
        try {
          await apiPost('/api/rooms/leave', session);
        } catch (e) {
          // ignore
        }
      }
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      saveSession(null);
      appState = null;
      renderAll();
      refreshEntryUsageStats();
    });

    $('btn-settlement-replay').addEventListener('click', async () => {
      if (!session) return;
      const { data } = await apiPost('/api/rooms/reset', {
        ...session,
        useReplayScenario: true
      });
      if (data.ok && data.state) {
        applyServerState(data.state);
        showToast('새로운 시나리오로 대기방이 준비되었습니다.');
        refreshEntryUsageStats();
      }
    });
  }

  const STATS_CACHE_KEY = 'ant_square_cumulative_stats_v1';

  async function refreshEntryUsageStats() {
    const pill = $('entry-user-stats-pill');
    if (!pill) return;
    let cachedTotal = 0;
    let cachedGames = 0;
    try {
      const raw = localStorage.getItem(STATS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        cachedTotal = Number(parsed.total) || 0;
        cachedGames = Number(parsed.games) || 0;
      }
    } catch (e) {
      // ignore
    }

    try {
      const qs = new URLSearchParams();
      if (cachedTotal > 0) qs.set('clientTotal', String(cachedTotal));
      if (cachedGames > 0) qs.set('clientGames', String(cachedGames));
      const url = qs.toString() ? `/api/stats?${qs.toString()}` : '/api/stats';
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok && data && data.ok) {
        const connected = (data.realtime && data.realtime.connectedHumanPlayers) || 0;
        const total = Math.max(cachedTotal, (data.cumulative && data.cumulative.totalHumanParticipations) || 0);
        const games = Math.max(cachedGames, (data.cumulative && data.cumulative.totalGamesStarted) || 0);
        try {
          localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ total, games }));
        } catch (e) {
          // ignore
        }
        pill.textContent = `현재 ${connected.toLocaleString('ko-KR')}명 · 누적 ${total.toLocaleString('ko-KR')}명 (${games.toLocaleString('ko-KR')}판)`;
      }
    } catch (e) {
      // ignore network error
    }
  }

  /**
   * 초기 부트스트랩 (기존 세션 자동 복구)
   */
  async function init() {
    bindEvents();
    initBgm();
    refreshEntryUsageStats();
    setInterval(refreshEntryUsageStats, 15000);

    const saved = loadSession();
    if (saved && saved.roomCode && saved.participantId && saved.token) {
      try {
        const qs = new URLSearchParams(saved);
        const res = await fetch(`/api/session?${qs.toString()}`);
        const data = await res.json();
        if (res.ok && data.ok && data.state) {
          session = saved;
          $('input-nickname').value = saved.nickname || '';
          applyServerState(data.state);
          connectSSE();
          return;
        }
      } catch (e) {
        // ignore and clear stale session
      }
      saveSession(null);
    }

    renderAll();
  }

  // 테스트 및 검증용 전역 헬퍼 노출
  window.__ANT_SQUARE__ = {
    getState: () => appState,
    getSession: () => session,
    getUiState: () => uiState,
    getUnreadChatCounts: () => computeUnreadChatCounts(),
    getBgmStatus: () => ({
      enabled: uiState.bgmEnabled,
      stored: localStorage.getItem(BGM_STORAGE_KEY),
      hasAudioInstance: Boolean(bgmAudio),
      paused: bgmAudio ? bgmAudio.paused : true,
      loop: bgmAudio ? bgmAudio.loop : false,
      volume: bgmAudio ? bgmAudio.volume : 0,
      src: bgmAudio ? bgmAudio.src : null
    }),
    forceTimerCheck: () => updateTimersDisplay(),
    submitOrderWithId: (requestId) => handleSubmitOrder(requestId)
  };

  document.addEventListener('DOMContentLoaded', init);
})();
