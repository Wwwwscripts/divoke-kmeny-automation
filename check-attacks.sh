#!/bin/bash
# Script pro kontrolu příchozích útoků v databázi

echo "🔍 Kontroluji databázi útoků..."
echo ""

if [ ! -f "data/accounts.json" ]; then
  echo "❌ Databáze neexistuje!"
  echo "💡 Spusť automatizaci pomocí: npm run automate"
  exit 1
fi

echo "📊 Účty s příchozími útoky:"
echo ""

# Vypíše všechny účty a jejich útočné informace
cat data/accounts.json | jq -r '.accounts[] | select(.last_attack_count > 0) | "
Účet: \(.username) (ID: \(.id))
Svět: \(.world)
Počet útoků: \(.last_attack_count)
Detaily: \(.attacks_info // "žádné")
---"'

echo ""
echo "📋 Úplný výpis attacks_info pro všechny účty:"
echo ""
cat data/accounts.json | jq -r '.accounts[] | "
Účet: \(.username)
attacks_info: \(.attacks_info // "null")
"'
