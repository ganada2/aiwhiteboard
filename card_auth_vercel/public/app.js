(() => {
  const el = (id) => document.getElementById(id);

  const VALID_CARDS = [
    '4000000000000010',
    '4000000000000036',
    '4000000000000044',
    '4000000000000051',
  ];
  const SAMPLE_AMOUNTS = [
    '000000014800',
    '000000039000',
    '000000084000',
    '000000150000',
    '000000320000',
    '000000620000',
  ];
  const MERCHANTS = ['MCH_TOSS01', 'MCH_CAFE02', 'MCH_MART03', 'MCH_STORE04'];
  const TERMINALS = ['T0000001', 'T0000002', 'T0000003'];

  let seqCounter = 0;
  let autoRunning = true;
  let intervalMs = 1000;
  let elapsedMs = 0;
  let inFlight = false;

  let totalCount = 0;
  let okCount = 0;
  let errCount = 0;
  let totalLatencyMs = 0;

  const activeApprovedPool = [];

  function nextIds() {
    seqCounter += 1;
    const stan = String(seqCounter % 1000000).padStart(6, '0');
    const now = new Date();
    const ymd =
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    const rrn = `${ymd}${String(seqCounter % 10000).padStart(4, '0')}`;
    return { stan, rrn };
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function padAmount(v) {
    return String(v).replace(/\D/g, '').padStart(12, '0').slice(-12);
  }

  /* ================================================================
   * 4-Layer 스윔레인 직교 라운드(Orthogonal Rounded) SVG 커넥터 계산
   * ================================================================ */
  function anchorPos(stageRect, nodeEl, side) {
    const r = nodeEl.getBoundingClientRect();
    const cx = r.left - stageRect.left + r.width / 2;
    const cy = r.top - stageRect.top + r.height / 2;
    if (side === 'top') return { x: cx, y: r.top - stageRect.top };
    if (side === 'bottom') return { x: cx, y: r.bottom - stageRect.top };
    if (side === 'left') return { x: r.left - stageRect.left, y: cy };
    if (side === 'right') return { x: r.right - stageRect.left, y: cy };
    return { x: cx, y: cy };
  }

  // 계층 간 수직 직교 라운드 경로 (레이어 사이 여백 구간에서 90도 라운드 꺾임)
  function orthoVertical(a, b, customMidY) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 4) {
      return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    }
    const midY = customMidY !== undefined ? customMidY : (a.y + b.y) / 2;
    const r = Math.min(10, Math.abs(dx) / 2, Math.abs(midY - a.y), Math.abs(b.y - midY));
    const sx = dx > 0 ? 1 : -1;
    const sy1 = midY >= a.y ? 1 : -1;
    const sy2 = b.y >= midY ? 1 : -1;

    return [
      `M ${a.x} ${a.y}`,
      `L ${a.x} ${midY - r * sy1}`,
      `Q ${a.x} ${midY} ${a.x + r * sx} ${midY}`,
      `L ${b.x - r * sx} ${midY}`,
      `Q ${b.x} ${midY} ${b.x} ${midY + r * sy2}`,
      `L ${b.x} ${b.y}`,
    ].join(' ');
  }

  // 동일 레이어 내부 수평 연결 (데스크톱 좌->우, 모바일 상->하 자동 전환)
  function intraLaneConnect(sr, fromEl, toEl) {
    const r1 = fromEl.getBoundingClientRect();
    const r2 = toEl.getBoundingClientRect();
    if (Math.abs(r1.top - r2.top) < 40 && r1.right < r2.left) {
      const a = anchorPos(sr, fromEl, 'right');
      const b = anchorPos(sr, toEl, 'left');
      return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    }
    return orthoVertical(anchorPos(sr, fromEl, 'bottom'), anchorPos(sr, toEl, 'top'));
  }

  function updateFlowchartGeometry() {
    const stage = el('flowchart-stage');
    if (!stage) return;
    const sr = stage.getBoundingClientRect();
    if (sr.width === 0) return;

    const nFepIn = el('node-fep-in');
    const nAuth = el('node-auth');
    const nHsm = el('node-hsm');
    const nMch = el('node-mch');
    const nJrnl = el('node-jrnl');
    const nHost = el('node-host');
    const nSaf = el('node-saf');
    const nReply = el('node-fep-out');

    const laneFepIn = el('lane-fep-in').getBoundingClientRect();
    const laneSvc = el('lane-service').getBoundingClientRect();
    const laneDb = el('lane-db').getBoundingClientRect();
    const laneOut = el('lane-fep-out').getBoundingClientRect();

    const gap12Y = (laneFepIn.bottom + laneSvc.top) / 2 - sr.top;
    const gap23Y = (laneSvc.bottom + laneDb.top) / 2 - sr.top;
    const gap34Y = (laneDb.bottom + laneOut.top) / 2 - sr.top;

    // 1) Layer 1 ($RECEIVE) -> Layer 2 (AUTH-SVR)
    el('edge-fep-auth').setAttribute(
      'd',
      orthoVertical(anchorPos(sr, nFepIn, 'bottom'), anchorPos(sr, nAuth, 'top'), gap12Y),
    );

    // 2) Layer 2 내부: AUTH-SVR -> HSM-SVR -> MCH-SVR
    el('edge-auth-hsm').setAttribute('d', intraLaneConnect(sr, nAuth, nHsm));
    el('edge-hsm-mch').setAttribute('d', intraLaneConnect(sr, nHsm, nMch));

    // 3) Layer 2 -> Layer 3 (정상 경로: MCH-SVR -> JRNL-DB / 조기 거절 기록: AUTH·HSM -> JRNL-DB)
    el('edge-svc-jrnl').setAttribute(
      'd',
      orthoVertical(anchorPos(sr, nMch, 'bottom'), anchorPos(sr, nJrnl, 'top'), gap23Y),
    );
    el('edge-svc-jrnl-err').setAttribute(
      'd',
      orthoVertical(anchorPos(sr, nHsm, 'bottom'), anchorPos(sr, nJrnl, 'top'), gap23Y),
    );

    // 4) Layer 3 내부: JRNL-DB -> HOST-DB -> SAF-DB
    el('edge-jrnl-host').setAttribute('d', intraLaneConnect(sr, nJrnl, nHost));
    el('edge-host-saf').setAttribute('d', intraLaneConnect(sr, nHost, nSaf));

    // 5) Layer 3 -> Layer 4 ($REPLY)
    el('edge-jrnl-reply').setAttribute(
      'd',
      orthoVertical(anchorPos(sr, nJrnl, 'bottom'), anchorPos(sr, nReply, 'top'), gap34Y),
    );
    el('edge-host-reply').setAttribute(
      'd',
      orthoVertical(anchorPos(sr, nHost, 'bottom'), anchorPos(sr, nReply, 'top'), gap34Y),
    );
    el('edge-saf-reply').setAttribute(
      'd',
      orthoVertical(anchorPos(sr, nSaf, 'bottom'), anchorPos(sr, nReply, 'top'), gap34Y),
    );

    // 6) DB 미경유 직행 응답 (0800 개시 또는 포맷/Luhn 거절): 좌측 여백 코리더 우회 경로
    const authLeft = anchorPos(sr, nAuth, 'left');
    const replyLeft = anchorPos(sr, nReply, 'left');
    const corridorX = Math.max(12, authLeft.x - 14);
    el('edge-early-reply').setAttribute(
      'd',
      [
        `M ${authLeft.x} ${authLeft.y}`,
        `L ${corridorX} ${authLeft.y}`,
        `L ${corridorX} ${replyLeft.y}`,
        `L ${replyLeft.x} ${replyLeft.y}`,
      ].join(' '),
    );
  }

  /* ================================================================
   * 계층별 상태 칩 · 노드 · SQL 태그 · 엣지 실시간 업데이트
   * ================================================================ */
  const ALL_NODES = ['fep-in', 'auth', 'hsm', 'mch', 'jrnl', 'host', 'saf', 'fep-out'];
  const ALL_EDGES = [
    'edge-fep-auth',
    'edge-auth-hsm',
    'edge-hsm-mch',
    'edge-svc-jrnl',
    'edge-svc-jrnl-err',
    'edge-jrnl-host',
    'edge-host-saf',
    'edge-jrnl-reply',
    'edge-host-reply',
    'edge-saf-reply',
    'edge-early-reply',
  ];

  const KOR_BADGE = {
    PASS: '통과',
    REJECT: '차단',
    ALERT: '지연·복구',
    SKIP: '생략',
  };

  function setNodeVisual(key, state, badgeText, detailText) {
    const node = el(`node-${key}`);
    const badge = el(`badge-${key}`);
    const detail = el(`detail-${key}`);
    if (!node) return;
    node.classList.remove('st-idle', 'st-pass', 'st-reject', 'st-alert', 'st-dim');
    node.classList.add(`st-${state}`);
    if (badge && badgeText) badge.textContent = badgeText;
    if (detail && detailText) detail.textContent = detailText;
  }

  function setEdgeVisual(edgeId, cls) {
    const path = el(edgeId);
    if (!path) return;
    path.classList.remove('edge-pass', 'edge-reject', 'edge-alert', 'edge-dim');
    if (cls) path.classList.add(cls);
  }

  function setLaneChip(id, text, cls) {
    const chip = el(id);
    if (!chip) return;
    chip.className = `lane-live-chip ${cls || ''}`;
    chip.textContent = text;
  }

  function renderFlowchartState(data, scenarioLabel) {
    ALL_NODES.forEach((k) => setNodeVisual(k, 'dim', '미호출', '이전 계층에서 처리 종료'));
    ALL_EDGES.forEach((e) => setEdgeVisual(e, 'edge-dim'));

    const req = data.request || {};
    const resp = data.response || {};
    const trace = data.trace || [];
    const amtNum = Number.parseInt(req.amount || '0', 10) || 0;

    // [LAYER 1: FEP 전문 수신부]
    setNodeVisual(
      'fep-in',
      'pass',
      `MTI ${req.mti || 'RAW'}`,
      `112B 파싱 완료 · ${data.maskedPan || '개시전문'} · ${
        amtNum > 0 ? amtNum.toLocaleString('ko-KR') + '원' : '점검'
      }`,
    );
    setLaneChip('lane-status-fep-in', '112B 수신·파싱 완료', 'lc-pass');
    setEdgeVisual('edge-fep-auth', 'edge-pass');

    // 트레이스에서 각 서비스 최종 상태 수집
    const svcMap = {};
    trace.forEach((t) => {
      const prev = svcMap[t.service];
      if (!prev || prev.status === 'PASS' || prev.status === 'SKIP') {
        svcMap[t.service] = t;
      } else if (t.status === 'REJECT' || t.status === 'ALERT') {
        svcMap[t.service] = t;
      }
    });

    const mapStatus = (st) => {
      if (st === 'REJECT') return 'reject';
      if (st === 'ALERT') return 'alert';
      return 'pass';
    };

    // [LAYER 2: 서비스 처리부]
    let svcRejected = false;
    if (svcMap['AUTH-SVR']) {
      const s = svcMap['AUTH-SVR'];
      if (s.status === 'REJECT') svcRejected = true;
      setNodeVisual('auth', mapStatus(s.status), KOR_BADGE[s.status] || s.status, `${s.action} · ${s.detail}`);
    }

    if (svcMap['HSM-SVR']) {
      const s = svcMap['HSM-SVR'];
      if (s.status === 'REJECT') svcRejected = true;
      setNodeVisual('hsm', mapStatus(s.status), KOR_BADGE[s.status] || s.status, `${s.action} · ${s.detail}`);
      setEdgeVisual('edge-auth-hsm', s.status === 'REJECT' ? 'edge-reject' : 'edge-pass');
    }

    if (svcMap['MCH-SVR']) {
      const s = svcMap['MCH-SVR'];
      if (s.status === 'REJECT') svcRejected = true;
      setNodeVisual('mch', mapStatus(s.status), KOR_BADGE[s.status] || s.status, s.detail);
      setEdgeVisual('edge-hsm-mch', s.status === 'REJECT' ? 'edge-reject' : 'edge-pass');
    }

    setLaneChip(
      'lane-status-service',
      svcRejected ? '서비스 검증 차단' : '서비스 검증 통과',
      svcRejected ? 'lc-reject' : 'lc-pass',
    );

    // [LAYER 3: DB / 원장 처리부]
    const visitedJrnl = Boolean(svcMap['JRNL-SVR']);
    const visitedHost = Boolean(svcMap['HOST-SVR']);
    const visitedSaf = Boolean(svcMap['SAF-SVR']);

    if (!visitedJrnl && !visitedHost) {
      // 0800 개시 전문 또는 포맷/Luhn 오류: DB 계층 생략 후 Layer 4 직행
      setLaneChip('lane-status-db', 'DB 계층 생략 (Bypass)', '');
      el('sql-jrnl').textContent = 'SKIP';
      el('sql-host').textContent = 'SKIP';
      el('sql-saf').textContent = 'STANDBY';
      setEdgeVisual('edge-early-reply', resp.respCode === '00' ? 'edge-pass' : 'edge-reject');
    } else {
      if (visitedJrnl) {
        const s = svcMap['JRNL-SVR'];
        setNodeVisual('jrnl', mapStatus(s.status), KOR_BADGE[s.status] || s.status, s.detail);
        el('sql-jrnl').textContent = s.status === 'REJECT' ? 'SELECT (DUP!)' : 'SELECT + INSERT';

        if (svcMap['MCH-SVR'] && !svcRejected) {
          setEdgeVisual('edge-svc-jrnl', s.status === 'REJECT' ? 'edge-reject' : 'edge-pass');
        } else {
          setEdgeVisual('edge-svc-jrnl-err', 'edge-reject');
        }
      }

      if (visitedHost) {
        const s = svcMap['HOST-SVR'];
        setNodeVisual('host', mapStatus(s.status), KOR_BADGE[s.status] || s.status, s.detail);
        el('sql-host').textContent =
          resp.respCode === '00'
            ? req.mti === '0400'
              ? 'UPDATE (+한도복원)'
              : 'UPDATE (-한도차감)'
            : resp.respCode === '91'
              ? 'TIMEOUT!'
              : 'SELECT (거절)';

        setEdgeVisual('edge-jrnl-host', 'edge-pass');

        if (visitedSaf) {
          const safStep = svcMap['SAF-SVR'];
          setNodeVisual('saf', 'alert', 'INSERT 완료', safStep.detail);
          el('sql-saf').textContent = 'INSERT 0420';
          setEdgeVisual('edge-host-saf', 'edge-alert');
          setEdgeVisual('edge-saf-reply', 'edge-alert');
          setLaneChip('lane-status-db', '타임아웃 · SAF 큐 적재', 'lc-alert');
        } else {
          setNodeVisual('saf', 'dim', '대기', '타임아웃 미발생');
          el('sql-saf').textContent = 'STANDBY';
          setEdgeVisual(
            'edge-host-reply',
            resp.respCode === '00' ? 'edge-pass' : 'edge-reject',
          );
          setLaneChip(
            'lane-status-db',
            resp.respCode === '00' ? 'DB 원장 커밋 완료' : `원장 심사 거절 (RC=${resp.respCode})`,
            resp.respCode === '00' ? 'lc-pass' : 'lc-reject',
          );
        }
      } else {
        // JRNL-DB 중복 차단(94) 또는 서비스 거절 이력만 JRNL-DB에 INSERT한 경우
        el('sql-host').textContent = 'SKIP';
        el('sql-saf').textContent = 'STANDBY';
        setEdgeVisual('edge-jrnl-reply', 'edge-reject');
        setLaneChip('lane-status-db', '저널 기록 후 조기 반환', 'lc-reject');
      }
    }

    // [LAYER 4: FEP 전문 송신부]
    const outState =
      resp.respCode === '00' ? 'pass' : resp.respCode === '91' ? 'alert' : 'reject';
    setNodeVisual(
      'fep-out',
      outState,
      `RC ${resp.respCode || '--'}`,
      `145B 송신 완료 · MTI ${resp.mti || '-'} · ${resp.respMsg || '-'} ${
        resp.authCode ? '(' + resp.authCode + ')' : ''
      }`,
    );
    setLaneChip(
      'lane-status-fep-out',
      `145B 송신 (RC=${resp.respCode || '--'})`,
      outState === 'pass' ? 'lc-pass' : outState === 'alert' ? 'lc-alert' : 'lc-reject',
    );

    // 상단 타이틀바 상태 배지
    const pill = el('tx-live-pill');
    pill.className = `tx-live-pill ${
      resp.respCode === '00' ? 'pill-ok' : resp.respCode === '91' ? 'pill-warn' : 'pill-err'
    }`;
    el('banner-rc').textContent = `RC ${resp.respCode || '--'}`;
    el('banner-summary').textContent = `${scenarioLabel} · ${resp.respMsg || '-'}`;

    // 계층 태그를 포함한 단계별 호출 체인
    const layerTagOf = (svc) => {
      if (svc === 'JRNL-SVR' || svc === 'HOST-SVR' || svc === 'SAF-SVR') return 'DB';
      return 'SVC';
    };
    el('step-chain').innerHTML = trace
      .map(
        (step, idx) => `
        <div class="chain-step cs-${step.status}" title="${step.detail}">
          <strong>[${layerTagOf(step.service)}] ${step.service}</strong>
          <span>${step.action}</span>
        </div>
        ${idx < trace.length - 1 ? '<span class="chain-arrow">›</span>' : ''}
      `,
      )
      .join('');

    // 145B 패킷 세그먼트 블록
    el('pkt-mti').textContent = resp.mti || '-';
    el('pkt-bm').textContent = (data.wire && data.wire.bitmapHex) || '-';
    el('pkt-pan').textContent = data.maskedPan || '-';
    el('pkt-rc').textContent = resp.respCode || '-';
    el('pkt-auth').textContent = resp.authCode || '-';
    el('pkt-stan').textContent = resp.stan || '-';
    el('pkt-rrn').textContent = resp.rrn || '-';
    el('pkt-msg').textContent = resp.respMsg || '-';
    el('pkt-mac').textContent = resp.mac || '-';
  }

  /* ================================================================
   * 하단 원장 게이지 & 실시간 저널 피드 렌더링
   * ================================================================ */
  function renderVisualBoards(state) {
    if (!state) return;

    el('kpi-journal').textContent = `${state.journalCount}건`;
    el('kpi-saf').textContent = `${state.safPendingCount}건`;

    el('ledger-count').textContent = `${state.ledger.length}개 카드`;
    const ledgerWrap = el('ledger-cards');
    if (state.ledger.length === 0) {
      ledgerWrap.innerHTML =
        '<div class="empty-flow-card">승인 거래가 실행되면 카드 한도 원장이 표시됩니다.</div>';
    } else {
      ledgerWrap.innerHTML = state.ledger
        .map((c) => {
          const pct = Math.min(100, Math.round((c.usedAmount / c.limitAmount) * 100));
          return `
            <div class="gauge-card">
              <div class="gauge-top">
                <span class="gauge-pan">💳 ${c.maskedPan}</span>
                <span class="gauge-pct">${pct}% 사용</span>
              </div>
              <div class="gauge-track">
                <div class="gauge-fill ${pct >= 75 ? 'high' : ''}" style="width: ${pct}%"></div>
              </div>
              <div class="gauge-meta">
                <span>이용금액 ${c.usedAmount.toLocaleString('ko-KR')}원</span>
                <strong>잔여 ${c.availableBalance.toLocaleString('ko-KR')}원</strong>
              </div>
            </div>
          `;
        })
        .join('');
    }

    el('saf-count').textContent = `${state.safPendingCount}건`;
    const safWrap = el('saf-cards');
    if (state.safQueue.length === 0) {
      safWrap.innerHTML =
        '<div class="empty-flow-card">대기 중인 자동 망취소 레코드가 없습니다.</div>';
    } else {
      safWrap.innerHTML = state.safQueue
        .slice(0, 5)
        .map(
          (s) => `
          <div class="saf-card">
            <div class="saf-flow-tags">
              <span>#${s.seq}</span>
              <span>·</span>
              <span>${s.maskedPan}</span>
              <span>·</span>
              <span>${s.amount.toLocaleString('ko-KR')}원</span>
            </div>
            <span class="flow-rc rc-warn">0420 대기 (${s.hostTxId})</span>
          </div>
        `,
        )
        .join('');
    }

    el('journal-count').textContent = `최근 ${state.journal.length}건 · 총 ${state.journalCount}건`;
    const feedWrap = el('stream-feed');
    if (state.journal.length === 0) {
      feedWrap.innerHTML =
        '<div class="empty-flow-card">실시간 거래 내역이 이곳에 업데이트됩니다.</div>';
    } else {
      feedWrap.innerHTML = state.journal
        .slice(0, 14)
        .map((j) => {
          const isCancel = j.mti === '0400';
          const isOk = j.respCode === '00';
          const isTimeout = j.respCode === '91';

          const avCls = isCancel && isOk ? 'av-cancel' : isOk ? 'av-ok' : isTimeout ? 'av-warn' : 'av-err';
          const avIcon = isCancel && isOk ? '↺' : isOk ? '✓' : isTimeout ? '!' : '✕';
          const rcCls = isOk ? 'rc-ok' : isTimeout ? 'rc-warn' : 'rc-err';

          const titleText = isCancel
            ? `승인 취소 요청 · ${j.maskedPan}`
            : `카드 결제 승인 · ${j.maskedPan}`;

          const amtPrefix = isCancel && isOk ? '+' : '-';
          const amtCls = isCancel && isOk ? 'amt-cancel' : !isOk ? 'amt-err' : '';
          const badgeText = j.isCancelled
            ? '취소환원됨'
            : isOk
              ? `승인 ${j.authCode}`
              : `거절 RC=${j.respCode}`;

          return `
            <div class="tx-flow-card">
              <div class="tx-avatar ${avCls}">${avIcon}</div>
              <div class="tx-info">
                <div class="tx-title">${titleText}</div>
                <div class="tx-sub">#${j.seq} · MTI ${j.mti} · RRN ${j.rrn || '-'}</div>
              </div>
              <div class="tx-right">
                <div class="tx-amount ${amtCls}">${amtPrefix}${j.amount.toLocaleString('ko-KR')}원</div>
                <span class="flow-rc ${rcCls}">${badgeText}</span>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  /* ================================================================
   * 1초 자동 거래 시나리오 생성 및 호출
   * ================================================================ */
  function buildAutoScenario() {
    const ids = nextIds();
    const base = {
      mti: '0100',
      pan: pick(VALID_CARDS),
      expiry: '2912',
      amount: pick(SAMPLE_AMOUNTS),
      stan: ids.stan,
      rrn: ids.rrn,
      terminalId: pick(TERMINALS),
      merchantId: pick(MERCHANTS),
      pinBlock: '1234567890ABCDEF',
      mac: '',
    };

    const r = Math.random();
    if (r < 0.54) {
      return { label: '자동 · 카드 결제 승인', payload: base };
    }
    if (r < 0.68 && activeApprovedPool.length > 0) {
      const orig = activeApprovedPool.shift();
      return {
        label: '자동 · 0400 승인 취소',
        payload: {
          ...base,
          mti: '0400',
          pan: orig.pan,
          amount: orig.amount,
          rrn: orig.rrn,
          pinBlock: '',
        },
      };
    }
    if (r < 0.76) {
      return {
        label: '자동 · 호스트 타임아웃(91)',
        payload: { ...base, pan: '4000000000000093', amount: '000000045000' },
      };
    }
    if (r < 0.82 && activeApprovedPool.length > 0) {
      const dup = activeApprovedPool[activeApprovedPool.length - 1];
      return {
        label: '자동 · 중복 거래 차단(94)',
        payload: {
          ...base,
          pan: dup.pan,
          amount: dup.amount,
          stan: dup.stan,
          rrn: dup.rrn,
        },
      };
    }
    if (r < 0.87) {
      return {
        label: '자동 · 분실/도난 카드(41·43)',
        payload: {
          ...base,
          pan: Math.random() < 0.5 ? '4000000000000002' : '4000000000000028',
        },
      };
    }
    if (r < 0.91) {
      return {
        label: '자동 · 한도 초과(51)',
        payload: { ...base, amount: '000005500000' },
      };
    }
    if (r < 0.95) {
      return {
        label: '자동 · 비밀번호 오류(55)',
        payload: { ...base, pinBlock: 'FFFFFFFFFFFFFFFF' },
      };
    }
    if (r < 0.98) {
      return {
        label: '자동 · 정지 가맹점(03)',
        payload: { ...base, merchantId: 'MCH_STOP009' },
      };
    }
    return {
      label: '자동 · 만료 카드(54)',
      payload: { ...base, expiry: '2305' },
    };
  }

  async function dispatchTransaction(payload, scenarioLabel) {
    if (inFlight) return;
    inFlight = true;

    const t0 = performance.now();
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const rtt = Math.max(1, Math.round(performance.now() - t0));

      totalCount += 1;
      totalLatencyMs += rtt;
      if (data.response && data.response.respCode === '00') {
        okCount += 1;
        if (payload.mti === '0100') {
          activeApprovedPool.push({ ...payload });
          if (activeApprovedPool.length > 25) activeApprovedPool.shift();
        }
      } else {
        errCount += 1;
      }

      const rate = ((okCount / totalCount) * 100).toFixed(1);
      el('kpi-total').textContent = `${totalCount}건`;
      el('kpi-last-scenario').textContent = scenarioLabel;
      el('kpi-rate').textContent = `${rate}%`;
      el('kpi-ok-err').textContent = `승인 ${okCount} · 거절 ${errCount}`;
      el('kpi-latency').textContent = `${rtt} ms`;
      el('kpi-avg-latency').textContent = `평균 ${Math.round(totalLatencyMs / totalCount)} ms`;

      renderFlowchartState(data, scenarioLabel);
      renderVisualBoards(data.state);
      updateFlowchartGeometry();
    } catch (e) {
      console.error('Transaction dispatch error:', e);
    } finally {
      inFlight = false;
    }
  }

  function triggerPreset(name) {
    const ids = nextIds();
    const base = {
      mti: '0100',
      pan: '4000000000000010',
      expiry: '2912',
      amount: '000000100000',
      stan: ids.stan,
      rrn: ids.rrn,
      terminalId: 'T0000001',
      merchantId: 'MCH_TOSS01',
      pinBlock: '1234567890ABCDEF',
      mac: '',
    };

    const map = {
      normal: { label: '수동 · 정상 승인', payload: base },
      duplicate:
        activeApprovedPool.length > 0
          ? {
              label: '수동 · 중복 거래(94)',
              payload: { ...base, ...activeApprovedPool[activeApprovedPool.length - 1] },
            }
          : { label: '수동 · 정상 승인(초기)', payload: base },
      lost: { label: '수동 · 분실 카드(41)', payload: { ...base, pan: '4000000000000002' } },
      stolen: { label: '수동 · 도난 카드(43)', payload: { ...base, pan: '4000000000000028' } },
      limit: { label: '수동 · 한도 초과(51)', payload: { ...base, amount: '000006000000' } },
      expired: { label: '수동 · 만료 카드(54)', payload: { ...base, expiry: '2301' } },
      merchant: {
        label: '수동 · 정지 가맹점(03)',
        payload: { ...base, merchantId: 'MCH_STOP001' },
      },
      badpin: {
        label: '수동 · PIN 오류(55)',
        payload: { ...base, pinBlock: 'FFFFFFFFFFFFFFFF' },
      },
      cancel:
        activeApprovedPool.length > 0
          ? (() => {
              const orig = activeApprovedPool.pop();
              return {
                label: '수동 · 직전 승인 취소(0400)',
                payload: {
                  ...base,
                  mti: '0400',
                  pan: orig.pan,
                  amount: orig.amount,
                  rrn: orig.rrn,
                  pinBlock: '',
                },
              };
            })()
          : { label: '수동 · 취소 원거래 없음(25)', payload: { ...base, mti: '0400', pinBlock: '' } },
      timeout: {
        label: '수동 · 타임아웃+SAF(91)',
        payload: { ...base, pan: '4000000000000093' },
      },
    };

    const chosen = map[name] || map.normal;
    elapsedMs = 0;
    dispatchTransaction(chosen.payload, chosen.label);
  }

  /* ================================================================
   * 초기화 · 테마 전환 · 1초 주기 타이머 루프
   * ================================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    updateFlowchartGeometry();
    window.addEventListener('resize', updateFlowchartGeometry);
    if (window.ResizeObserver) {
      new ResizeObserver(updateFlowchartGeometry).observe(el('flowchart-stage'));
    }

    el('theme-switch').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-val]');
      if (!btn) return;
      document.documentElement.setAttribute('data-theme', btn.dataset.themeVal);
      el('theme-switch')
        .querySelectorAll('.seg-btn')
        .forEach((b) => b.classList.toggle('active', b === btn));
    });

    const first = buildAutoScenario();
    dispatchTransaction(first.payload, first.label);

    setInterval(() => {
      if (!autoRunning) return;
      elapsedMs += 100;
      const pct = Math.min(100, Math.round((elapsedMs / intervalMs) * 100));
      el('tick-progress').style.width = `${pct}%`;

      if (elapsedMs >= intervalMs) {
        elapsedMs = 0;
        const sc = buildAutoScenario();
        dispatchTransaction(sc.payload, sc.label);
      }
    }, 100);

    el('btn-toggle-stream').addEventListener('click', () => {
      autoRunning = !autoRunning;
      const dot = el('live-dot');
      const label = el('stream-state-label');
      const btn = el('btn-toggle-stream');

      if (autoRunning) {
        dot.classList.add('active');
        label.textContent = `실시간 자동 승인 요청 중 · ${(intervalMs / 1000).toFixed(1)}초 주기`;
        btn.textContent = '일시정지';
      } else {
        dot.classList.remove('active');
        label.textContent = '자동 승인 요청 일시정지됨';
        btn.textContent = '자동실행 시작';
      }
    });

    el('sel-interval').addEventListener('change', (e) => {
      intervalMs = Number(e.target.value) || 1000;
      elapsedMs = 0;
      if (autoRunning) {
        el('stream-state-label').textContent = `실시간 자동 승인 요청 중 · ${(
          intervalMs / 1000
        ).toFixed(1)}초 주기`;
      }
    });

    el('btn-echo').addEventListener('click', () => {
      const ids = nextIds();
      elapsedMs = 0;
      dispatchTransaction(
        { mti: '0800', stan: ids.stan, rrn: ids.rrn },
        '수동 · 0800 네트워크 개시',
      );
    });

    el('btn-reset').addEventListener('click', async () => {
      const res = await fetch('/api/state', { method: 'DELETE' });
      const data = await res.json();
      activeApprovedPool.length = 0;
      totalCount = 0;
      okCount = 0;
      errCount = 0;
      totalLatencyMs = 0;
      el('kpi-total').textContent = '0건';
      el('kpi-rate').textContent = '0.0%';
      el('kpi-ok-err').textContent = '승인 0 · 거절 0';
      el('kpi-latency').textContent = '0 ms';
      el('kpi-avg-latency').textContent = '평균 0 ms';
      if (data.state) renderVisualBoards(data.state);
    });

    el('preset-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      triggerPreset(btn.dataset.preset);
    });

    el('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      elapsedMs = 0;
      const payload = {
        mti: el('f-mti').value,
        pan: el('f-pan').value.trim(),
        expiry: el('f-expiry').value.trim(),
        amount: padAmount(el('f-amount').value),
        stan: el('f-stan').value.trim(),
        rrn: el('f-rrn').value.trim(),
        terminalId: el('f-term').value.trim(),
        merchantId: el('f-merch').value.trim(),
        pinBlock: el('f-pin').value.trim(),
        mac: el('f-mac').value.trim(),
      };
      el('f-amount').value = payload.amount;
      dispatchTransaction(payload, '수동 편집 전문 전송');
    });
  });
})();
