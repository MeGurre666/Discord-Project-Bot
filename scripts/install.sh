#!/usr/bin/env bash

set -euo pipefail

REPO_URL="https://github.com/MeGurre666/Discord-Project-Bot"
DEFAULT_TARGET_DIR="Discord-Project-Bot"
TARGET_DIR="${1:-${DEFAULT_TARGET_DIR}}"
PROJECT_DIR=""
NODE_CMD="node"
NPM_CMD="npm"

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

windows_folder_path() {
	local special_folder="$1"
	powershell.exe -NoProfile -Command "[Environment]::GetFolderPath('$special_folder')" 2>/dev/null | tr -d '\r'
}

to_unix_path() {
	local input_path="$1"

	if command -v cygpath >/dev/null 2>&1; then
		cygpath -u "$input_path"
	else
		printf '%s' "$input_path"
	fi
}

resolve_windows_node_command() {
	local candidate_path candidate_unix_path
	local program_files local_app_data program_files_x86

	program_files="$(windows_folder_path ProgramFiles)"
	local_app_data="$(windows_folder_path LocalApplicationData)"
	program_files_x86="$(windows_folder_path ProgramFilesX86)"

	for candidate_path in \
		"${program_files}/nodejs/node.exe" \
		"${program_files_x86}/nodejs/node.exe" \
		"${local_app_data}/Programs/nodejs/node.exe"; do
		if [ -n "${candidate_path}" ] && [ -f "${candidate_path}" ]; then
			candidate_unix_path="$(to_unix_path "$candidate_path")"
			NODE_CMD="${candidate_unix_path}"
			NPM_CMD="$(dirname "${candidate_unix_path}")/npm.cmd"
			return 0
		fi
	done

	return 1
}

detect_platform() {
	case "$(uname -s)" in
		Darwin)
			printf 'macos'
			;;
		Linux)
			printf 'linux'
			;;
		MINGW*|MSYS*|CYGWIN*|Windows_NT)
			printf 'windows'
			;;
		*)
			printf 'unknown'
			;;
	esac
}

install_node() {
	local platform
	platform="$(detect_platform)"

	log "Node.js is missing; attempting to install it automatically..."

	case "${platform}" in
		linux)
			if command -v apt-get >/dev/null 2>&1; then
				sudo apt-get update
				sudo apt-get install -y nodejs npm
			elif command -v dnf >/dev/null 2>&1; then
				sudo dnf install -y nodejs npm
			elif command -v yum >/dev/null 2>&1; then
				sudo yum install -y nodejs npm
			elif command -v pacman >/dev/null 2>&1; then
				sudo pacman -Sy --noconfirm nodejs npm
			elif command -v apk >/dev/null 2>&1; then
				sudo apk add nodejs npm
			else
				fail "No supported Linux package manager was found. Install Node.js 18+ from https://nodejs.org"
			fi
			;;
		macos)
			if command -v brew >/dev/null 2>&1; then
				brew install node
			else
				fail "Homebrew was not found. Install Node.js 18+ from https://nodejs.org"
			fi
			;;
		windows)
			if command -v winget >/dev/null 2>&1; then
				winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
			elif command -v choco >/dev/null 2>&1; then
				choco install nodejs-lts -y
			else
				fail "winget or Chocolatey was not found. Install Node.js 18+ from https://nodejs.org"
			fi
			;;
		*)
			fail "Unsupported platform for automatic Node.js installation. Install Node.js 18+ from https://nodejs.org"
			;;
	esac

	if command -v node >/dev/null 2>&1; then
		NODE_CMD="node"
		if command -v npm >/dev/null 2>&1; then
			NPM_CMD="npm"
		fi
	elif [ "${platform}" = "windows" ] && resolve_windows_node_command; then
		log "Using installed Node.js from ${NODE_CMD}"
	else
		fail "Node.js installation did not complete successfully. Install Node.js 18+ from https://nodejs.org"
	fi
}

validate_node_version() {
	local node_major
	node_major="$("${NODE_CMD}" -p "process.versions.node.split('.')[0]")"

	# discord.js v14 requires Node.js 18.0.0 or newer.
	if [ "${node_major}" -lt 18 ]; then
		fail "Node.js 18+ is required. Found Node.js $(${NODE_CMD} -v)."
	fi
}

ensure_npm_command() {
	if command -v npm >/dev/null 2>&1; then
		NPM_CMD="npm"
		return 0
	fi

	if [ -f "${NPM_CMD}" ]; then
		return 0
	fi

	fail "npm is required. Install npm with Node.js from https://nodejs.org"
}

install_dependencies() {
	cd "${PROJECT_DIR}"

	if [ -f "package-lock.json" ]; then
		log "Installing dependencies with npm ci..."
		"${NPM_CMD}" ci
	else
		log "Installing dependencies with npm install..."
		"${NPM_CMD}" install
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

	if ! "${NODE_CMD}" -e "const fs=require('node:fs'); JSON.parse(fs.readFileSync('config.json','utf8'));" >/dev/null 2>&1; then
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
3. Start the bot with: cd ${PROJECT_DIR} && ${NODE_CMD} bot.js

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

	if ! command -v node >/dev/null 2>&1; then
		install_node
	fi

	if [ "${NODE_CMD}" = "node" ] && ! command -v node >/dev/null 2>&1; then
		fail "Node.js is still unavailable after installation. Open a new terminal and rerun the installer if needed."
	fi

	ensure_npm_command
	require_command "git" "Install Git from https://git-scm.com"

	clone_or_use_existing_repo "${TARGET_DIR}"
	validate_node_version
	install_dependencies
	ensure_env_file
	validate_config_json
	show_next_steps
}

main "$@"
