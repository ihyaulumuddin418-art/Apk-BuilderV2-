// ============================================================
//  APK Builder — app.js
// ============================================================

// In-memory state (NOT localStorage for security)
const state = {
  ghUsername: '',
  ghToken: '',
  ghRepo: '',
  ghVisibility: 'public',
  connected: false,
  iconBase64: null,
  iconName: null,
  uploadedFiles: [],
  history: JSON.parse(localStorage.getItem('apk_history') || '[]'),
};

// ---- INIT ----
window.addEventListener('DOMContentLoaded', () => {
  renderHistory();
  // Restore non-sensitive settings
  document.getElementById('ghUsername').value = localStorage.getItem('gh_username') || '';
  document.getElementById('ghRepo').value = localStorage.getItem('gh_repo') || '';
});

// ---- GITHUB ----
async function connectGitHub() {
  const username = document.getElementById('ghUsername').value.trim();
  const token = document.getElementById('ghToken').value.trim();
  const repo = document.getElementById('ghRepo').value.trim();
  const visibility = document.getElementById('ghVisibility').value;

  if (!username) return showToast('⚠️ Masukkan GitHub Username!', 'error');
  if (!token) return showToast('⚠️ Masukkan Personal Access Token!', 'error');
  if (!repo) return showToast('⚠️ Masukkan Repository Name!', 'error');

  showToast('🔄 Menghubungkan ke GitHub...', 'info');

  try {
    const res = await fetch(`https://api.github.com/repos/${username}/${encodeURIComponent(repo)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      }
    });

    if (res.status === 200 || res.status === 301) {
      // Repo exists
      state.ghUsername = username;
      state.ghToken = token;
      state.ghRepo = repo;
      state.ghVisibility = visibility;
      state.connected = true;

      localStorage.setItem('gh_username', username);
      localStorage.setItem('gh_repo', repo);

      setTokenStatus(true);
      showToast('✅ Terhubung ke GitHub!', 'success');
    } else if (res.status === 404) {
      // Repo not found, try to create
      showToast('📁 Repo tidak ditemukan, membuat repo baru...', 'info');
      await createRepo(username, token, repo, visibility);
    } else {
      const err = await res.json();
      showToast('❌ ' + (err.message || 'Token tidak valid!'), 'error');
    }
  } catch (e) {
    showToast('❌ Network error: ' + e.message, 'error');
  }
}

async function createRepo(username, token, repo, visibility) {
  try {
    const res = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: repo,
        private: visibility === 'private',
        auto_init: true,
      })
    });

    if (res.status === 201) {
      state.ghUsername = username;
      state.ghToken = token;
      state.ghRepo = repo;
      state.ghVisibility = visibility;
      state.connected = true;

      localStorage.setItem('gh_username', username);
      localStorage.setItem('gh_repo', repo);

      setTokenStatus(true);
      showToast('✅ Repo dibuat & terhubung!', 'success');

      // Wait a bit then ensure workflow exists
      setTimeout(() => ensureWorkflow(), 3000);
    } else {
      const err = await res.json();
      showToast('❌ Gagal buat repo: ' + (err.message || ''), 'error');
    }
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
  }
}

async function ensureWorkflow() {
  // Check if workflow exists, if not upload it
  const { ghUsername: u, ghToken: t, ghRepo: r } = state;
  try {
    const check = await fetch(`https://api.github.com/repos/${u}/${encodeURIComponent(r)}/contents/.github/workflows/build.yml`, {
      headers: { 'Authorization': `Bearer ${t}`, 'Accept': 'application/vnd.github+json' }
    });
    if (check.status === 404) {
      await uploadWorkflow(u, t, r);
    }
  } catch (e) { /* ignore */ }
}

