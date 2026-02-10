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
  const btnIn = document.getElementById('loginSignInBtn');
  const btnUp = document.getElementById('loginSignUpBtn');
  if (btnIn) btnIn.disabled = isBusy;
  if (btnUp) btnUp.disabled = isBusy;
}

function getCreds() {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  const email = (emailInput ? emailInput.value : '').trim();
  const password = (passInput ? passInput.value : '').trim();
  return { email, password };
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
  if (data && data.session) {
    window.location.href = PANEL_URL;
    return;
  }
  setStatus('注册成功。如开启邮箱验证，请查收邮件完成验证。');
}

async function initLogin() {
  if (!supabaseClient) {
    setStatus('Supabase client not available.');
    return;
  }

  const savedEmail = localStorage.getItem(EMAIL_KEY);
  if (savedEmail) {
    const input = document.getElementById('loginEmail');
    if (input) input.value = savedEmail;
  }

  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session) {
    window.location.href = PANEL_URL;
    return;
  }

  const btnIn = document.getElementById('loginSignInBtn');
  const btnUp = document.getElementById('loginSignUpBtn');
  if (btnIn) btnIn.addEventListener('click', signIn);
  if (btnUp) btnUp.addEventListener('click', signUp);

  const passInput = document.getElementById('loginPassword');
  if (passInput) {
    passInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') signIn();
    });
  }
}

document.addEventListener('DOMContentLoaded', initLogin);
