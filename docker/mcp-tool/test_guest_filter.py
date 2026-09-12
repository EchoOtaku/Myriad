"""Check the security decisions of the emitted BPF, including alternate ABIs."""
import unittest

from guest_filter import program


def evaluate(code, arch, syscall, flags=0):
    data = {0: syscall, 4: arch, 16: flags & 0xFFFFFFFF}
    pc = acc = 0
    while pc < len(code):
        op, yes, no, value = code[pc]
        if op == 0x20:
            acc = data[value]
        elif op == 0x15:
            pc += yes if acc == value else no
        elif op == 0x45:
            pc += yes if acc & value else no
        elif op == 0x06:
            return value
        else:
            raise AssertionError(f"Unsupported BPF instruction: {op}")
        pc += 1
    raise AssertionError("Filter does not return")


class GuestFilterTests(unittest.TestCase):
    def test_namespaces_are_denied_but_ordinary_forks_remain_allowed(self):
        for machine, arch, clone, unshare, setns in [
            ("x86_64", 0xC000003E, 56, 272, 308),
            ("aarch64", 0xC00000B7, 220, 97, 268),
        ]:
            code = program(machine)
            for syscall in [unshare, setns]:
                self.assertEqual(evaluate(code, arch, syscall), 0x00050001)
            for namespace in [0x20000, 0x2000000, 0x4000000, 0x8000000,
                              0x10000000, 0x20000000, 0x40000000]:
                self.assertEqual(evaluate(code, arch, clone, namespace | 17), 0x00050001)
            self.assertEqual(evaluate(code, arch, clone, 17), 0x7FFF0000)
            self.assertEqual(evaluate(code, arch, 435), 0x00050026)
            self.assertEqual(evaluate(code, arch, 0), 0x7FFF0000)
            self.assertEqual(evaluate(code, 0x40000003, 120), 0x80000000)
            self.assertEqual(evaluate(code, arch, unshare | 0x40000000), 0x00050001)

    def test_unknown_image_architecture_fails_closed(self):
        with self.assertRaises(KeyError):
            program("unknown")


if __name__ == "__main__":
    unittest.main()
