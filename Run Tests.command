#!/bin/bash
# Double-click this file in Finder to run all tests manually.
# It opens a Terminal window, runs the tests, then opens the report.

cd "$(dirname "$0")"

echo "======================================"
echo "  BrowserStack Performance Tests"
echo "======================================"
echo ""
echo "Choose what to run:"
echo "  1) Full run  (iPhone 12 + Galaxy S10 + Desktop)"
echo "  2) iPhone 12 + Desktop only"
echo "  3) Galaxy S10 only"
echo "  4) Desktop only"
echo ""
read -p "Enter 1-4 (default: 1): " choice

case "$choice" in
  2) CMD="node run-tests.js --iphone" ;;
  3) CMD="node run-tests.js --galaxy" ;;
  4) CMD="node run-tests.js --desktop" ;;
  *) CMD="node run-tests.js" ;;
esac

echo ""
echo "Running: $CMD"
echo ""

$CMD

echo ""
echo "Opening report..."
open results/report.html

echo ""
echo "Done. Press any key to close."
read -n 1
