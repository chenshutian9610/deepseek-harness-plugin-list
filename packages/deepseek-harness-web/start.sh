cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit 1
npm install --omit=dev && node bin.mjs