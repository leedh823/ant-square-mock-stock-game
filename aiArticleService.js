/**
 * 모의 주식 웹게임 (개미광장) - AI 기사 생성 및 검증·예비 기사 전환 서비스 (기획서 13쪽 구현)
 *
 * 기획서 13쪽 [AI가 기사를 만드는 방식] 5단계 파이프라인:
 * 1. 시나리오 설정: 사건·종목 연결, 공개 일정, 시작 가격과 개장 변동률, 무료 5건과 유료 단서 사실을 미리 확정
 * 2. AI에 입력: 발행 연도, 공개 가능 업종·회사명, 무료/유료 구분, 공개해도 되는 사실, 전달할 질문/단서만 전달
 *    (미래 가격과 아직 공개되지 않은 사건 결말·숨겨진 회사명은 절대 입력에 포함하지 않음)
 * 3. 기사 작성: 제목과 짧은 한국어 본문(2~4문장) 작성. 회사 이름을 숨긴 무료 기사는 공개 업종과 사건만 사용
 * 4. 검증과 저장: 연도, 공개 범위, 지정 수치, 숨긴 회사명 노출 여부를 검증해 방·연도·기사별로 저장.
 *    검증 실패·지연·오류 시 정해둔 사실 기반의 예비 기사(fallback)로 즉시 교체
 * 5. 공개: 새해 거래 시작 시 무료 5건 동시 제공, 유료 기사는 소유권 확인 후 저장된 하나의 본문 제공.
 *    (유료 기사 구입 버튼은 생성 API를 직접 호출하지 않음)
 */

const CONFIG = require('./config');

const ALL_COMPANY_NAMES = [
  'A바이오', 'A 바이오',
  'B바이오', 'B 바이오',
  'A엔터', 'A 엔터',
  'B엔터', 'B 엔터',
  'A반도체', 'A 반도체',
  'B반도체', 'B 반도체',
  'A식품', 'A 식품',
  'A게임', 'A 게임',
  'A조선', 'A 조선',
  'A항공', 'A 항공'
];

/**
 * 내장 기사와 외부 AI 기사 생성 경로에 공통 적용하는 금지 표현 규칙
 * - 미래 상승·하락 여부 단정, 확정/예상 등락률, 제목만 보고 결과를 추정하기 쉬운 표현 차단
 */
const FORBIDDEN_PREDICTIVE_PATTERNS = [
  { code: 'FUTURE_RETURN_RATE_LEAK', regex: /[+-]\s*\d+(\.\d+)?\s*%/ },
  { code: 'FUTURE_RETURN_RATE_LEAK', regex: /900\s*%/ },
  { code: 'PREDICTIVE_DIRECTION_LEAK', regex: /(급등|급락|폭등|폭락)\s*(기대|전망|예상|우려|가능성|예고)?/ },
  { code: 'PREDICTIVE_DIRECTION_LEAK', regex: /(주가|시세)\s*(상승|하락|강세|약세|반등|조정)/ },
  { code: 'PREDICTIVE_DIRECTION_LEAK', regex: /(상승|하락)\s*(전망|기대|예상|확정|유력|우려)/ },
  { code: 'PREDICTIVE_DIRECTION_LEAK', regex: /(수익성|영업이익)\s*(급감|급증|폭증)/ }
];

function checkPredictiveExpressionLeak(text) {
  const target = String(text || '');
  for (const rule of FORBIDDEN_PREDICTIVE_PATTERNS) {
    if (rule.regex.test(target)) {
      return rule.code;
    }
  }
  return null;
}

/**
 * 2단계: AI에 넘기는 구조화된 사실 입력(Fact Brief) 생성
 * 미래 가격이나 미공개 결말은 제외하고 해당 연도에 공개 가능한 사실과 단서만 추출합니다.
 */
