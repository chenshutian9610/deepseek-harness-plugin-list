module.exports = {
  apps: [{
    name: 'deepseek-harness-web',
    cwd: __dirname,
    script: './bin.mjs',
    args: '--port 3081 --host 0.0.0.0 --allow-remote-settings',
  }],
}
