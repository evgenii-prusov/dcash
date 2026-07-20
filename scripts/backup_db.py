#!/usr/bin/env python3
"""Daily SQLite backup + grandfather-father-son retention pruning.

Usage:
    python scripts/backup_db.py                # take today's backup, then prune
    python scripts/backup_db.py --prune-only    # skip the backup step
    python scripts/backup_db.py --dry-run       # report what would happen, change nothing

Cron (daily at 03:00, from ~/dcash, using the container):
    0 3 * * *  docker compose -f ~/dcash/docker-compose.yml exec -T app \
                   python /app/scripts/backup_db.py >> /var/log/dcash-backup.log 2>&1

Backups land in /data/db_backups inside the dcash-data volume (override with
DCASH_BACKUP_DIR). Restore = stop app, copy file over dcash.sqlite, start app.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.db import DB_PATH  # noqa: E402

FILENAME_RE = re.compile(r"^dcash\.(\d{8}_\d{6})\.sqlite$")
TIMESTAMP_FMT = "%Y%m%d_%H%M%S"

DAILY_RETENTION_DAYS = 30
WEEKLY_RETENTION_DAYS = 60


def default_backup_dir() -> Path:
    override = os.environ.get("DCASH_BACKUP_DIR")
    if override:
        return Path(override)
    return DB_PATH.parent / "db_backups"


def backup_filename(timestamp: dt.datetime) -> str:
    return f"dcash.{timestamp.strftime(TIMESTAMP_FMT)}.sqlite"


def parse_backup_timestamp(path: Path) -> dt.datetime | None:
    match = FILENAME_RE.match(path.name)
    if match is None:
        return None
    return dt.datetime.strptime(match.group(1), TIMESTAMP_FMT)


def list_backups(backup_dir: Path) -> list[tuple[Path, dt.datetime]]:
    if not backup_dir.exists():
        return []
    backups = []
    for path in backup_dir.glob("dcash.*.sqlite"):
        timestamp = parse_backup_timestamp(path)
        if timestamp is not None:
            backups.append((path, timestamp))
    return sorted(backups, key=lambda item: item[1])


def create_backup(db_path: Path, backup_dir: Path, now: dt.datetime) -> Path | None:
    """Snapshot db_path into backup_dir using the SQLite online backup API.

    Idempotent: if a backup already exists for now's date, does nothing.
    """
    if not db_path.exists():
        raise FileNotFoundError(f"Database file not found: {db_path}")

    backup_dir.mkdir(parents=True, exist_ok=True)

    today_prefix = f"dcash.{now.strftime('%Y%m%d')}_"
    already_have_today = any(path.name.startswith(today_prefix) for path, _ in list_backups(backup_dir))
    if already_have_today:
        return None

    dest = backup_dir / backup_filename(now)
    source_conn = sqlite3.connect(str(db_path))
    try:
        dest_conn = sqlite3.connect(str(dest))
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()
    return dest


def select_timestamps_to_keep(timestamps: list[dt.datetime], now: dt.datetime) -> set[dt.datetime]:
    """GFS retention: daily for 30 days, weekly for 30–60 days, monthly beyond."""
    keep: set[dt.datetime] = set()
    weekly_seen: dict[tuple[int, int], dt.datetime] = {}
    monthly_seen: dict[tuple[int, int], dt.datetime] = {}

    for timestamp in sorted(timestamps):
        age_days = (now.date() - timestamp.date()).days
        if age_days <= DAILY_RETENTION_DAYS:
            keep.add(timestamp)
        elif age_days <= WEEKLY_RETENTION_DAYS:
            iso_year, iso_week, _ = timestamp.isocalendar()
            week_key = (iso_year, iso_week)
            if week_key not in weekly_seen:
                weekly_seen[week_key] = timestamp
                keep.add(timestamp)
        else:
            month_key = (timestamp.year, timestamp.month)
            if month_key not in monthly_seen:
                monthly_seen[month_key] = timestamp
                keep.add(timestamp)

    return keep


def prune_backups(backup_dir: Path, now: dt.datetime, dry_run: bool = False) -> list[Path]:
    backups = list_backups(backup_dir)
    keep = select_timestamps_to_keep([timestamp for _, timestamp in backups], now)

    removed = []
    for path, timestamp in backups:
        if timestamp not in keep:
            removed.append(path)
            if not dry_run:
                path.unlink()
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--db-path", type=Path, default=DB_PATH, help="SQLite file to back up")
    parser.add_argument("--backup-dir", type=Path, default=None, help="Directory for backups")
    parser.add_argument("--prune-only", action="store_true", help="Skip taking a new backup")
    parser.add_argument(
        "--dry-run", action="store_true", help="Print what would happen; don't write or delete"
    )
    args = parser.parse_args()

    backup_dir = args.backup_dir if args.backup_dir is not None else default_backup_dir()
    now = dt.datetime.now()

    if not args.prune_only:
        if args.dry_run:
            print(f"[dry-run] would back up {args.db_path} into {backup_dir}")
        else:
            created = create_backup(args.db_path, backup_dir, now)
            if created is not None:
                print(f"Created backup: {created}")
            else:
                print(f"Backup for {now.date()} already exists; skipping.")

    removed = prune_backups(backup_dir, now, dry_run=args.dry_run)
    verb = "Would delete" if args.dry_run else "Deleted"
    for path in removed:
        print(f"{verb}: {path}")
    if not removed:
        print("No backups pruned.")


if __name__ == "__main__":
    main()
