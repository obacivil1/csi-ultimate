#!/usr/bin/env bash
#
# run-project.sh â€” CSI-Ultimate Interactive Launcher (macOS / Linux)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Usage:  chmod +x run-project.sh && ./run-project.sh
#
# Interactive menu â†’ keyword prompt â†’ timeframe prompt â†’
#   â†’ node core/run.mjs <site> "Jobs" "<keyword>" <timeframe> --uat
#   â†’ live dashboard â†’ "Press any key to exit"
#
set -euo pipefail

# â”€â”€ Detect project root (directory where this script lives) â”€â”€â”€â”€â”€
cd "$(dirname "$0")"

# â”€â”€ Colors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

# â”€â”€ Check prerequisites â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
check_node() {
  if ! command -v node &>/dev/null; then
    echo ""
    echo -e "  ${RED}[ERROR] Node.js is not installed or not in PATH.${RESET}"
    echo "  Please install Node.js from https://nodejs.org (v20+)"
    echo ""
    read -rp "  Press Enter to exit..."
    exit 1
  fi
}

check_file() {
  if [[ ! -f "core/run.mjs" ]]; then
    echo ""
    echo -e "  ${RED}[ERROR] core/run.mjs not found.${RESET}"
    echo "  Make sure you're running this from the csi-ultimate project root."
    echo ""
    read -rp "  Press Enter to exit..."
    exit 1
  fi
}

# â”€â”€ Menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
show_menu() {
  clear
  cat << 'EOF'

  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
  â•‘       CSI-Ultimate  â€”  Interactive Launcher      â•‘
  â•‘       Multi-Site Classifieds Extraction          â•‘
  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

EOF

  echo "  Select target site:"
  echo ""
  echo "    1) Expatriates (Riyadh)"
  echo "    2) Gumtree"
  echo "    3) Craigslist London"
  echo "    4) Preloved"
  echo "    5) OLX Pakistan"
  echo "    6) OpenSooq Saudi Arabia"
  echo ""
}

# â”€â”€ Site mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
case "${1:-}" in
  1|expatriates)  SITE_HOST="expatriates.com"       SITE_NAME="Expatriates"       ;;
  2|gumtree)      SITE_HOST="gumtree.com"           SITE_NAME="Gumtree"           ;;
  3|craigslist)   SITE_HOST="london.craigslist.org" SITE_NAME="Craigslist London" ;;
  4|preloved)     SITE_HOST="preloved.co.uk"        SITE_NAME="Preloved"          ;;
  5|olx)          SITE_HOST="olx.com.pk"            SITE_NAME="OLX Pakistan"      ;;
  6|opensooq)     SITE_HOST="sa.opensooq.com"       SITE_NAME="OpenSooq"          ;;
esac

# â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
main() {
  check_node
  check_file

  # If site was not passed as argument, show interactive menu
  if [[ -z "${SITE_HOST:-}" ]]; then
    show_menu
    read -rp "  Enter number [1-6]: " choice
    echo ""

    case "$choice" in
      1) SITE_HOST="expatriates.com"       SITE_NAME="Expatriates"       ;;
      2) SITE_HOST="gumtree.com"           SITE_NAME="Gumtree"           ;;
      3) SITE_HOST="london.craigslist.org" SITE_NAME="Craigslist London" ;;
      4) SITE_HOST="preloved.co.uk"        SITE_NAME="Preloved"          ;;
      5) SITE_HOST="olx.com.pk"            SITE_NAME="OLX Pakistan"      ;;
      6) SITE_HOST="sa.opensooq.com"       SITE_NAME="OpenSooq"          ;;
      *)
        echo -e "  ${RED}Invalid selection. Exiting.${RESET}"
        read -rp "  Press Enter to exit..."
        exit 1
        ;;
    esac
  fi

  CATEGORY="Jobs"

  # Keyword
  read -rp "  Enter keyword (e.g. Planning Engineer): " KEYWORD
  echo ""

  # Timeframe (default 1w)
  read -rp "  Enter timeframe [24h/3d/1w/2w/1m/3m/all] (default: 1w): " TIMEFRAME
  TIMEFRAME="${TIMEFRAME:-1w}"

  # â”€â”€ Confirmation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  clear
  echo ""
  echo "  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—"
  echo "  â•‘           Launching Extraction Pipeline             â•‘"
  echo "  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•"
  echo ""
  echo "    Site:      ${SITE_NAME} (${SITE_HOST})"
  echo "    Category:  ${CATEGORY}"
  echo "    Keyword:   ${KEYWORD}"
  echo "    Timeframe: ${TIMEFRAME}"
  echo "    Command:   node core/run.mjs ${SITE_HOST} \"${CATEGORY}\" \"${KEYWORD}\" ${TIMEFRAME} --uat"
  echo ""
  echo "  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•"
  echo "  The dashboard will appear below. Press Ctrl+C to stop."
  echo "  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•"
  echo ""

  # â”€â”€ Execute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  node core/run.mjs "${SITE_HOST}" "${CATEGORY}" "${KEYWORD}" "${TIMEFRAME}" --uat

  # â”€â”€ Post-execution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EXIT_CODE=$?
  echo ""
  echo "  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•"
  echo ""
  if [[ $EXIT_CODE -eq 0 ]]; then
    echo -e "  ${GREEN}Extraction Complete!${RESET}"
  else
    echo -e "  ${YELLOW}Extraction finished with exit code ${EXIT_CODE}.${RESET}"
  fi
  echo "  Archive saved in: data/"
  echo ""
  read -rp "  Press Enter to exit..."
  exit $EXIT_CODE
}

main "$@"

