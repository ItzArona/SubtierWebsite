const searchInput = document.querySelector('#searchInput');
const tableBody = document.querySelector('#leaderboardTable tbody');
const tableRows = [...document.querySelectorAll('#leaderboardTable tbody tr.leaderboard-row')];
const emptyStateRow = document.querySelector('#emptyStateRow');
const adminFilterInput = document.querySelector('#adminFilterInput');
const adminCards = [...document.querySelectorAll('.entry-editor-card[data-search]')];
const adminEmptyState = document.querySelector('#adminEmptyState');
const adminFilterMeta = document.querySelector('#adminFilterMeta');
const thSortList = document.querySelectorAll('th[data-sort]');
const mobileNavToggle = document.querySelector('#mobileNavToggle');
const siteNav = document.querySelector('#siteNav');

// Mobile nav
if (mobileNavToggle) {
  mobileNavToggle.addEventListener('click', () => {
    mobileNavToggle.classList.toggle('open');
    siteNav.classList.toggle('open');
  });
}

// Debounce util
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Ctrl+K
document.addEventListener('keydown', (e) => {
  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (searchInput) searchInput.focus();
    if (adminFilterInput) adminFilterInput.focus();
  }
});

tableRows.forEach((row, index) => {
  row.style.setProperty('--row-index', String(index));
});

if (searchInput) {
  const onSearch = debounce(() => {
    const keyword = searchInput.value.trim().toLowerCase();
    let visibleRows = 0;

    for (const row of tableRows) {
      if (row === emptyStateRow) continue;

      const player = row.dataset.player || '';
      const isVisible = player.includes(keyword);
      row.hidden = !isVisible;

      if (isVisible) visibleRows += 1;
    }

    if (emptyStateRow) {
      emptyStateRow.hidden = visibleRows !== 0;
    }
  }, 300);
  
  searchInput.addEventListener('input', onSearch);
}

if (adminFilterInput && adminCards.length > 0) {
  const applyAdminFilter = debounce(() => {
    const keyword = adminFilterInput.value.trim().toLowerCase();
    let visibleCards = 0;

    for (const card of adminCards) {
      const searchableText = card.dataset.search || '';
      const isVisible = searchableText.includes(keyword);
      card.hidden = !isVisible;

      if (isVisible) visibleCards += 1;
    }

    if (adminEmptyState) {
      adminEmptyState.hidden = visibleCards !== 0;
    }

    if (adminFilterMeta) {
      adminFilterMeta.textContent = `当前显示 ${visibleCards} / ${adminCards.length} 条`;
    }
  }, 300);

  adminFilterInput.addEventListener('input', applyAdminFilter);
}

// Sorting logic
let currentSortCol = null;
let currentSortAsc = true;

const sortFunctions = {
  position: (a, b) => parseInt(a.dataset.position) - parseInt(b.dataset.position),
  player: (a, b) => a.dataset.player.localeCompare(b.dataset.player),
  points: (a, b) => parseInt(a.dataset.points) - parseInt(b.dataset.points),
  rank: (a, b) => a.dataset.rank.localeCompare(b.dataset.rank)
};

if (thSortList.length > 0) {
  thSortList.forEach(th => {
    th.addEventListener('click', () => {
      const sortKey = th.dataset.sort;
      if (!sortFunctions[sortKey]) return;

      if (currentSortCol === sortKey) {
        currentSortAsc = !currentSortAsc;
      } else {
        currentSortCol = sortKey;
        currentSortAsc = true;
      }

      thSortList.forEach(header => {
        header.classList.remove('sort-asc', 'sort-desc');
      });

      th.classList.add(currentSortAsc ? 'sort-asc' : 'sort-desc');

      const sortedRows = [...tableRows].sort((a, b) => {
        const val = sortFunctions[sortKey](a, b);
        return currentSortAsc ? val : -val;
      });

      if (tableBody) {
        const fragment = document.createDocumentFragment();
        sortedRows.forEach(row => {
          fragment.appendChild(row);
        });
        if (emptyStateRow) {
          fragment.appendChild(emptyStateRow);
        }
        tableBody.appendChild(fragment);
      }
    });
  });
}