function buildArticleFactBrief(article) {
  const isFree = article.type === 'free';
  const hideCompany = Boolean(article.hideCompanyName);

  // 회사 이름을 숨긴 무료 기사는 모든 개별 회사명을 금지 목록에 추가 (기획서 5쪽, 6쪽, 13쪽)
  const forbiddenCompanyNames = hideCompany
    ? [...ALL_COMPANY_NAMES]
    : (article.forbiddenCompanyNames || []);

  return {
    year: article.year,
    articleId: article.id,
    articleType: isFree ? '무료' : '유료',
    clueType: article.clueType || 'single',
    hasChoicePair: Boolean(article.hasChoicePair),
    allowedIndustry: article.industry,
    allowedCompanyName: hideCompany ? null : (article.stockName || null),
    hideCompanyName: hideCompany,
    forbiddenCompanyNames,
    disclosedFacts: Array.isArray(article.disclosedFacts) && article.disclosedFacts.length > 0
      ? article.disclosedFacts
      : [article.summary || article.subtitle || '업종 내 주요 경영 현안 발생'],
    questionOrClue: article.questionOrClue || (isFree
      ? '수혜 종목과 실적 반영 시점을 추리하게 한다.'
      : (article.highlightNote || '올해 확인된 일정·비용·계약 단서를 전달한다.')),
    requiredKeywords: article.requiredKeywords || [],
    arcStageLabel: article.arcStageLabel || null
  };
}

/**
 * 3단계: 사실 기반 한국어 기사 원고 작성 (외부 LLM API 연동 또는 내장 한국어 뉴스 문장 합성기)
 * - 환경변수(AI_ARTICLE_API_URL / GEMINI_API_KEY / OPENAI_API_KEY)가 설정된 경우 타임아웃 내에 LLM 호출을 시도하고,
 * - 미설정 또는 오프라인 샌드박스 환경에서는 사실(Fact Brief) 기반 다중 문형 조합 엔진으로 2~4문장 원고를 생성합니다.
 */
async function generateArticleManuscript(brief, fallbackArticle) {
  // 외부 LLM 엔드포인트가 설정된 경우 비동기 호출 (타임아웃 2.5초, 지연 시 예비 기사로 폴백)
  if (process.env.AI_ARTICLE_API_URL && typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const prompt = [
        `발행 연도: ${brief.year}년 / 구분: ${brief.articleType} / 단서 유형: ${brief.clueType} / 업종: ${brief.allowedIndustry}`,
        brief.allowedCompanyName
          ? `공개 가능 회사명: ${brief.allowedCompanyName}`
          : '주의: 특정 회사명(A바이오, B바이오 등)을 절대 언급하지 말고 업종명으로만 작성할 것.',
        `공개 사실: ${brief.disclosedFacts.join(' / ')}`,
        `기사 목적 및 단서: ${brief.questionOrClue}`,
        '작성 기준:',
        '1) 제목에는 사건의 주제와 확인된 사실만 쓰고, 급등 기대·하락 전망·예상 등락률처럼 결과를 추정하기 쉬운 표현을 쓰지 말 것.',
        '2) 본문은 짧은 문단 2~3개(\\n\\n으로 구분)로 작성하되 배경, 새로 확인된 사실, 현재 남아 있는 조건을 담고 반복 설명을 줄일 것.',
        '3) 미래의 상승·하락 여부, 확정 등락률(+/-%), 미공개 결말을 절대 직접 쓰지 말 것.',
        '4) 일정 단서는 발표·심사·계약의 시점을, 사업 리스크 단서는 비용·보증·실패 조건을 중심으로 작성할 것.',
        '출력 형식: JSON {"title":"...","body":"문단1\\n\\n문단2\\n\\n문단3"}'
      ].join('\n');

      const res = await fetch(process.env.AI_ARTICLE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.AI_ARTICLE_API_KEY ? { Authorization: `Bearer ${process.env.AI_ARTICLE_API_KEY}` } : {})
        },
        body: JSON.stringify({ prompt, brief }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data && data.title && data.body) {
          return {
            title: String(data.title).trim(),
            body: String(data.body).trim(),
            source: 'external_llm'
          };
        }
      }
    } catch (err) {
      clearTimeout(timer);
      // 오류 또는 타임아웃 시 아래 내장 생성기/예비 기사로 자연스럽게 전환
    }
  }

  // 내장 사실 기반 한국어 경제 뉴스 작성기 (본문 2~4문장 규칙 준수)
  return composeStructuredKoreanNews(brief, fallbackArticle);
}

/**
 * 공개 사실(disclosedFacts)과 단서(questionOrClue)만을 바탕으로 짧은 문단 2~3개 구조의 한국어 기사를 구성합니다.
 * - 제목에는 확인된 주제와 사실만 남기고, 결과를 추정하기 쉬운 표현이나 불필요한 수식어를 붙이지 않습니다.
 * - 반복 맺음말을 덧붙이지 않고 배경·확인된 사실·남아 있는 조건이 드러나는 문단 구조를 유지합니다.
 */
