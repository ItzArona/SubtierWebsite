const searchInput = document.querySelector('#searchInput');
const tableRows = [...document.querySelectorAll('#leaderboardTable tbody tr.leaderboard-row')];
const emptyStateRow = document.querySelector('#emptyStateRow');
const adminFilterInput = document.querySelector('#adminFilterInput');
const adminCards = [...document.querySelectorAll('.entry-editor-card[data-search]')];
const adminEmptyState = document.querySelector('#adminEmptyState');
const adminFilterMeta = document.querySelector('#adminFilterMeta');

tableRows.forEach((row, index) => {
  row.style.setProperty('--row-index', String(index));
});

if (searchInput) {
  searchInput.addEventListener('input', () => {
    const keyword = searchInput.value.trim().toLowerCase();
    let visibleRows = 0;

    for (const row of tableRows) {
      if (row === emptyStateRow) {
        continue;
      }

      const player = row.dataset.player || '';
      const isVisible = player.includes(keyword);
      row.hidden = !isVisible;

      if (isVisible) {
        visibleRows += 1;
      }
    }

    if (emptyStateRow) {
      emptyStateRow.hidden = visibleRows !== 0;
    }
  });
}

if (adminFilterInput && adminCards.length > 0) {
  const applyAdminFilter = () => {
    const keyword = adminFilterInput.value.trim().toLowerCase();
    let visibleCards = 0;

    for (const card of adminCards) {
      const searchableText = card.dataset.search || '';
      const isVisible = searchableText.includes(keyword);
      card.hidden = !isVisible;

      if (isVisible) {
        visibleCards += 1;
      }
    }

    if (adminEmptyState) {
      adminEmptyState.hidden = visibleCards !== 0;
    }

    if (adminFilterMeta) {
      adminFilterMeta.textContent = `当前显示 ${visibleCards} / ${adminCards.length} 条`;
    }
  };

  adminFilterInput.addEventListener('input', applyAdminFilter);
  applyAdminFilter();
}
