# ============================================
# Myriad Dev — live TUI
# ============================================
# Sourced by dev.sh. Do not execute directly.
# macOS /bin/bash 3.2: no assoc arrays, no `wait -n`.
#
# Overview is the start menu. Service start/stop stay on this screen
# (backend.log / frontend.log). doctor / db-setup / psql / clean leave
# the alt screen because they need a real tty.

TUI_TAB=0
TUI_SEL=0
TUI_LOG=0
TUI_MSG=""
TUI_HELP=0
TUI_CONFIRM=""
TUI_CONFIRM_TEXT=""
TUI_STTY=""
TUI_ACTIVE=0
TUI_STATUS_DIRTY=1
TUI_CACHE_DB_STATE="stopped"
TUI_CACHE_DB_DETAIL="—"
TUI_CACHE_BE_STATE="stopped"
TUI_CACHE_BE_DETAIL="—"
TUI_CACHE_FE_STATE="stopped"
TUI_CACHE_FE_DETAIL="—"
TUI_CACHE_UP_STATE="stopped"
TUI_CACHE_UP_DETAIL="—"

TUI_TAB_COUNT=5
TUI_LOG_COUNT=4
TUI_MIN_COLS=72
TUI_MIN_ROWS=18
TUI_TAB_NAMES="Overview|Processes|Database|Logs|Tools"

# kind|id|ppid|cpu|mem|etime|label|cmd
TUI_PROCS=""
TUI_PROC_COUNT=0

# Overview = original start menu.
TUI_MENU_IDS="start-all
stop-all
restart-all
database
backend
frontend
updater
clean"

# Tools = things that need a tty or a browser.
TUI_TOOL_IDS="doctor
db-setup
psql
open-frontend
open-backend
clean"

# ---------- strings ----------

tui_strip() {
    printf '%s' "$1" | sed $'s/\x1b\\[[0-9;]*m//g'
}

tui_visible_len() {
    tui_strip "$1" | awk '{ n += length($0) } END { print n+0 }'
}

tui_trunc() {
    local text="$1" max="$2" clean
    clean="$(tui_strip "$text")"
    if [[ ${#clean} -le $max ]]; then
        printf '%s' "$text"
        return
    fi
    printf '%s' "${clean:0:$((max - 1))}…"
}

tui_pad() {
    local text="$1" width="$2" len pad
    len="$(tui_visible_len "$text")"
    pad=$((width - len))
    printf '%s' "$text"
    [[ $pad -gt 0 ]] && printf '%*s' "$pad" ""
}

tui_hline() {
    local ch="${1:-─}" n="${2:-$TUI_COLS}"
    printf '%*s' "$n" "" | tr ' ' "$ch"
}

tui_count() {
    printf '%s\n' "$1" | grep -c .
}

tui_nth() {
    printf '%s\n' "$1" | awk -v n="$2" 'NR==n { print; exit }'
}

tui_mode_label() {
    if [[ "$USE_NATIVE" -eq 1 ]]; then
        echo "native"
    else
        echo "docker-pg"
    fi
}

tui_fmt_rss() {
    local kb="${1:-0}"
    kb="${kb%.*}"
    [[ "$kb" =~ ^[0-9]+$ ]] || { echo "?"; return; }
    if [[ $kb -ge 1048576 ]]; then
        awk -v k="$kb" 'BEGIN { printf "%.1fG", k/1048576 }'
    elif [[ $kb -ge 1024 ]]; then
        awk -v k="$kb" 'BEGIN { printf "%.0fM", k/1024 }'
    else
        echo "${kb}K"
    fi
}

tui_dot() {
    case "$1" in
        running|healthy|up) echo -e "${GREEN}●${NC}" ;;
        starting|degraded)  echo -e "${YELLOW}●${NC}" ;;
        *)                  echo -e "${DIM}○${NC}" ;;
    esac
}

tui_menu_label() {
    case "$1" in
        start-all)   echo "${ICON_ROCKET} Start all services" ;;
        stop-all)    echo "${ICON_STOP} Stop all services" ;;
        restart-all) echo "${ICON_REFRESH} Restart all services" ;;
        database)    echo "${ICON_DB} Database only" ;;
        backend)     echo "${ICON_RUST} Backend only" ;;
        frontend)    echo "${ICON_NODE} Frontend only" ;;
        updater)     echo "${ICON_UPDATER} Updater harness" ;;
        clean)       echo "${ICON_TRASH} Clean project" ;;
        *)           echo "$1" ;;
    esac
}

tui_tool_label() {
    case "$1" in
        doctor)        echo "Run doctor" ;;
        db-setup)      echo "Create role + database" ;;
        psql)          echo "Open psql" ;;
        open-frontend) echo "Open frontend in browser" ;;
        open-backend)  echo "Open backend /health in browser" ;;
        clean)         echo "Clean project (destructive)" ;;
        *)             echo "$1" ;;
    esac
}