async function uploadWorkflow(username, token, repo) {
  const workflowContent = `name: Build APK

on:
  workflow_dispatch:
    inputs:
      app_name:
        description: 'App Name'
        required: true
      package_name:
        description: 'Package Name'
        required: true
      version:
        description: 'Version'
        required: true
      files_base64:
        description: 'Files JSON base64'
        required: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
      - name: Install Capacitor
        run: npm install -g @capacitor/cli
      - name: Setup project
        run: |
          mkdir -p app/www
          echo '\${{ github.event.inputs.files_base64 }}' | base64 -d > files.json
          node -e "
            const fs = require('fs');
            const files = JSON.parse(fs.readFileSync('files.json'));
            files.forEach(f => {
              const dir = 'app/www/' + f.path.split('/').slice(0,-1).join('/');
              if(dir !== 'app/www/') fs.mkdirSync(dir, {recursive:true});
              fs.writeFileSync('app/www/' + f.path, Buffer.from(f.content, 'base64'));
            });
          "
      - name: Init Capacitor
        run: |
          cd app
          npm init -y
          npm install @capacitor/core @capacitor/android
          npx cap init "\${{ github.event.inputs.app_name }}" "\${{ github.event.inputs.package_name }}" --web-dir www
          npx cap add android
      - name: Build APK
        run: |
          cd app/android
          chmod +x gradlew
          ./gradlew assembleDebug
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: app/android/app/build/outputs/apk/debug/app-debug.apk
`;

  const encoded = btoa(unescape(encodeURIComponent(workflowContent)));

  await fetch(`https://api.github.com/repos/${username}/${encodeURIComponent(repo)}/contents/.github/workflows/build.yml`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Add APK build workflow',
      content: encoded,
    })
  });
}

function setTokenStatus(connected) {
  const el = document.getElementById('tokenStatus');
  if (connected) {
    el.innerHTML = '<span class="dot dot-on"></span> Terhubung';
    el.style.color = 'var(--success)';
  } else {
    el.innerHTML = '<span class="dot dot-off"></span> Belum terhubung';
    el.style.color = '';
  }
}