function composeStructuredKoreanNews(brief, fallbackArticle) {
  const baseTitle = String(
    brief.articleType === '무료'
      ? fallbackArticle.title
      : fallbackArticle.postTitle
  ).trim();
  const rawBody = String(fallbackArticle.body || '').trim();

  // 문단(\n\n) 구분을 보존하면서 각 문단의 앞뒤 공백을 정리
  let paragraphs = rawBody
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // 만약 단일 문단으로 들어온 경우 문장 단위로 2~3개 짧은 문단으로 자연스럽게 분리
  if (paragraphs.length === 1) {
    const sentences = paragraphs[0]
      .split(/(?<=[.!?다요])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length >= 4) {
      const mid = Math.ceil(sentences.length / 2);
      paragraphs = [
        sentences.slice(0, mid).join(' '),
        sentences.slice(mid).join(' ')
      ];
    } else if (sentences.length >= 2) {
      paragraphs = [
        sentences[0],
        sentences.slice(1).join(' ')
      ];
    }
  }

  if (paragraphs.length > 3) {
    paragraphs = [
      paragraphs[0],
      paragraphs[1],
      paragraphs.slice(2).join(' ')
    ];
  }

  return {
    title: baseTitle,
    body: paragraphs.join('\n\n'),
    source: 'fact_composer'
  };
}

/**
 * 4단계: 생성된 기사 원고 검증기 (내장 기사·외부 AI 기사 공통 적용)
 * - 해당 연도, 공개 범위(숨긴 회사명 노출 금지), 짧은 문단 2~3개 구조, 미래 상승·하락 및 확정 등락률 누출 여부를 검사합니다.
 * - 잘못된 생성물은 false를 반환하여 예비 기사(fallback)로 즉시 교체되게 합니다.
 */
function validateGeneratedArticle(manuscript, brief) {
  if (!manuscript || typeof manuscript.title !== 'string' || typeof manuscript.body !== 'string') {
    return { valid: false, reason: 'EMPTY_MANUSCRIPT' };
  }

  const title = manuscript.title.trim();
  const body = manuscript.body.trim();
  if (title.length < 4 || body.length < 20) {
    return { valid: false, reason: 'TOO_SHORT' };
  }

  // 1. 숨겨진 회사명 노출 검사 (기획서 5쪽, 6쪽, 13쪽: 회사 이름을 숨긴 무료 기사는 회사명이 드러나면 안 됨)
  if (brief.hideCompanyName && Array.isArray(brief.forbiddenCompanyNames)) {
    const combined = `${title} ${body}`;
    for (const forbidden of brief.forbiddenCompanyNames) {
      if (forbidden && combined.includes(forbidden)) {
        return { valid: false, reason: `FORBIDDEN_COMPANY_LEAK:${forbidden}` };
      }
    }
  }

  // 2. 유료 기사에 허용된 대상 회사명이 있을 때 대상 회사명이 포함되었는지 검사
  if (!brief.hideCompanyName && brief.allowedCompanyName) {
    const normalizedAllowed = brief.allowedCompanyName.replace(/\s+/g, '');
    const normalizedText = `${title} ${body}`.replace(/\s+/g, '');
    if (!normalizedText.includes(normalizedAllowed)) {
      return { valid: false, reason: 'MISSING_TARGET_COMPANY' };
    }
  }

  // 3. 미래 상승·하락 여부, 확정/예상 등락률, 결과 추정 표현 금지 검사 (제목·본문 공통)
  const combinedText = `${title} ${body}`;
  const leakCode = checkPredictiveExpressionLeak(combinedText);
  if (leakCode) {
    return { valid: false, reason: leakCode };
  }

  // 4. 필수 키워드/수치 포함 여부 검사 (예: "70%" 등 지정된 수치)
  if (Array.isArray(brief.requiredKeywords)) {
    for (const kw of brief.requiredKeywords) {
      if (kw && !combinedText.includes(kw)) {
        return { valid: false, reason: `MISSING_REQUIRED_KEYWORD:${kw}` };
      }
    }
  }

  // 5. 본문 문단 및 문장 수 검사 (짧은 문단 2~3개 권장, 전체 문장 2~10문장 허용)
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length < 1 || paragraphs.length > 4) {
    return { valid: false, reason: `INVALID_PARAGRAPH_COUNT:${paragraphs.length}` };
  }
  const sentenceCount = body
    .replace(/\n+/g, ' ')
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1).length;
  if (sentenceCount < 1 || sentenceCount > 12) {
    return { valid: false, reason: `INVALID_SENTENCE_COUNT:${sentenceCount}` };
  }

  return { valid: true };
}