tui_svc_meta() {
    case "$1" in
        database) TUI_M_LABEL="Database (PostgreSQL)"; TUI_M_ICON="$ICON_DB";   TUI_M_PORT=":${DB_PORT:-5432}" ;;
        backend)  TUI_M_LABEL="Backend (Rust/Axum)";   TUI_M_ICON="$ICON_RUST"; TUI_M_PORT=":${BACKEND_PORT}" ;;
        frontend) TUI_M_LABEL="Frontend (Astro/React)"; TUI_M_ICON="$ICON_NODE"; TUI_M_PORT=":${FRONTEND_PORT}" ;;
        updater)  TUI_M_LABEL="Updater Harness";       TUI_M_ICON="$ICON_UPDATER"; TUI_M_PORT=":1101" ;;
    esac
}

# ---------- terminal ----------

tui_attach_tty() {
    # Drag / Open With often start with stdin = /dev/null.
    if [[ ! -t 0 && -r /dev/tty ]]; then
        exec </dev/tty
    fi
    if [[ ! -t 1 && -w /dev/tty ]]; then
        exec >/dev/tty
    fi
    if [[ ! -t 2 && -w /dev/tty ]]; then
        exec 2>/dev/tty
    fi
}

tui_enter() {
    TUI_STTY="$(stty -g 2>/dev/null || true)"
    tput smcup 2>/dev/null || printf '\033[?1049h'
    printf '\033[?25l'
    # Normal cursor keys (CSI), not application mode SS3 after smcup.
    tput rmkx 2>/dev/null || printf '\033[?1l'
    # VMIN=0 VTIME=10: kernel waits up to 1s. No bash `read -t` (3.2 is instant).
    stty -echo -icanon time 10 min 0 2>/dev/null || stty -echo -icanon 2>/dev/null || true
    TUI_ACTIVE=1
}

tui_leave() {
    [[ "$TUI_ACTIVE" -eq 1 ]] || return 0
    TUI_ACTIVE=0
    [[ -n "$TUI_STTY" ]] && stty "$TUI_STTY" 2>/dev/null || stty sane 2>/dev/null || true
    printf '\033[?25h'
    tput rmcup 2>/dev/null || printf '\033[?1049l'
}

tui_size() {
    TUI_COLS="$(tput cols 2>/dev/null || echo 80)"
    TUI_ROWS="$(tput lines 2>/dev/null || echo 24)"
    [[ "$TUI_COLS" -lt 20 ]] && TUI_COLS=20
    [[ "$TUI_ROWS" -lt 10 ]] && TUI_ROWS=10
}

tui_read_byte() {
    # -d '' keeps newline as data. rc=0 + empty still means Enter
    # (bash 3.2 delimiter). rc!=0 + empty is the 1s VTIME idle.
    TUI_BYTE=""
    TUI_READ_RC=0
    IFS= read -r -s -n 1 -d '' TUI_BYTE
    TUI_READ_RC=$?
}

tui_read_key() {
    TUI_KEY=""
    local k="" rest=""
    tui_read_byte
    if [[ -z "$TUI_BYTE" ]]; then
        if [[ "$TUI_READ_RC" -eq 0 ]]; then
            TUI_KEY="enter"
        else
            TUI_KEY="timeout"
        fi
        return 0
    fi
    k="$TUI_BYTE"
    if [[ "$k" == $'\033' ]]; then
        stty time 1 min 0 2>/dev/null || true
        tui_read_byte
        if [[ -z "$TUI_BYTE" ]]; then
            stty time 10 min 0 2>/dev/null || true
            TUI_KEY="esc"
            return 0
        fi
        rest="$TUI_BYTE"
        k="${k}${rest}"
        # CSI ([) and SS3 (O) both need one more byte.
        if [[ "$rest" == "[" || "$rest" == "O" ]]; then
            tui_read_byte
            k="${k}${TUI_BYTE}"
        fi
        stty time 10 min 0 2>/dev/null || true
    fi
    case "$k" in
        $'\033[A'|$'\033OA') TUI_KEY="up" ;;
        $'\033[B'|$'\033OB') TUI_KEY="down" ;;
        $'\033[C'|$'\033OC') TUI_KEY="right" ;;
        $'\033[D'|$'\033OD') TUI_KEY="left" ;;
        $'\n'|$'\r'|$'\033OM') TUI_KEY="enter" ;;
        $'\t') TUI_KEY="tab" ;;
        $'\x7f'|$'\b') TUI_KEY="bs" ;;
        *) TUI_KEY="$k" ;;
    esac
}

tui_pause() {
    printf '%s' "Press Enter to close..."
    if [[ -t 0 ]]; then
        read -r _ || true
    elif [[ -r /dev/tty ]]; then
        read -r _ </dev/tty || true
    fi
}

# ---------- snapshots ----------

tui_append_proc() {
    local kind="$1" id="$2" ppid="$3" cpu="$4" mem="$5" etime="$6" label="$7" cmd="$8"
    TUI_PROCS="${TUI_PROCS}${kind}|${id}|${ppid}|${cpu}|${mem}|${etime}|${label}|${cmd}"$'\n'
    TUI_PROC_COUNT=$((TUI_PROC_COUNT + 1))
}

