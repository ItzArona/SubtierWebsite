'use strict';

const $$ = (sel, root) => [...((root || document).querySelectorAll(sel))];
const $ = (sel, root) => (root || document).querySelector(sel);

// Mobile nav toggle
const mobileNavToggle = $('#mobileNavToggle');
const siteNav = $('#siteNav');
if (mobileNavToggle && siteNav) {
  mobileNavToggle.addEventListener('click', () => {
    mobileNavToggle.classList.toggle('open');
    siteNav.classList.toggle('open');
  });
}

// data-confirm forms (replaces inline onsubmit which is blocked by CSP script-src-attr)
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form && form.matches('form[data-confirm]')) {
    const message = form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) {
      event.preventDefault();
    }
  }
});

// Login button -> spinner / disabled state
const loginForm = $('#loginForm');
const loginSubmit = $('#loginSubmit');
if (loginForm && loginSubmit) {
  loginForm.addEventListener('submit', () => {
    loginSubmit.textContent = '登录中…';
    loginSubmit.style.opacity = '0.7';
    loginSubmit.disabled = true;
  });
}

// Debounce
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Ctrl+K focus
document.addEventListener('keydown', (e) => {
  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
    const target = $('#searchInput') || $('#adminFilterInput');
    if (target) {
      e.preventDefault();
      target.focus();
      target.select();
    }
  }
});

// Public leaderboard search + sort
const tableBody = $('#leaderboardTable tbody');
const tableRows = $$('#leaderboardTable tbody tr.leaderboard-row');
const emptyStateRow = $('#emptyStateRow');
const searchInput = $('#searchInput');
const thSortList = $$('th[data-sort]');

if (searchInput && tableRows.length > 0) {
  const onSearch = debounce(() => {
    const keyword = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const row of tableRows) {
      const player = row.dataset.player || '';
      const rank = (row.dataset.rank || '').toLowerCase();
      const isVisible = !keyword || player.includes(keyword) || rank.includes(keyword);
      row.hidden = !isVisible;
      if (isVisible) visible += 1;
    }
    if (emptyStateRow) emptyStateRow.hidden = visible !== 0;
  }, 200);
  searchInput.addEventListener('input', onSearch);
}

let currentSortCol = null;
let currentSortAsc = true;
const sortFunctions = {
  position: (a, b) => parseInt(a.dataset.position, 10) - parseInt(b.dataset.position, 10),
  player:   (a, b) => (a.dataset.player || '').localeCompare(b.dataset.player || ''),
  points:   (a, b) => parseInt(a.dataset.points, 10) - parseInt(b.dataset.points, 10),
  rank:     (a, b) => (a.dataset.rank || '').localeCompare(b.dataset.rank || '')
};

if (thSortList.length > 0 && tableBody) {
  thSortList.forEach((th) => {
    th.addEventListener('click', () => {
      const sortKey = th.dataset.sort;
      if (!sortFunctions[sortKey]) return;
      if (currentSortCol === sortKey) {
        currentSortAsc = !currentSortAsc;
      } else {
        currentSortCol = sortKey;
        currentSortAsc = true;
      }
      thSortList.forEach((header) => header.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(currentSortAsc ? 'sort-asc' : 'sort-desc');
      applySort(currentSortCol, currentSortAsc);
    });
  });
}

function applySort(key, asc) {
  if (!tableBody || !sortFunctions[key]) return;
  const sorted = [...tableRows].sort((a, b) => {
    const v = sortFunctions[key](a, b);
    return asc ? v : -v;
  });
  const fragment = document.createDocumentFragment();
  sorted.forEach((row) => fragment.appendChild(row));
  if (emptyStateRow) fragment.appendChild(emptyStateRow);
  tableBody.appendChild(fragment);
}

// Mobile sort dropdown
const mobileSortSelect = $('#mobileSortSelect');
const mobileSortDir = $('#mobileSortDir');
if (mobileSortSelect && mobileSortDir && tableRows.length > 0) {
  function syncMobileLabel() {
    const dir = mobileSortDir.dataset.dir === 'asc' ? '升序' : '降序';
    const arrow = mobileSortDir.dataset.dir === 'asc' ? '↑' : '↓';
    mobileSortDir.textContent = `${arrow} ${dir}`;
  }
  function applyMobileSort() {
    const key = mobileSortSelect.value;
    const asc = mobileSortDir.dataset.dir === 'asc';
    currentSortCol = key;
    currentSortAsc = asc;
    thSortList.forEach((header) => header.classList.remove('sort-asc', 'sort-desc'));
    const matchingTh = [...thSortList].find((h) => h.dataset.sort === key);
    if (matchingTh) matchingTh.classList.add(asc ? 'sort-asc' : 'sort-desc');
    applySort(key, asc);
  }
  syncMobileLabel();
  mobileSortSelect.addEventListener('change', applyMobileSort);
  mobileSortDir.addEventListener('click', () => {
    mobileSortDir.dataset.dir = mobileSortDir.dataset.dir === 'asc' ? 'desc' : 'asc';
    syncMobileLabel();
    applyMobileSort();
  });
}

// Admin dashboard filter
const adminFilterInput = $('#adminFilterInput');
const adminCards = $$('.entry-editor-card[data-search]');
const adminEmptyState = $('#adminEmptyState');
const adminFilterMeta = $('#adminFilterMeta');

if (adminFilterInput && adminCards.length > 0) {
  const apply = debounce(() => {
    const keyword = adminFilterInput.value.trim().toLowerCase();
    let visible = 0;
    for (const card of adminCards) {
      const text = card.dataset.search || '';
      const ok = !keyword || text.includes(keyword);
      card.hidden = !ok;
      if (ok) visible += 1;
    }
    if (adminEmptyState) adminEmptyState.hidden = visible !== 0;
    if (adminFilterMeta) {
      const total = adminFilterMeta.getAttribute('data-total') || adminCards.length;
      adminFilterMeta.textContent = `总共 ${total} 条 · 本页筛选出 ${visible} / ${adminCards.length} 条`;
    }
  }, 180);
  adminFilterInput.addEventListener('input', apply);
}
