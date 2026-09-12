"""Build a small classic-BPF seccomp filter, layered over Docker's allowlist.

bwrap needs namespace syscalls during setup; the guest must not inherit that
exception. No libseccomp/runtime dependency is needed to encode sock_filter.
Only the two image architectures supported by this deployment are accepted.
"""
import platform
import struct
import sys


def program(machine):
    # AUDIT_ARCH, __NR_clone, __NR_unshare, __NR_setns.
    architectures = {
        "x86_64": (0xC000003E, 56, 272, 308),
        "aarch64": (0xC00000B7, 220, 97, 268),
    }
    arch, clone, unshare, setns = architectures[machine]
    allow, deny, kill = 0x7FFF0000, 0x00050001, 0x80000000
    return [
        (0x20, 0, 0, 4),              # LD seccomp_data.arch
        (0x15, 1, 0, arch),
        (0x06, 0, 0, kill),           # Reject compat/foreign syscall ABI.
        (0x20, 0, 0, 0),              # LD seccomp_data.nr
        (0x45, 0, 1, 0x40000000),     # Reject x32 ABI on x86_64 as well.
        (0x06, 0, 0, deny),
        (0x15, 0, 1, unshare),
        (0x06, 0, 0, deny),
        (0x15, 0, 1, setns),
        (0x06, 0, 0, deny),
        (0x15, 0, 1, 435),            # clone3: use the inspectable clone ABI.
        (0x06, 0, 0, 0x00050026),     # ENOSYS, so libc can fall back.
        (0x15, 0, 3, clone),
        (0x20, 0, 0, 16),             # Low 32 bits of clone flags (arg 0).
        (0x45, 0, 1, 0x7E020000),     # All CLONE_NEW* namespace bits.
        (0x06, 0, 0, deny),
        (0x06, 0, 0, allow),          # Docker's inherited filter still applies.
    ]


if __name__ == "__main__":
    instructions = program(platform.machine())
    with open(sys.argv[1], "wb") as output:
        output.write(b"".join(struct.pack("<HBBI", *row) for row in instructions))