tui_add_pid_tree() {
    local kind="$1" label="$2"
    shift 2
    local seeds pids pid line ppid cpu mem rss etime cmd
    seeds="$(printf '%s\n' "$@" | normalize_pids)"
    [[ -z "$seeds" ]] && return 0
    # shellcheck disable=SC2086
    pids="$(expand_process_tree $seeds)"
    while IFS= read -r pid; do
        [[ -n "$pid" ]] || continue
        line="$(proc_ps "$pid" || true)"
        [[ -n "$line" ]] || continue
        set -- $line
        ppid="${2:--}"
        cpu="${3:--}"
        mem="${4:--}"
        rss="${5:--}"
        etime="${6:--}"
        shift 6 || true
        cmd="$*"
        tui_append_proc "$kind" "$pid" "$ppid" "$cpu" "$mem" "$etime" "$label $(tui_fmt_rss "$rss")" "$cmd"
    done <<< "$pids"
}

tui_add_container() {
    local name="$1" label="$2" kind="$3" status
    docker_cli_available || return 0
    status="$(docker ps -a --filter "name=^${name}$" --format '{{.Status}}' 2>/dev/null | head -n 1)"
    [[ -n "$status" ]] || return 0
    tui_append_proc "$kind" "$name" "-" "-" "-" "-" "$label" "$status"
}

tui_refresh_procs() {
    TUI_PROCS=""
    TUI_PROC_COUNT=0

    local be fe pg
    be="$(list_backend_pids || true)"
    fe="$(list_frontend_pids || true)"
    [[ -n "$be" ]] && tui_add_pid_tree be "backend" $be
    [[ -n "$fe" ]] && tui_add_pid_tree fe "frontend" $fe

    if db_is_docker; then
        tui_add_container "myriad-postgres-dev" "postgres" ctr
    else
        pg="$(list_listen_pids "${DB_PORT:-5432}" || true)"
        [[ -n "$pg" ]] && tui_add_pid_tree pg "postgres" $pg
    fi

    tui_add_container "myriad-updater-dev" "updater" ctr
    tui_add_container "myriad-updater-gateway-dev" "gateway" ctr
    tui_add_container "myriad-docker-guard-dev" "docker-guard" ctr

    if [[ $TUI_SEL -ge $TUI_PROC_COUNT && $TUI_PROC_COUNT -gt 0 ]]; then
        TUI_SEL=$((TUI_PROC_COUNT - 1))
    fi
}

tui_refresh_status() {
    local svc pid
    parse_db_url || true
    for svc in database backend frontend updater; do
        TUI_S_STATE="stopped"
        TUI_S_DETAIL="—"
        case "$svc" in
            database)
                if get_service_status database; then
                    TUI_S_STATE="running"
                    if db_is_docker; then
                        TUI_S_DETAIL="docker  ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
                    else
                        TUI_S_DETAIL="native  ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
                    fi
                fi
                TUI_CACHE_DB_STATE="$TUI_S_STATE"
                TUI_CACHE_DB_DETAIL="$TUI_S_DETAIL"
                ;;
            backend)
                if get_service_status backend; then
                    if backend_health_ok; then TUI_S_STATE="healthy"; else TUI_S_STATE="starting"; fi
                    pid="$(list_backend_pids | head -n 1)"
                    [[ -n "$pid" ]] && TUI_S_DETAIL="$(status_proc_detail "$pid")"
                fi
                TUI_CACHE_BE_STATE="$TUI_S_STATE"
                TUI_CACHE_BE_DETAIL="$TUI_S_DETAIL"
                ;;
            frontend)
                if get_service_status frontend; then
                    if frontend_health_ok; then TUI_S_STATE="up"; else TUI_S_STATE="starting"; fi
                    pid="$(list_frontend_pids | head -n 1)"
                    [[ -n "$pid" ]] && TUI_S_DETAIL="$(status_proc_detail "$pid")"
                fi
                TUI_CACHE_FE_STATE="$TUI_S_STATE"
                TUI_CACHE_FE_DETAIL="$TUI_S_DETAIL"
                ;;
            updater)
                if get_service_status updater; then
                    if updater_health_ok; then TUI_S_STATE="healthy"; else TUI_S_STATE="starting"; fi
                    TUI_S_DETAIL="http://127.0.0.1:1101  gateway :1104"
                fi
                TUI_CACHE_UP_STATE="$TUI_S_STATE"
                TUI_CACHE_UP_DETAIL="$TUI_S_DETAIL"
                ;;
        esac
    done
    TUI_STATUS_DIRTY=0
}

tui_svc_state() {
    case "$1" in
        database) TUI_S_STATE="$TUI_CACHE_DB_STATE"; TUI_S_DETAIL="$TUI_CACHE_DB_DETAIL" ;;
        backend)  TUI_S_STATE="$TUI_CACHE_BE_STATE"; TUI_S_DETAIL="$TUI_CACHE_BE_DETAIL" ;;
        frontend) TUI_S_STATE="$TUI_CACHE_FE_STATE"; TUI_S_DETAIL="$TUI_CACHE_FE_DETAIL" ;;
        updater)  TUI_S_STATE="$TUI_CACHE_UP_STATE"; TUI_S_DETAIL="$TUI_CACHE_UP_DETAIL" ;;
    esac
}

