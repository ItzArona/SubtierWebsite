const searchInput = document.querySelector('#searchInput');
const tableRows = [...document.querySelectorAll('#leaderboardTable tbody tr.leaderboard-row')];
const emptyStateRow = document.querySelector('#emptyStateRow');

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
