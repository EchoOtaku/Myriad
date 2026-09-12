"""Verify the operator supplied a small, non-executable dedicated filesystem."""
import os
import stat


def validate(path):
    if not stat.S_ISDIR(os.lstat(path).st_mode):
        raise ValueError("MCP state must be a directory, not a symlink")
    fs = os.statvfs(path)
    if not 0 < fs.f_blocks * fs.f_frsize <= 128 * 1024 * 1024:
        raise ValueError("MCP state requires a dedicated filesystem of at most 128 MiB")
    required = os.ST_NODEV | os.ST_NOSUID | os.ST_NOEXEC
    if fs.f_flag & required != required:
        raise ValueError("MCP state mount requires nodev,nosuid,noexec")
    if not os.access(path, os.W_OK | os.X_OK):
        raise ValueError("MCP state must be writable by the tool container UID")


if __name__ == "__main__":
    validate("/var/lib/mcp-state")