# ---------- render ----------
tui_draw_list() {
    local ids="$1" labelfn="$2" split_after="${3:-}"
    local i=0 id count
    count="$(tui_count "$ids")"
    while [[ $i -lt $count ]]; do
        id="$(tui_nth "$ids" $((i + 1)))"
        if [[ -n "$split_after" && $i -eq $split_after ]]; then
            printf '  %b%s%b\n' "$DIM" "$(tui_hline ─ $((TUI_COLS - 4)))" "$NC"
        fi
        if [[ $i -eq $TUI_SEL ]]; then
            printf '  %b▸ %s%b\n' "$BRIGHT_CYAN" "$($labelfn "$id")" "$NC"
        else
            printf '    %s\n' "$($labelfn "$id")"
        fi
        i=$((i + 1))
    done
}

tui_draw_header() {
    local clock mode title i name
    local -a tabs
    clock="$(date +%H:%M:%S)"
    mode="$(tui_mode_label)"
    title=" Myriad Dev  v${VERSION} "
    printf '%b%s%b' "${BRIGHT_CYAN}${BOLD}" "$(tui_pad "$title" $((TUI_COLS - ${#clock} - ${#mode} - 4)))" "$NC"
    printf '%b %s  %s %b\n' "${DIM}" "$mode" "$clock" "$NC"

    IFS='|' read -r -a tabs <<< "$TUI_TAB_NAMES"
    printf ' '
    i=0
    for name in "${tabs[@]}"; do
        if [[ $i -eq $TUI_TAB ]]; then
            printf '%b[%d %s]%b ' "${BOLD}${CYAN}" "$((i + 1))" "$name" "$NC"
        else
            printf '%b %d %s %b ' "${DIM}" "$((i + 1))" "$name" "$NC"
        fi
        i=$((i + 1))
    done
    echo ""
    printf '%b%s%b\n' "$DIM" "$(tui_hline)" "$NC"
}

tui_draw_footer() {
    local hint
    case "$TUI_TAB" in
        0) hint="↑↓ menu   ↵ run   s start   x stop   r restart   a start-all   K stop-all" ;;
        1) hint="↑↓ select   x SIGTERM   X SIGKILL   r refresh" ;;
        2) hint="s db-setup   p psql" ;;
        3) hint="← → source   b/f/d/u jump" ;;
        4) hint="↑↓ select   ↵ run" ;;
    esac
    printf '%b%s%b\n' "$DIM" "$(tui_hline)" "$NC"
    if [[ -n "$TUI_MSG" ]]; then
        printf ' %b%s%b\n' "$YELLOW" "$(tui_trunc "$TUI_MSG" $((TUI_COLS - 2)))" "$NC"
    else
        printf ' %s\n' "$(tui_trunc "$hint" $((TUI_COLS - 2)))"
    fi
    printf ' %b1-5 tabs  ? help  q quit%b\n' "$DIM" "$NC"
}

tui_draw_overview() {
    parse_db_url || true
    [[ "$TUI_STATUS_DIRTY" -eq 1 ]] && tui_refresh_status
    local name

    printf '  %bService Status%b\n' "$BOLD" "$NC"
    printf '  %b%s%b\n' "$DIM" "$(tui_hline ─ $((TUI_COLS - 4)))" "$NC"

    for name in database backend frontend updater; do
        tui_svc_meta "$name"
        tui_svc_state "$name"
        printf '  %s %s  %s  %s  %s\n' \
            "$(tui_dot "$TUI_S_STATE")" \
            "$(tui_pad "$TUI_M_ICON $TUI_M_LABEL" 28)" \
            "$(tui_pad "$TUI_S_STATE" 10)" \
            "$(tui_pad "$TUI_M_PORT" 6)" \
            "$(tui_trunc "$TUI_S_DETAIL" $((TUI_COLS - 52)))"
    done

    echo ""
    printf '  %bEndpoints%b   frontend http://localhost:%s    backend http://localhost:%s/health\n' \
        "$BOLD" "$NC" "$FRONTEND_PORT" "$BACKEND_PORT"
    if [[ "$TUI_CACHE_UP_STATE" != "stopped" ]]; then
        printf '               updater  http://127.0.0.1:1101    gateway :1104\n'
    fi

    echo ""
    printf '  %bMain Menu%b\n' "$BOLD" "$NC"
    printf '  %b%s%b\n' "$DIM" "$(tui_hline ─ $((TUI_COLS - 4)))" "$NC"
    tui_draw_list "$TUI_MENU_IDS" tui_menu_label 3
}

