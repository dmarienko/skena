# - objects for tests/kernel-definition.mjs; the tests find lines by their text, so keep each def unique
import dataclasses
import functools


def plain(x):
    return x


class Box:
    size = 3

    def area(self):
        return self.size ** 2

    @property
    def side(self):
        raise RuntimeError('the property ran')

    @classmethod
    def make(cls):
        return cls()


def logged(f):
    @functools.wraps(f)
    def inner(*a, **k):
        return f(*a, **k)
    return inner


@logged
def decorated(y):
    return y


@dataclasses.dataclass
class Point:
    x: int = 0


box = Box()
