const searchInput = document.querySelector('#searchInput');
const tableRows = [...document.querySelectorAll('#leaderboardTable tbody tr')];

if (searchInput) {
  searchInput.addEventListener('input', () => {
    const keyword = searchInput.value.trim().toLowerCase();

    for (const row of tableRows) {
      const player = row.dataset.player || '';
      row.style.display = player.includes(keyword) ? '' : 'none';
    }
  });
}