function toggleToken() {
  const inp = document.getElementById('ghToken');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ---- ICON ----
function handleIcon(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    state.iconBase64 = e.target.result;
    state.iconName = file.name;
    const preview = document.getElementById('iconPreview');
    preview.innerHTML = `<img src="${state.iconBase64}" alt="icon" />`;
    const nameEl = document.getElementById('iconName');
    nameEl.textContent = file.name;
    nameEl.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ---- FILES ----
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.add('dragover');
}

function handleDragLeave(e) {
  document.getElementById('dropzone').classList.remove('dragover');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
}

function handleFiles(files) {
  for (const file of files) {
    if (state.uploadedFiles.find(f => f.name === file.name)) continue;
    state.uploadedFiles.push(file);
  }
  renderFileList();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  const count = document.getElementById('fileCount');
  count.textContent = state.uploadedFiles.length + ' file';

  if (state.uploadedFiles.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = state.uploadedFiles.map((f, i) => {
    const ext = f.name.includes('.') ? f.name.split('.').pop().toUpperCase() : 'FILE';
    return `
      <div class="file-item">
        <span class="file-ext">${ext}</span>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${formatSize(f.size)}</span>
        <button class="file-remove" onclick="removeFile(${i})">×</button>
      </div>
    `;
  }).join('');
}

function removeFile(i) {
  state.uploadedFiles.splice(i, 1);
  renderFileList();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---- VERSION ----
function handleVersionChange() {
  const sel = document.getElementById('appVersion').value;
  document.getElementById('customVersionGroup').style.display = sel === 'custom' ? 'flex' : 'none';
}

function getVersion() {
  const sel = document.getElementById('appVersion').value;
  if (sel === 'custom') {
    return document.getElementById('customVersion').value.trim() || '1.0.0';
  }
  return sel;
}

// ---- BUILD ----
async function startBuild() {
  const appName = document.getElementById('appName').value.trim();
  const packageName = document.getElementById('packageName').value.trim();
  const version = getVersion();

  if (!state.connected) return showToast('⚠️ Hubungkan GitHub dulu!', 'error');
  if (!appName) return showToast('⚠️ Masukkan nama app!', 'error');
  if (!packageName) return showToast('⚠️ Masukkan package name!', 'error');
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)) {
    return showToast('⚠️ Package name tidak valid! Contoh: com.nama.app', 'error');
  }
  if (state.uploadedFiles.length === 0) return showToast('⚠️ Upload minimal 1 file!', 'error');

  document.getElementById('buildBtn').disabled = true;

  // Show status card
  const statusCard = document.getElementById('buildStatusCard');
  statusCard.style.display = 'block';
  setProgress(5, 'Menyiapkan file...', 'running');
  addLog('info', `→ App: ${appName} | v${version} | ${packageName}`);
  addLog('info', `→ File: ${state.uploadedFiles.length} file`);

  // Encode files
  const filesData = [];
  for (const file of state.uploadedFiles) {
    const b64 = await fileToBase64(file);
    filesData.push({ path: file.name, content: b64.split(',')[1] });
  }

  const filesJson = JSON.stringify(filesData);
  const filesBase64 = btoa(unescape(encodeURIComponent(filesJson)));

  setProgress(15, 'Menghubungi GitHub Actions...', 'running');
  addLog('info', '→ Mengirim ke GitHub Actions...');

  // Ensure workflow exists first
  await ensureWorkflow();

  try {
    const res = await fetch(
      `https://api.github.com/repos/${state.ghUsername}/${encodeURIComponent(state.ghRepo)}/actions/workflows/build.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.ghToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { app_name: appName, package_name: packageName, version, files_base64: filesBase64 }
        })
      }
    );

    if (res.status === 204) {
      addLog('ok', '✓ Build berhasil di-trigger!');
      setProgress(25, 'Build berjalan di GitHub...', 'running');

      const buildId = Date.now();
      const entry = {
        id: buildId,
        appName, packageName, version,
        icon: state.iconBase64,
        status: 'building',
        date: new Date().toLocaleString('id-ID'),
        runId: null,
      };
      state.history.unshift(entry);
      saveHistory();
      renderHistory();

      // Start polling after 15s
      setTimeout(() => pollBuild(buildId, 0), 15000);

    } else {
      const err = await res.json().catch(() => ({}));
      addLog('err', '✗ Error: ' + (err.message || res.status));
      setProgress(0, 'Gagal trigger build', 'error');
      document.getElementById('buildBtn').disabled = false;
    }
  } catch (e) {
    addLog('err', '✗ ' + e.message);
    setProgress(0, 'Network error!', 'error');
    document.getElementById('buildBtn').disabled = false;
  }
}

async function pollBuild(buildId, attempt) {
  if (attempt > 35) {
    addLog('err', '✗ Timeout — cek GitHub Actions secara manual');
    setProgress(0, 'Timeout', 'error');
    document.getElementById('buildBtn').disabled = false;
    return;
  }

  const progress = Math.min(90, 25 + attempt * 2);
  setProgress(progress, `Build berjalan... (${(attempt + 1) * 20}s)`, 'running');
  addLog('info', `→ Polling status... attempt ${attempt + 1}`);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${state.ghUsername}/${encodeURIComponent(state.ghRepo)}/actions/runs?per_page=3`,
      {
        headers: {
          'Authorization': `Bearer ${state.ghToken}`,
          'Accept': 'application/vnd.github+json',
        }
      }
    );
    const data = await res.json();
    const run = data.workflow_runs?.[0];
    if (!run) {
      setTimeout(() => pollBuild(buildId, attempt + 1), 20000);
      return;
    }

    // Save runId
    const idx = state.history.findIndex(b => b.id === buildId);
    if (idx >= 0 && !state.history[idx].runId) {
      state.history[idx].runId = run.id;
      saveHistory();
      renderHistory();
    }

    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        addLog('ok', '✓ Build sukses! Run ID: ' + run.id);
        setProgress(100, '✅ Build selesai!', 'success');
        updateHistoryStatus(buildId, 'success');
        await downloadAPK(run.id, buildId);
      } else {
        addLog('err', '✗ Build gagal: ' + run.conclusion);
        setProgress(0, '❌ Build gagal', 'error');
        updateHistoryStatus(buildId, 'failed');
        document.getElementById('buildBtn').disabled = false;
      }
    } else {
      setTimeout(() => pollBuild(buildId, attempt + 1), 20000);
    }
  } catch (e) {
    addLog('err', '! Poll error: ' + e.message);
    setTimeout(() => pollBuild(buildId, attempt + 1), 20000);
  }
}