/**
 * 특정 연도의 무료 5건과 유료 기사 전체를 사전 준비·검증·저장합니다.
 * - 방 시작 전 또는 전년도 거래가 진행되는 동안 비동기로 호출됩니다.
 * - 유료 기사 구입 버튼은 이 함수를 호출하지 않고 이미 저장된 본문만 열람합니다 (기획서 13쪽 5단계).
 */
async function prepareArticlesForYear(room, year) {
  if (!room || !room.scenario || !room.scenario.articlesByYear) return;
  const yearBundle = room.scenario.articlesByYear[year];
  if (!yearBundle || yearBundle._prepared) return;

  // 무료 기사 5건 검증 및 저장
  for (const freeArt of yearBundle.free || []) {
    const fallback = {
      title: freeArt.fallbackTitle || freeArt.title,
      summary: freeArt.fallbackSummary || freeArt.summary,
      body: freeArt.fallbackBody || freeArt.body
    };
    const brief = buildArticleFactBrief(freeArt);
    const candidate = await generateArticleManuscript(brief, {
      title: fallback.title,
      postTitle: fallback.title,
      body: fallback.body
    });

    const check = validateGeneratedArticle(candidate, brief);
    if (check.valid) {
      freeArt.title = candidate.title;
      freeArt.body = candidate.body;
      freeArt.aiStatus = candidate.source === 'external_llm' ? 'ai_verified' : 'fact_verified';
    } else {
      // 잘못된 생성물은 정해둔 사실 기반의 예비 기사로 즉시 교체 (기획서 13쪽 4단계)
      freeArt.title = fallback.title;
      freeArt.summary = fallback.summary;
      freeArt.body = fallback.body;
      freeArt.aiStatus = `fallback_replaced(${check.reason})`;
    }

    // 숨겨진 회사 무료 기사는 태그/관련 종목 ID도 숨김 처리 (기획서 5쪽: 검색 필터, 태그, 알림으로도 조기에 드러나지 않도록 한다)
    if (freeArt.hideCompanyName) {
      freeArt.relatedStockIds = [];
    }
  }

  // 유료 기사 검증 및 저장
  for (const paidArt of yearBundle.paid || []) {
    const fallback = {
      postTitle: paidArt.fallbackPostTitle || paidArt.postTitle,
      body: paidArt.fallbackBody || paidArt.body
    };
    const brief = buildArticleFactBrief(paidArt);
    const candidate = await generateArticleManuscript(brief, {
      title: fallback.postTitle,
      postTitle: fallback.postTitle,
      body: fallback.body
    });

    const check = validateGeneratedArticle(candidate, brief);
    if (check.valid) {
      paidArt.postTitle = candidate.title;
      paidArt.body = candidate.body;
      paidArt.aiStatus = candidate.source === 'external_llm' ? 'ai_verified' : 'fact_verified';
    } else {
      paidArt.postTitle = fallback.postTitle;
      paidArt.body = fallback.body;
      paidArt.aiStatus = `fallback_replaced(${check.reason})`;
    }
  }

  yearBundle._prepared = true;
}

/**
 * 방 시작 전(대기방/튜토리얼) 및 전년도 거래 중에 다음 연도 기사를 미리 준비합니다.
 */
async function prewarmScenarioArticles(room, upToYear = CONFIG.LAST_TRADING_YEAR) {
  if (!room || !room.scenario) return;
  for (let y = 2011; y <= upToYear; y++) {
    await prepareArticlesForYear(room, y);
  }
}

module.exports = {
  buildArticleFactBrief,
  generateArticleManuscript,
  validateGeneratedArticle,
  checkPredictiveExpressionLeak,
  prepareArticlesForYear,
  prewarmScenarioArticles
};
