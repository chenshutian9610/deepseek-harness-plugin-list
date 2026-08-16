cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit 1
npm install --omit=dev && node bin.mjs --port 3081 --host 0.0.0.0 --allow-remote-settings