tui_draw_processes() {
    if [[ $TUI_PROC_COUNT -eq 0 ]]; then
        printf '\n  %bNo Myriad processes.%b  Overview → Start all.\n' "$DIM" "$NC"
        return
    fi
    printf '  %s\n' "$(tui_pad "KIND" 8)$(tui_pad "ID" 10)$(tui_pad "PPID" 8)$(tui_pad "CPU" 7)$(tui_pad "MEM" 7)$(tui_pad "ELAPSED" 10)CMD"
    printf '  %b%s%b\n' "$DIM" "$(tui_hline ─ $((TUI_COLS - 4)))" "$NC"

    local i=0 line kind id ppid cpu mem etime label cmd row
    local body=$((TUI_ROWS - 8))
    [[ $body -lt 4 ]] && body=4
    local start=0
    [[ $TUI_SEL -ge $body ]] && start=$((TUI_SEL - body + 1))
    local end=$((start + body))

    while IFS= read -r line; do
        [[ -n "$line" ]] || continue
        if [[ $i -lt $start ]]; then
            i=$((i + 1))
            continue
        fi
        [[ $i -ge $end ]] && break
        IFS='|' read -r kind id ppid cpu mem etime label cmd <<< "$line"
        row="$(tui_pad "$kind" 8)$(tui_pad "$id" 10)$(tui_pad "$ppid" 8)$(tui_pad "$cpu" 7)$(tui_pad "$mem" 7)$(tui_pad "$etime" 10)$(tui_trunc "$cmd" $((TUI_COLS - 54)))"
        if [[ $i -eq $TUI_SEL ]]; then
            printf ' %b▸%b %s\n' "$BRIGHT_CYAN" "$NC" "$row"
        else
            printf '   %s\n' "$row"
        fi
        i=$((i + 1))
    done <<< "$TUI_PROCS"
    printf '\n  %b%d process(es)%b\n' "$DIM" "$TUI_PROC_COUNT" "$NC"
}

tui_draw_database() {
    parse_db_url || { printf '\n  %bCould not parse DATABASE_URL%b\n' "$RED" "$NC"; return; }
    local reachable="no"
    db_reachable && reachable="yes"

    printf '\n  %bConnection%b\n' "$BOLD" "$NC"
    printf '    %s@%s:%s/%s\n' "$DB_USER" "$DB_HOST" "$DB_PORT" "$DB_NAME"
    if db_is_docker; then
        printf '    source    docker  (myriad-postgres-dev)\n'
    else
        printf '    source    native\n'
    fi
    printf '    reachable %s\n' "$reachable"

    if [[ "$reachable" != "yes" ]]; then
        printf '\n  %bNot reachable.%b  Start postgres, then Tools → db-setup if the role is missing.\n' "$YELLOW" "$NC"
        return
    fi
    if ! have psql; then
        printf '\n  %bpsql not found%b — install the PostgreSQL client tools.\n' "$YELLOW" "$NC"
        return
    fi

    local ver size conns maxc tables mig
    ver="$(db_scalar "SELECT current_setting('server_version')" || echo '?')"
    size="$(db_scalar "SELECT pg_size_pretty(pg_database_size(current_database()))" || echo '?')"
    conns="$(db_scalar "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()" || echo '?')"
    maxc="$(db_scalar "SELECT current_setting('max_connections')" || echo '?')"
    tables="$(db_scalar "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'" || echo '?')"
    mig="$(db_scalar "SELECT count(*) FROM seaql_migrations" || echo '—')"

    printf '\n  %bStats%b\n' "$BOLD" "$NC"
    printf '    postgres  %s\n' "$ver"
    printf '    size      %s\n' "$size"
    printf '    sessions  %s / %s\n' "$conns" "$maxc"
    printf '    tables    %s    migrations %s\n' "$tables" "$mig"

    echo ""
    printf '  %bLargest tables%b\n' "$BOLD" "$NC"
    db_psql -P pager=off -F $'\t' -A -c \
        "SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
         FROM pg_catalog.pg_statio_user_tables
         ORDER BY pg_total_relation_size(relid) DESC
         LIMIT 8" 2>/dev/null | awk 'NR==1{next} NF{printf "    %-32s %s\n", $1, $2}'

    echo ""
    printf '  %bLatest migrations%b\n' "$BOLD" "$NC"
    db_psql -P pager=off -tAc \
        "SELECT version FROM seaql_migrations ORDER BY version DESC LIMIT 5" 2>/dev/null \
        | sed 's/^/    /' || printf '    %bno seaql_migrations (backend has not applied schema)%b\n' "$DIM" "$NC"

    echo ""
    printf '  %bActivity%b\n' "$BOLD" "$NC"
    db_psql -P pager=off -F $'\t' -A -c \
        "SELECT pid, COALESCE(state,''), left(regexp_replace(COALESCE(query,''), E'[\\n\\r]+', ' ', 'g'), 48)
         FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()
         ORDER BY backend_start
         LIMIT 6" 2>/dev/null | awk -F '\t' 'NR==1{next} NF{printf "    %-7s %-12s %s\n", $1, $2, $3}'
}

