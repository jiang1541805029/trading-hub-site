const SUPABASE_URL = 'https://wqqpyozrvstrzarzjsru.supabase.co';
const SUPABASE_KEY = 'sb_publishable__5kVr0Gmnw3tVVv4e0Noyg_RRBexQ6c';
const EMAIL_KEY = 'tradingJournal_email';
const PANEL_URL = 'panel.html';

const supabaseClient = (typeof supabase !== 'undefined')
  ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

function setStatus(msg) {
  const el = document.getElementById('loginStatus');
  if (el) el.innerText = msg || '';
}

function setBusy(isBusy) {
  const ids = ['loginSignInBtn', 'loginSignUpBtn', 'loginForgotBtn', 'resetSubmitBtn', 'resetBackBtn'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = isBusy;
  });
}

function getCreds() {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  const email = (emailInput ? emailInput.value : '').trim();
  const password = (passInput ? passInput.value : '').trim();
  return { email, password };
}

function showResetForm(show) {
  const loginForm = document.getElementById('loginForm');
  const resetForm = document.getElementById('resetForm');
  if (!loginForm || !resetForm) return;
  if (show) {
    loginForm.classList.add('hidden');
    resetForm.classList.remove('hidden');
  } else {
    resetForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  }
  setStatus('');
}

async function requestPasswordReset() {
  if (!supabaseClient) {
    setStatus('Supabase client not available.');
    return;
  }
  const { email } = getCreds();
  if (!email) {
    setStatus('请输入邮箱。');
    return;
  }
  localStorage.setItem(EMAIL_KEY, email);
  if (location.protocol === 'file:') {
    setStatus('重置密码需要 http(s) 环境，请用本地服务器打开。');
    return;
  }
  setBusy(true);
  setStatus('发送重置邮件中...');
  const redirectTo = new URL('index.html', window.location.href).href;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  setBusy(false);
  if (error) {
    setStatus('发送失败：' + error.message);
    return;
  }
  setStatus('已发送重置邮件，请查收邮箱。');
}

async function updatePassword() {
  if (!supabaseClient) {
    setStatus('Supabase client not available.');
    return;
  }
  const p1 = (document.getElementById('resetPassword') || {}).value || '';
  const p2 = (document.getElementById('resetPasswordConfirm') || {}).value || '';
  const password = p1.trim();
  const confirm = p2.trim();
  if (!password || !confirm) {
    setStatus('请输入新密码并确认。');
    return;
  }
  if (password.length < 6) {
    setStatus('密码至少 6 位。');
    return;
  }
  if (password !== confirm) {
    setStatus('两次密码不一致。');
    return;
  }
  setBusy(true);
  setStatus('更新密码中...');
  const { error } = await supabaseClient.auth.updateUser({ password });
  setBusy(false);
  if (error) {
    setStatus('更新失败：' + error.message);
    return;
  }
  setStatus('密码已更新，请重新登录。');
  history.replaceState(null, '', window.location.pathname);
  await supabaseClient.auth.signOut();
  showResetForm(false);
}

async function signIn() {
  if (!supabaseClient) {
    setStatus('Supabase client not available.');
    return;
  }
  const { email, password } = getCreds();
  if (!email || !password) {
    setStatus('请输入邮箱和密码。');
    return;
  }
  localStorage.setItem(EMAIL_KEY, email);
  setBusy(true);
  setStatus('登录中...');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  setBusy(false);
  if (error) {
    setStatus('登录失败：' + error.message);
    return;
  }
  if (data && data.session) {
    window.location.href = PANEL_URL;
    return;
  }
  setStatus('登录成功。');
}

async function signUp() {
  if (!supabaseClient) {
    setStatus('Supabase client not available.');
    return;
  }
  const { email, password } = getCreds();
  if (!email || !password) {
    setStatus('请输入邮箱和密码。');
    return;
  }
  localStorage.setItem(EMAIL_KEY, email);
  setBusy(true);
  setStatus('注册中...');
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  setBusy(false);
  if (error) {
    setStatus('注册失败：' + error.message);
    return;
  }
  // Always require manual login after sign-up
  if (data && data.session) {
    await supabaseClient.auth.signOut();
  }
  setStatus('注册成功，请使用账号密码登录。若开启邮箱验证，请先完成邮箱验证。');
}

async function initLogin() {
  if (!supabaseClient) {
    setStatus('Supabase client not available.');
    return;
  }

  const btnIn = document.getElementById('loginSignInBtn');
  const btnUp = document.getElementById('loginSignUpBtn');
  const btnForgot = document.getElementById('loginForgotBtn');
  const btnReset = document.getElementById('resetSubmitBtn');
  const btnBack = document.getElementById('resetBackBtn');
  if (btnIn) btnIn.addEventListener('click', signIn);
  if (btnUp) btnUp.addEventListener('click', signUp);
  if (btnForgot) btnForgot.addEventListener('click', requestPasswordReset);
  if (btnReset) btnReset.addEventListener('click', updatePassword);
  if (btnBack) btnBack.addEventListener('click', () => showResetForm(false));

  const savedEmail = localStorage.getItem(EMAIL_KEY);
  if (savedEmail) {
    const input = document.getElementById('loginEmail');
    if (input) input.value = savedEmail;
  }

  const isRecovery = window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery');
  if (isRecovery) {
    showResetForm(true);
    setStatus('请设置新密码。');
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session) {
    window.location.href = PANEL_URL;
    return;
  }

  const passInput = document.getElementById('loginPassword');
  if (passInput) {
    passInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') signIn();
    });
  }
}

document.addEventListener('DOMContentLoaded', initLogin);
