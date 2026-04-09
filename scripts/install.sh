#!/usr/bin/env bash

set -euo pipefail

REPO_URL="https://github.com/MeGurre666/Discord-Project-Bot"
DEFAULT_TARGET_DIR="Discord-Project-Bot"
TARGET_DIR="${1:-${DEFAULT_TARGET_DIR}}"
PROJECT_DIR=""

log() {
	printf '[install] %s\n' "$1"
}

warn() {
	printf '[install] WARNING: %s\n' "$1"
}

fail() {
	printf '[install] ERROR: %s\n' "$1" >&2
	exit 1
}

require_command() {
	local command_name="$1"
	local install_hint="$2"

	if ! command -v "${command_name}" >/dev/null 2>&1; then
		fail "${command_name} is required. ${install_hint}"
	fi
}

validate_node_version() {
	local node_major
	node_major="$(node -p "process.versions.node.split('.')[0]")"

	# discord.js v14 requires Node.js 18.0.0 or newer.
	if [ "${node_major}" -lt 18 ]; then
		fail "Node.js 18+ is required. Found Node.js $(node -v)."
	fi
}

install_dependencies() {
	cd "${PROJECT_DIR}"

	if [ -f "package-lock.json" ]; then
		log "Installing dependencies with npm ci..."
		npm ci
	else
		log "Installing dependencies with npm install..."
		npm install
	fi
}

ensure_env_file() {
	cd "${PROJECT_DIR}"

	if [ -f ".env" ]; then
		log ".env already exists. Leaving it unchanged."
		return
	fi

	if [ -f ".env.example" ]; then
		cp ".env.example" ".env"
		log "Created .env from .env.example"
	else
		warn "No .env.example found; creating a minimal .env file"
		cat > ".env" <<'EOF'
TOKEN=
CLIENT_ID=
MONGODB_URI=mongodb://localhost:27017/discord_bot
EOF
	fi
}

validate_config_json() {
	cd "${PROJECT_DIR}"

	if [ ! -f "config.json" ]; then
		warn "config.json not found. The bot may fail to start until it is created."
		return
	fi

	if ! node -e "const fs=require('node:fs'); JSON.parse(fs.readFileSync('config.json','utf8'));" >/dev/null 2>&1; then
		warn "config.json is not valid JSON. Please fix it before running the bot."
	else
		log "config.json is valid JSON"
	fi
}

show_next_steps() {
	cat <<EOF

Installation complete.
Project directory: ${PROJECT_DIR}

Next steps:
1. Open ${PROJECT_DIR}/.env and set TOKEN, CLIENT_ID, and MONGODB_URI.
2. Verify config.json values for your server.
3. Start the bot with: cd ${PROJECT_DIR} && node bot.js

EOF
}

clone_or_use_existing_repo() {
	local requested_dir="$1"

	if [ -d "${requested_dir}/.git" ]; then
		PROJECT_DIR="$(cd "${requested_dir}" && pwd)"
		log "Using existing repository at ${PROJECT_DIR}"
		return
	fi

	if [ -e "${requested_dir}" ]; then
		fail "Target path '${requested_dir}' exists and is not a git repository directory. Choose a different path."
	fi

	log "Cloning ${REPO_URL} into ${requested_dir}..."
	git clone "${REPO_URL}" "${requested_dir}"
	PROJECT_DIR="$(cd "${requested_dir}" && pwd)"
}

main() {
	log "Starting Discord Project Bot installer"

	require_command "node" "Install Node.js 18+ from https://nodejs.org"
	require_command "npm" "Install npm with Node.js from https://nodejs.org"
	require_command "git" "Install Git from https://git-scm.com"

	clone_or_use_existing_repo "${TARGET_DIR}"
	validate_node_version
	install_dependencies
	ensure_env_file
	validate_config_json
	show_next_steps
}

main "$@"