tui_draw_logs() {
    local src i=0 body file
    printf '  '
    for src in backend.log frontend.log postgres updater; do
        if [[ $i -eq $TUI_LOG ]]; then
            printf '%b[%s]%b  ' "$BOLD$CYAN" "$src" "$NC"
        else
            printf '%b %s %b  ' "$DIM" "$src" "$NC"
        fi
        i=$((i + 1))
    done
    echo ""
    printf '  %b%s%b\n' "$DIM" "$(tui_hline ─ $((TUI_COLS - 4)))" "$NC"

    body=$((TUI_ROWS - 9))
    [[ $body -lt 4 ]] && body=4
    case "$TUI_LOG" in
        0)
            file="$PROJECT_ROOT/backend.log"
            if [[ -f "$file" ]]; then
                tail -n "$body" "$file" | sed 's/^/  /'
            else
                printf '\n  %bNo backend.log%b — start from Overview so logs land here.\n' "$YELLOW" "$NC"
            fi
            ;;
        1)
            file="$PROJECT_ROOT/frontend.log"
            if [[ -f "$file" ]]; then
                tail -n "$body" "$file" | sed 's/^/  /'
            else
                printf '\n  %bNo frontend.log%b — start from Overview so logs land here.\n' "$YELLOW" "$NC"
            fi
            ;;
        2)
            if docker_container_running "myriad-postgres-dev"; then
                docker logs --tail "$body" myriad-postgres-dev 2>&1 | sed 's/^/  /'
            else
                printf '\n  Native PostgreSQL has no compose log.\n'
            fi
            ;;
        3)
            if docker_container_running "myriad-updater-dev"; then
                docker logs --tail "$body" myriad-updater-dev 2>&1 | sed 's/^/  /'
            else
                printf '\n  Updater harness is not running.\n'
            fi
            ;;
    esac
}

tui_draw_tools() {
    printf '\n  %bTools%b\n\n' "$BOLD" "$NC"
    tui_draw_list "$TUI_TOOL_IDS" tui_tool_label
}

tui_draw_help() {
    printf '\n'
    printf '  %bKeys%b\n' "$BOLD" "$NC"
    printf '    1-5 / tab / ← →     switch tabs\n'
    printf '    ↑ ↓  j k            move selection\n'
    printf '    enter               run Overview menu / Tools action\n'
    printf '    s / x / r           start / stop / restart selected service\n'
    printf '    a / K               start-all / stop-all\n'
    printf '    p                   open psql\n'
    printf '    ?                   toggle this help\n'
    printf '    q                   quit (services keep running)\n'
    printf '\n  Starts from Overview write backend.log / frontend.log.\n'
}

tui_draw_confirm() {
    printf '\n\n'
    printf '  %bConfirm%b  %s\n\n' "$BOLD$YELLOW" "$NC" "$TUI_CONFIRM_TEXT"
    printf '    y  yes      n  cancel\n'
}

tui_render() {
    tui_size
    printf '\033[H'
    if [[ "$TUI_COLS" -lt $TUI_MIN_COLS || "$TUI_ROWS" -lt $TUI_MIN_ROWS ]]; then
        printf 'Myriad TUI needs at least %s×%s (now %s×%s). Widen the terminal.\n' \
            "$TUI_MIN_COLS" "$TUI_MIN_ROWS" "$TUI_COLS" "$TUI_ROWS"
        return
    fi
    tui_draw_header
    if [[ "$TUI_HELP" -eq 1 ]]; then
        tui_draw_help
    elif [[ -n "$TUI_CONFIRM" ]]; then
        tui_draw_confirm
    else
        case "$TUI_TAB" in
            0) tui_draw_overview ;;
            1) tui_draw_processes ;;
            2) tui_draw_database ;;
            3) tui_draw_logs ;;
            4) tui_draw_tools ;;
        esac
    fi
    printf '\033[%s;1H' "$((TUI_ROWS - 2))"
    tui_draw_footer
    printf '\033[J'
}

# ---------- actions ----------

tui_set_tab() {
    TUI_TAB="$1"
    TUI_SEL=0
    TUI_HELP=0
    TUI_CONFIRM=""
    TUI_CONFIRM_TEXT=""
    TUI_MSG=""
    [[ "$TUI_TAB" -eq 1 ]] && tui_refresh_procs
}

tui_sel_max() {
    case "$TUI_TAB" in
        0) echo $(( $(tui_count "$TUI_MENU_IDS") - 1 )) ;;
        1)
            if [[ $TUI_PROC_COUNT -gt 0 ]]; then
                echo $((TUI_PROC_COUNT - 1))
            else
                echo 0
            fi
            ;;
        4) echo $(( $(tui_count "$TUI_TOOL_IDS") - 1 )) ;;
        *) echo 0 ;;
    esac
}

tui_move() {
    local max
    max="$(tui_sel_max)"
    TUI_SEL=$((TUI_SEL + $1))
    [[ $TUI_SEL -lt 0 ]] && TUI_SEL=0
    [[ $TUI_SEL -gt $max ]] && TUI_SEL=$max
}

tui_bg_on() {
    DEV_START_BG=1
    USE_FG=0
    DETACH_EXPLICIT=1
}

