// Points ("نقاط التشغيل") page — balance, dollar value, and withdrawal requests.
// All figures come from Firebase RTDB via the authenticated client session.
(function () {
  const S = window.Store;
  const { el, ico, t, toast, formatNum } = S;
  const root = document.getElementById('root');

  S.bottomNav('points');

  let _rendering = false;

  S.ready((user) => {
    render(user);
  });

  function render(user = (S.getUser ? S.getUser() : null)) {
    if (_rendering) return;
    _rendering = true;

    root.innerHTML = '';
    root.append(S.topbarNav(t('نقاط التشغيل')));

    const page = el('div', { class: 'points-page' });
    root.append(page);

    if (!user) {
      _rendering = false;
      renderAuthRequired(page);
      return;
    }

    // Loading skeleton
    const loading = el('div', { class: 'points-loading' }, S.spinner ? S.spinner() : el('div', { class: 'spinner' }));
    page.append(loading);

    S.pointsBalance().then((data) => {
      _rendering = false;
      loading.remove();
      renderContent(page, data);
    }).catch((e) => {
      _rendering = false;
      loading.remove();
      if (e && (e.status === 401 || e.message === 'unauthorized')) {
        renderAuthRequired(page);
        return;
      }
      page.append(
        el('div', { class: 'points-error' },
          el('p', null, t('تعذّر تحميل النقاط، حاول مجدداً')),
          el('button', { class: 'btn btn-secondary', onclick: () => render() }, t('إعادة المحاولة')),
        ),
      );
    });
  }

  function renderAuthRequired(page) {
    page.innerHTML = '';
    page.append(
      el('div', { class: 'auth-required-card' },
        el('div', { class: 'auth-required-header' },
          el('img', { src: '/images/logo.png', alt: 'Golden Store', class: 'auth-logo' }),
            el('h2', { class: 'auth-title' }, t('\u0633\u062c\u0651\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0644\u0639\u0631\u0636 \u0646\u0642\u0627\u0637\u0643')),
            el('p', { class: 'auth-desc' }, t('\u0646\u0642\u0627\u0637\u0643 \u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u062d\u0633\u0627\u0628 Google. \u0633\u062c\u0651\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0644\u0639\u0631\u0636 \u0631\u0635\u064a\u062f\u0643 \u0648\u0637\u0644\u0628 \u0627\u0644\u0633\u062d\u0628.')),
        ),
        el('button', {
          class: 'gbtn auth-google-btn',
          type: 'button',
          html: '<svg class="gico" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span class="gbtn-label">' + t('متابعة باستخدام Google') + '</span>',
          onclick: async () => {
            try {
              if (window.GAuth && typeof window.GAuth.signInWithGoogle === 'function') {
                const res = window.GAuth.signInWithGoogle();
                if (res && typeof res.then === 'function') {
                  await res;
                }
              } else {
                location.href = '/login';
                return;
              }
              render();
            } catch {
              location.href = '/login';
            }
          },
        }),
      ),
    );
  }

  function renderContent(page, data) {
    const cfg = data.config || { points_per_download: 10, points_per_dollar: 1000, min_withdraw_usd: 5, min_withdraw_points: 5000 };
    const balance = data.balance || 0;
    const dollars = data.dollars != null ? data.dollars : (balance / cfg.points_per_dollar);
    const minPoints = cfg.min_withdraw_points;
    const canWithdraw = balance >= minPoints;

    // --- Hero card: icon + points + dollar preview ---
    const progressPct = Math.min(100, (balance / minPoints) * 100);
    const hero = el('div', { class: 'points-hero' },
      el('img', { src: '/images/points.png', alt: '', class: 'points-hero-icon' }),
      el('div', { class: 'points-balance' }, formatNum(balance)),
      el('div', { class: 'points-balance-label' }, t('نقطة')),
      el('div', { class: 'points-dollar' },
        el('span', { class: 'points-dollar-val' }, '$' + dollars.toFixed(2)),
        el('span', { class: 'points-dollar-label' }, t('قيمتها بالدولار')),
      ),
    );
    page.append(hero);

    // --- Withdrawal progress toward minimum ---
    const progress = el('div', { class: 'points-progress-card' },
      el('div', { class: 'points-progress-top' },
        el('span', null, t('الحد الأدنى للسحب')),
        el('span', { class: 'points-progress-goal' }, '$' + cfg.min_withdraw_usd),
      ),
      el('div', { class: 'points-progress-bar' }, el('div', { class: 'points-progress-fill', style: { width: progressPct + '%' } })),
      el('div', { class: 'points-progress-hint' },
        canWithdraw
          ? t('يمكنك طلب السحب الآن')
          : `${formatNum(balance)} / ${formatNum(minPoints)} ${t('نقطة')}`,
      ),
    );
    page.append(progress);

    // --- Withdraw button ---
    const withdrawBtn = el('button', {
      class: 'btn btn-primary btn-lg btn-block points-withdraw-btn',
      type: 'button',
      disabled: !canWithdraw,
      onclick: () => openWithdraw(data, cfg),
    }, ico('coin', 'icon icon-sm'), t('طلب السحب'));
    page.append(withdrawBtn);
    if (!canWithdraw) {
      page.append(el('p', { class: 'points-withdraw-note' },
        `${t('تحتاج إلى')} ${formatNum(minPoints)} ${t('نقطة')} ($${cfg.min_withdraw_usd}) ${t('على الأقل لطلب السحب')}`));
    }

    // --- Stats row ---
    page.append(
      el('div', { class: 'points-stats' },
        statBox(formatNum(data.total_earned || 0), t('إجمالي النقاط المكتسبة')),
        statBox('$' + (data.total_withdrawn_usd || 0), t('إجمالي المسحوب')),
        statBox('+' + cfg.points_per_download, t('نقطة لكل تثبيت')),
      ),
    );

    const referralWrap = el('div', { class: 'points-invite' });
    page.append(referralWrap);
    loadReferralSection(referralWrap, data);

    // --- How it works ---
    page.append(
      el('div', { class: 'points-how' },
        el('div', { class: 'points-how-title' }, ico('info', 'icon icon-sm'), t('كيف تعمل النقاط؟')),
        el('ul', { class: 'points-how-list' },
          el('li', null, `${t('كل تثبيت لتطبيق جديد يمنحك')} ${cfg.points_per_download} ${t('نقاط')}`),
          el('li', null, `${formatNum(cfg.points_per_dollar)} ${t('نقطة')} = $1`),
          el('li', null, `${t('الحد الأدنى للسحب هو')} $${cfg.min_withdraw_usd}`),
          el('li', null, t('تُحتسب النقاط مرة واحدة فقط لكل تطبيق')),
        ),
      ),
    );

    // --- Withdrawal history ---
    const history = data.withdrawals || [];
    if (history.length) {
      const list = el('div', { class: 'points-history' },
        el('div', { class: 'points-history-title' }, t('طلبات السحب')),
      );
      history.forEach((w) => {
        const statusLabel = w.status === 'approved' ? t('تمت') : w.status === 'rejected' ? t('مرفوض') : t('قيد المراجعة');
        list.append(
          el('div', { class: 'points-history-row' },
            el('div', { class: 'points-history-info' },
              el('div', { class: 'points-history-amount' }, '$' + (w.amount_usd || 0)),
              el('div', { class: 'points-history-meta' }, `${w.method || ''} • ${w.account || ''}`),
            ),
            el('span', { class: `points-status points-status-${w.status || 'pending'}` }, statusLabel),
          ),
        );
      });
      page.append(list);
    }
  }

  function statBox(value, label) {
    return el('div', { class: 'points-stat' },
      el('div', { class: 'points-stat-val' }, value),
      el('div', { class: 'points-stat-label' }, label),
    );
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('copy_failed');
    return true;
  }

  function referralToastError(code) {
    if (code === 'invalid_code') return t('رمز غير صالح');
    if (code === 'self_referral') return t('لا يمكنك استخدام رمزك الخاص');
    if (code === 'already_referred') return t('لقد استخدمت رمز دعوة من قبل');
    return t('تعذر تفعيل الرمز');
  }

  function renderReferralSection(container, data, referral) {
    const cfg = data.config || {};
    const code = referral.code || '';
    const inviteUrl = referral.invite_url || (location.origin + '/points?ref=' + code);
    const referredBy = referral.referred_by || '';
    const title = el('div', { class: 'points-invite-title' }, t('ادعُ صديقاً واربح نقاطاً'));
    const desc = el('div', { class: 'points-invite-desc' },
      `${t('يحصل صديقك على')} ${cfg.referral_invitee || 5} ${t('نقاط')}, ${t('وتحصل أنت على')} ${cfg.referral_inviter || 10} ${t('نقاط عند تفعيله لرمزك.')}`,
    );
    const codePill = el('div', { class: 'points-code-pill' }, code);
    const copyBtn = el('button', { class: 'btn btn-secondary points-invite-btn', type: 'button' }, t('نسخ'));
    const shareBtn = el('button', { class: 'btn btn-secondary points-invite-btn', type: 'button' }, t('مشاركة'));
    copyBtn.onclick = async () => {
      try {
        await copyText(code);
        toast(t('تم نسخ الرمز'), 'success');
      } catch {
        toast(t('تعذر النسخ'), 'error');
      }
    };
    shareBtn.onclick = async () => {
      try {
        if (navigator.share) {
          await navigator.share({ title: document.title, text: code, url: inviteUrl });
          toast(t('تمت المشاركة'), 'success');
        } else {
          await copyText(inviteUrl);
          toast(t('تم نسخ الرابط'), 'success');
        }
      } catch {}
    };

    const statsLine = el('div', { class: 'points-invite-stats' },
      `${t('دعوت')} ${formatNum(referral.referral_count || 0)} ${t('صديقاً')} • ${t('ربحت')} ${formatNum(referral.referral_points || 0)} ${t('نقطة')}`,
    );

    const redeemWrap = el('div', { class: 'points-invite-redeem' });
    const pending = S.getPendingReferral ? S.getPendingReferral() : '';
    let input = null;
    let button = null;

    async function submitReferral(auto = false) {
      const value = (input.value || '').trim();
      if (!value) {
        if (!auto) toast(t('أدخل رمز صديقك'), 'error');
        return;
      }
      button.disabled = true;
      input.disabled = true;
      try {
        await S.applyReferral(value);
        if (S.clearPendingReferral) S.clearPendingReferral();
        toast('+' + (cfg.referral_invitee || 5) + ' ' + t('نقطة في حسابك'), 'success');
        render();
      } catch (e) {
        button.disabled = false;
        input.disabled = false;
        const err = e && e.data && e.data.error;
        if (auto && (err === 'invalid_code' || err === 'self_referral' || err === 'already_referred')) {
          if (S.clearPendingReferral) S.clearPendingReferral();
        }
        if (!auto) toast(referralToastError(err), 'error');
      }
    }

    if (referredBy) {
      if (S.clearPendingReferral) S.clearPendingReferral();
      redeemWrap.append(el('div', { class: 'points-invite-done' }, t('لقد فعّلت رمز دعوة ✓')));
    } else {
      input = el('input', { class: 'points-input points-invite-input', type: 'text', placeholder: t('أدخل رمز صديقك'), value: pending || '' });
      button = el('button', { class: 'btn btn-primary points-invite-apply', type: 'button' }, t('تفعيل'));
      redeemWrap.append(
        el('div', { class: 'points-invite-redeem-row' },
          input,
          button,
        ),
      );
      button.onclick = () => submitReferral(false);
      if (pending) {
        queueMicrotask(() => submitReferral(true));
      }
    }

    container.innerHTML = '';
    container.append(
      el('div', { class: 'points-invite-head' }, title, desc),
      el('div', { class: 'points-invite-code-row' }, codePill, el('div', { class: 'points-invite-actions' }, copyBtn, shareBtn)),
      statsLine,
      redeemWrap,
    );
  }

  async function loadReferralSection(container, data) {
    try {
      const referral = await S.getReferral();
      renderReferralSection(container, data, referral);
    } catch (e) {
      container.innerHTML = '';
      const retryBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, t('إعادة المحاولة'));
      retryBtn.onclick = () => loadReferralSection(container, data);
      container.append(
        el('div', { class: 'points-invite-head' },
          el('div', { class: 'points-invite-title' }, t('ادعُ صديقاً واربح نقاطاً')),
          el('div', { class: 'points-invite-desc' }, t('تعذّر تحميل بيانات الدعوة')),
        ),
        retryBtn,
      );
    }
  }

  // --- Withdrawal request modal ---
  function openWithdraw(data, cfg) {
    const maxUsd = Math.floor((data.balance || 0) / cfg.points_per_dollar);

    const methodSel = el('select', { class: 'points-input' },
      el('option', { value: 'baridimob' }, 'BaridiMob (CCP)'),
      el('option', { value: 'paypal' }, 'PayPal'),
      el('option', { value: 'usdt' }, 'USDT (TRC20)'),
      el('option', { value: 'flexy' }, t('رصيد هاتف (Flexy)')),
    );
    const accountInput = el('input', { type: 'text', class: 'points-input', placeholder: t('رقم الحساب / البريد / المحفظة') });
    const amountInput = el('input', { type: 'number', class: 'points-input', min: cfg.min_withdraw_usd, max: maxUsd, step: '1', value: String(maxUsd) });

    const overlay = el('div', { class: 'dialog-overlay' });
    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const submitBtn = el('button', { class: 'btn btn-primary', type: 'button' }, t('إرسال الطلب'));
    submitBtn.onclick = async () => {
      const method = methodSel.value;
      const account = (accountInput.value || '').trim();
      const amountUsd = Math.floor(Number(amountInput.value));
      if (account.length < 3) { toast(t('أدخل بيانات الحساب الصحيحة'), 'error'); return; }
      if (!Number.isFinite(amountUsd) || amountUsd < cfg.min_withdraw_usd) { toast(`${t('الحد الأدنى للسحب هو')} $${cfg.min_withdraw_usd}`, 'error'); return; }
      if (amountUsd > maxUsd) { toast(t('المبلغ أكبر من رصيدك'), 'error'); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = t('جارٍ الإرسال…');
      try {
        await S.pointsWithdraw({ method, account, amount_usd: amountUsd });
        close();
        toast(t('تم إرسال طلب السحب، ستتم مراجعته قريباً'), 'success');
        render();
      } catch (e) {
        submitBtn.disabled = false;
        submitBtn.textContent = t('إرسال الطلب');
        const err = e && e.data && e.data.error;
        if (err === 'insufficient_points' || err === 'below_minimum') toast(t('رصيدك غير كافٍ للسحب'), 'error');
        else if (err === 'rate_limit_exceeded') toast(t('محاولات كثيرة، انتظر قليلاً'), 'error');
        else toast(t('تعذّر إرسال الطلب، حاول مجدداً'), 'error');
      }
    };

    const card = el('div', { class: 'dialog-card', dir: 'rtl' },
      el('div', { class: 'dialog-head' },
        el('div', { class: 'dialog-title' }, ico('coin', 'icon'), t('طلب سحب الأرباح')),
        el('button', { class: 'dialog-close', 'aria-label': t('إغلاق'), onclick: close }, ico('close')),
      ),
      el('div', { class: 'dialog-body points-withdraw-form' },
        el('label', { class: 'points-label' }, t('طريقة السحب')),
        methodSel,
        el('label', { class: 'points-label' }, t('بيانات الحساب')),
        accountInput,
        el('label', { class: 'points-label' }, `${t('المبلغ بالدولار')} (${t('متاح')}: $${maxUsd})`),
        amountInput,
      ),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn btn-secondary', type: 'button', onclick: close }, t('إلغاء')),
        submitBtn,
      ),
    );
    overlay.append(card);
    document.body.append(overlay);
  }
})();
