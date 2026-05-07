module.exports = {
  apps: [
    {
      name: 'subtier',
      script: 'src/server.js',
      watch: false,
      kill_timeout: 6000,
      exp_backoff_restart_delay: 200,
      max_memory_restart: '512M'
    }
  ]
};