tui_run_quiet() {
    local tmp rc last old_e=0
    tmp="$(mktemp "${TMPDIR:-/tmp}/myriad-dev.XXXXXX")" || {
        TUI_MSG="mktemp failed"
        return 0
    }
    [[ $- == *e* ]] && old_e=1
    tui_bg_on
    DEV_START_NOWAIT=1
    set +e
    "$@" >"$tmp" 2>&1
    rc=$?
    DEV_START_NOWAIT=0
    [[ $old_e -eq 1 ]] && set -e
    last="$(tui_strip "$(awk 'NF { line=$0 } END { print line }' "$tmp")")"
    rm -f "$tmp"
    if [[ $rc -ne 0 ]]; then
        TUI_MSG="${last:-failed ($rc)}"
    else
        TUI_MSG="${last:-ok}"
    fi
    return 0
}

tui_suspend() {
    tui_leave
    echo ""
    set +e
    "$@"
    local rc=$?
    echo ""
    [[ $rc -ne 0 ]] && print_warning "Command exited $rc (TUI will resume)" && echo ""
    echo -e "${DIM}Press Enter to return to TUI...${NC}"
    read -r _ || true
    tui_enter
    return 0
}

tui_open_url() {
    local url="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "$url" >/dev/null 2>&1 || true
    elif have xdg-open; then
        xdg-open "$url" >/dev/null 2>&1 || true
    else
        TUI_MSG="Open $url"
        return
    fi
    TUI_MSG="Opened $url"
}

tui_start_svc() {
    case "$1" in
        database) tui_run_quiet start_database ;;
        backend)  tui_run_quiet start_backend ;;
        frontend) tui_run_quiet start_frontend ;;
        updater)  tui_run_quiet start_updater ;;
        all)      tui_run_quiet start_all ;;
        *)        TUI_MSG="cannot start $1"; return 0 ;;
    esac
    TUI_STATUS_DIRTY=1
}

tui_stop_svc() {
    case "$1" in
        database) tui_run_quiet stop_database ;;
        backend)  tui_run_quiet stop_backend ;;
        frontend) tui_run_quiet stop_frontend ;;
        updater)  tui_run_quiet stop_updater ;;
        all)      tui_run_quiet stop_all ;;
        *)        TUI_MSG="cannot stop $1" ;;
    esac
    TUI_STATUS_DIRTY=1
}

tui_restart_svc() {
    local svc="$1"
    [[ -n "$svc" ]] || return 0
    tui_stop_svc "$svc"
    tui_start_svc "$svc"
}

tui_overview_target() {
    case "$(tui_nth "$TUI_MENU_IDS" $((TUI_SEL + 1)))" in
        start-all|stop-all|restart-all) echo all ;;
        database|backend|frontend|updater) tui_nth "$TUI_MENU_IDS" $((TUI_SEL + 1)) ;;
        *) echo "" ;;
    esac
}

tui_run_menu() {
    local id
    id="$(tui_nth "$TUI_MENU_IDS" $((TUI_SEL + 1)))"
    case "$id" in
        start-all)   tui_start_svc all ;;
        stop-all)    tui_stop_svc all ;;
        restart-all) tui_restart_svc all ;;
        database|backend|frontend|updater) tui_start_svc "$id" ;;
        clean) tui_ask_confirm clean "Drop public tables + build artifacts?" ;;
        *) TUI_MSG="unknown menu $id" ;;
    esac
}

tui_proc_at() {
    printf '%s' "$TUI_PROCS" | awk -v n="$(( $1 + 1 ))" 'NF && NR==n { print; exit }'
}

tui_kill_selected() {
    local sig="$1" line kind id
    line="$(tui_proc_at "$TUI_SEL")"
    [[ -n "$line" ]] || return 0
    IFS='|' read -r kind id _ <<< "$line"
    if [[ "$kind" == "ctr" ]]; then
        docker stop "$id" >/dev/null 2>&1 || true
    elif [[ "$id" =~ ^[0-9]+$ ]]; then
        if [[ "$sig" == "KILL" ]]; then
            kill -KILL "$id" 2>/dev/null || true
        else
            terminate_pids "selected" "$id" >/dev/null 2>&1 || true
        fi
    fi
    tui_refresh_procs
    TUI_STATUS_DIRTY=1
    TUI_MSG="signaled $id ($sig)"
}

tui_feed_clean() {
    printf 'yes\n' | clean_project
}

tui_run_tool() {
    local id="$1"
    case "$id" in
        doctor)        tui_suspend run_doctor ;;
        db-setup)      tui_suspend run_db_setup ;;
        psql)
            parse_db_url || { TUI_MSG="bad DATABASE_URL"; return; }
            have psql || { TUI_MSG="psql not found"; return; }
            tui_suspend env PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
            ;;
        open-frontend) tui_open_url "http://localhost:${FRONTEND_PORT}" ;;
        open-backend)  tui_open_url "http://localhost:${BACKEND_PORT}/health" ;;
        clean)         tui_ask_confirm clean "Drop public tables + build artifacts?" ;;
        *)             TUI_MSG="unknown tool $id" ;;
    esac
}