async function downloadAPK(runId, buildId) {
  addLog('info', '→ Mengambil artifact APK...');
  try {
    const res = await fetch(
      `https://api.github.com/repos/${state.ghUsername}/${encodeURIComponent(state.ghRepo)}/actions/runs/${runId}/artifacts`,
      { headers: { 'Authorization': `Bearer ${state.ghToken}`, 'Accept': 'application/vnd.github+json' } }
    );
    const data = await res.json();
    const artifact = data.artifacts?.find(a => a.name === 'app-debug');
    if (!artifact) {
      addLog('err', '✗ Artifact tidak ditemukan');
      document.getElementById('buildBtn').disabled = false;
      return;
    }

    const dlRes = await fetch(
      `https://api.github.com/repos/${state.ghUsername}/${encodeURIComponent(state.ghRepo)}/actions/artifacts/${artifact.id}/zip`,
      { headers: { 'Authorization': `Bearer ${state.ghToken}` } }
    );
    const blob = await dlRes.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const appName = document.getElementById('appName').value || 'app';
    a.href = url;
    a.download = appName.replace(/\s+/g, '-') + '-debug.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog('ok', '✓ APK berhasil diunduh!');
    showToast('🎉 APK berhasil diunduh!', 'success');
    document.getElementById('buildBtn').disabled = false;
  } catch (e) {
    addLog('err', '✗ Download error: ' + e.message);
    document.getElementById('buildBtn').disabled = false;
  }
}

// ---- HISTORY ----
function saveHistory() {
  // Only save last 20
  state.history = state.history.slice(0, 20);
  localStorage.setItem('apk_history', JSON.stringify(state.history));
}

function updateHistoryStatus(buildId, status) {
  const idx = state.history.findIndex(b => b.id === buildId);
  if (idx >= 0) {
    state.history[idx].status = status;
    saveHistory();
    renderHistory();
  }
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (state.history.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Belum ada APK yang dibuat</p>
      </div>`;
    return;
  }

  list.innerHTML = state.history.map((item, i) => `
    <div class="history-item">
      <div class="history-icon">
        ${item.icon ? `<img src="${item.icon}" alt="icon" />` : '📱'}
      </div>
      <div class="history-info">
        <div class="history-name">${item.appName}</div>
        <div class="history-meta">
          <span class="meta-tag">pkg: <b>${item.packageName}</b></span>
          <span class="meta-tag">v<b>${item.version}</b></span>
          <span class="meta-tag"><b>${item.date}</b></span>
        </div>
      </div>
      <span class="h-status ${item.status}">
        ${item.status === 'success' ? 'SUCCESS' : item.status === 'building' ? 'BUILDING' : 'FAILED'}
      </span>
      <div class="history-actions">
        ${item.runId
          ? `<button class="btn-icon" title="Lihat di GitHub"
              onclick="window.open('https://github.com/${state.ghUsername || localStorage.getItem('gh_username')}/${encodeURIComponent(state.ghRepo || localStorage.getItem('gh_repo'))}/actions/runs/${item.runId}')">🔗</button>`
          : ''}
        <button class="btn-icon del" title="Hapus" onclick="deleteHistory(${i})">🗑</button>
      </div>
    </div>
  `).join('');
}

function deleteHistory(i) {
  state.history.splice(i, 1);
  saveHistory();
  renderHistory();
  showToast('🗑 Dihapus', 'success');
}

function clearHistory() {
  if (!confirm('Hapus semua riwayat build?')) return;
  state.history = [];
  saveHistory();
  renderHistory();
  showToast('🗑 Semua riwayat dihapus', 'success');
}

// ---- UI HELPERS ----
function setProgress(pct, desc, type) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('statusDesc').textContent = desc;
  const badge = document.getElementById('statusBadge');
  badge.className = 'status-badge';
  if (type === 'success') { badge.textContent = 'SUCCESS'; badge.classList.add('success'); }
  else if (type === 'error') { badge.textContent = 'FAILED'; badge.classList.add('error'); }
  else { badge.textContent = 'RUNNING'; }
}

function addLog(type, msg) {
  const log = document.getElementById('buildLog');
  const span = document.createElement('span');
  span.className = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : 'log-info';
  span.textContent = msg;
  log.appendChild(span);
  log.appendChild(document.createElement('br'));
  log.scrollTop = log.scrollHeight;
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 3000);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
