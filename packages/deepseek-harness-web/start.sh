cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit 1
export DSH_LOCAL_PLUGINS_DIR="${DSH_LOCAL_PLUGINS_DIR:-..}"
npm install --omit=dev && node bin.mjs