tui_ask_confirm() {
    TUI_CONFIRM="$1"
    TUI_CONFIRM_TEXT="$2"
}

tui_do_confirm() {
    case "$TUI_CONFIRM" in
        clean)
            tui_suspend tui_feed_clean
            TUI_MSG="clean finished"
            ;;
        kill) tui_kill_selected KILL ;;
    esac
    TUI_CONFIRM=""
    TUI_CONFIRM_TEXT=""
}

tui_handle_key() {
    local key="$1" target
    [[ "$key" == "timeout" ]] && return 0

    if [[ "$TUI_HELP" -eq 1 ]]; then
        case "$key" in
            \?|esc|q|h) TUI_HELP=0 ;;
        esac
        return 0
    fi

    if [[ -n "$TUI_CONFIRM" ]]; then
        case "$key" in
            y|Y) tui_do_confirm ;;
            n|N|esc|q) TUI_CONFIRM=""; TUI_CONFIRM_TEXT="" ;;
        esac
        return 0
    fi

    case "$key" in
        q|Q) return 1 ;;
        \?) TUI_HELP=1 ;;
        esc) TUI_MSG="" ;;
        1) tui_set_tab 0 ;;
        2) tui_set_tab 1 ;;
        3) tui_set_tab 2 ;;
        4) tui_set_tab 3 ;;
        5) tui_set_tab 4 ;;
        tab) tui_set_tab $(( (TUI_TAB + 1) % TUI_TAB_COUNT )) ;;
        right)
            if [[ "$TUI_TAB" -eq 3 ]]; then
                TUI_LOG=$(( (TUI_LOG + 1) % TUI_LOG_COUNT ))
            else
                tui_set_tab $(( (TUI_TAB + 1) % TUI_TAB_COUNT ))
            fi
            ;;
        left)
            if [[ "$TUI_TAB" -eq 3 ]]; then
                TUI_LOG=$(( (TUI_LOG + TUI_LOG_COUNT - 1) % TUI_LOG_COUNT ))
            else
                tui_set_tab $(( (TUI_TAB + TUI_TAB_COUNT - 1) % TUI_TAB_COUNT ))
            fi
            ;;
        up|k) tui_move -1 ;;
        down|j) tui_move 1 ;;
        a) tui_start_svc all ;;
        K) tui_stop_svc all ;;
        p) tui_run_tool psql ;;
        b) [[ "$TUI_TAB" -eq 3 ]] && TUI_LOG=0 ;;
        f) [[ "$TUI_TAB" -eq 3 ]] && TUI_LOG=1 ;;
        d) [[ "$TUI_TAB" -eq 3 ]] && TUI_LOG=2 ;;
        u) [[ "$TUI_TAB" -eq 3 ]] && TUI_LOG=3 ;;
        s)
            case "$TUI_TAB" in
                0)
                    target="$(tui_overview_target)"
                    [[ -n "$target" ]] && tui_start_svc "$target"
                    ;;
                2) tui_run_tool db-setup ;;
                4) tui_run_tool "$(tui_nth "$TUI_TOOL_IDS" $((TUI_SEL + 1)))" ;;
            esac
            ;;
        x)
            case "$TUI_TAB" in
                0)
                    target="$(tui_overview_target)"
                    [[ -n "$target" ]] && tui_stop_svc "$target"
                    ;;
                1) tui_kill_selected TERM ;;
            esac
            ;;
        X)
            [[ "$TUI_TAB" -eq 1 ]] && tui_ask_confirm kill "SIGKILL selected process?"
            ;;
        r)
            case "$TUI_TAB" in
                0) tui_restart_svc "$(tui_overview_target)" ;;
                1) tui_refresh_procs ;;
            esac
            ;;
        enter)
            case "$TUI_TAB" in
                0) tui_run_menu ;;
                4) tui_run_tool "$(tui_nth "$TUI_TOOL_IDS" $((TUI_SEL + 1)))" ;;
            esac
            ;;
    esac
    return 0
}

# ---------- entry ----------

run_tui() {
    set +e
    tui_attach_tty
    if [[ ! -t 0 || ! -t 1 ]]; then
        print_error "TUI needs a real Terminal window"
        print_info "Open Terminal.app, then: $0"
        print_info "Or a one-shot snapshot: $0 status"
        show_mini_logo
        show_status_dashboard || true
        tui_pause
        set -e
        return 0
    fi

    maybe_autodetect_native
    parse_db_url || true
    tui_refresh_status || true
    tui_refresh_procs || true

    trap 'tui_leave; exit 0' INT TERM EXIT
    tui_enter
    tui_render || true

    while true; do
        tui_read_key
        if [[ "$TUI_KEY" == "timeout" ]]; then
            continue
        fi
        if ! tui_handle_key "$TUI_KEY"; then
            break
        fi
        tui_render || true
    done

    trap - INT TERM EXIT
    tui_leave
    echo -e "${CYAN}${ICON_HEART} Services keep running. ${DIM}$0 status${NC} to check, ${DIM}$0 stop${NC} to shut down."
    set -e
    return 0
}
